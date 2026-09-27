import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, makeFixtures, makeUser, get, User, Chapter } from './helpers.js';

// A group account may look up its own unclaimed writers. Anyone else's account
// is answered exactly as an account that does not exist, so a group login
// cannot be used to test which emails and usernames are signed up.
let f;
before(async () => {
	await startServer();
	f = await makeFixtures();
});
after(stopServer);

const answer = (res) => [res.status, res.body.code, res.body.error];

test("somebody else's account and nobody's are answered alike", async () => {
	const alice = await User.findByPk(f.alice.id);
	for (const [real, missing] of [
		['email=' + encodeURIComponent(alice.email), 'email=nobody-here%40example.com'],
		['username=' + alice.username, 'username=nobody-here'],
		['id=' + alice.id, 'id=999999']
	]) {
		const a = await get('/auth/user?' + real, f.chapter);
		const b = await get('/auth/user?' + missing, f.chapter);
		assert.equal(a.status, 404, real + ': ' + JSON.stringify(a.body));
		assert.deepEqual(answer(a), answer(b), real);
	}
});

test('a group still reads its own writers, and everyone reads themselves', async () => {
	assert.equal((await get('/auth/user?id=' + f.writer.id, f.chapter)).status, 200);
	assert.equal((await get('/auth/user?id=' + f.chapter.id, f.chapter)).status, 200);
	assert.equal((await get('/auth/user?id=' + f.alice.id, f.admin)).status, 200);
});

test('a member of a group that is not active is told so, about anyone', async () => {
	const paused = await Chapter.createChapter({
		name: 'Paused',
		location: {},
		accountStatus: 'suspended'
	});
	const member = await makeUser({ role: 'chapter', username: 'pausedmember' });
	await User.update({ chapterId: paused.id }, { where: { id: member.id } });
	const a = await get('/auth/user?id=' + f.alice.id, member);
	const b = await get('/auth/user?id=999999', member);
	assert.equal(a.status, 403, JSON.stringify(a.body));
	assert.deepEqual(answer(a), answer(b));
});

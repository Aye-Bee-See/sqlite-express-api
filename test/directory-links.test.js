import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
	startServer,
	stopServer,
	makeFixtures,
	makeUser,
	put,
	del,
	User,
	Chapter
} from './helpers.js';

let f;
let other;
let otherAdmin;
before(async () => {
	await startServer();
	f = await makeFixtures();
	other = await Chapter.createChapter({
		name: 'Other Group',
		location: {},
		accountStatus: 'active'
	});
	otherAdmin = await makeUser({ role: 'chapter', username: 'otheradmin' });
	await User.update({ chapterId: other.id }, { where: { id: otherAdmin.id } });
});
after(stopServer);

test('a group admin links and unlinks their own group as a relay or support group, and nobody else’s', async () => {
	const own = await put('/prison/relay', { prison: f.prison.id, chapter: f.group.id }, f.chapter);
	assert.equal(own.status, 200, JSON.stringify(own.body));
	const theirs = await put('/prison/relay', { prison: f.prison.id, chapter: other.id }, f.chapter);
	assert.equal(theirs.status, 403);
	assert.match(theirs.body.info, /own group only/);
	assert.equal(
		(await del('/prison/relay', { prison: f.prison.id, chapter: f.group.id }, otherAdmin)).status,
		403
	);
	assert.equal(
		(await del('/prison/relay', { prison: f.prison.id, chapter: f.group.id }, f.chapter)).status,
		200
	);
	// A superadmin links any group.
	assert.equal(
		(await put('/prison/relay', { prison: f.prison.id, chapter: other.id }, f.admin)).status,
		200
	);

	const support = await put(
		'/prisoner/support',
		{ prisoner: f.prisoner1.id, chapter: f.group.id, description: 'Pen pals' },
		f.chapter
	);
	assert.equal(support.status, 200, JSON.stringify(support.body));
	assert.equal(
		(await put('/prisoner/support', { prisoner: f.prisoner1.id, chapter: other.id }, f.chapter))
			.status,
		403
	);
	assert.equal(
		(await del('/prisoner/support', { prisoner: f.prisoner1.id, chapter: f.group.id }, otherAdmin))
			.status,
		403
	);
	assert.equal(
		(await del('/prisoner/support', { prisoner: f.prisoner1.id, chapter: f.group.id }, f.chapter))
			.status,
		200
	);
	// A writer has no group to link.
	assert.equal(
		(await put('/prison/relay', { prison: f.prison.id, chapter: f.group.id }, f.alice)).status,
		403
	);
});

test('a group that is not active links nothing, and is told why', async () => {
	await Chapter.update({ accountStatus: 'pending' }, { where: { id: other.id } });
	const res = await put('/prison/relay', { prison: f.prison.id, chapter: other.id }, otherAdmin);
	assert.equal(res.status, 403);
	assert.match(res.body.info, /waiting for network approval/);
	await Chapter.update({ accountStatus: 'active' }, { where: { id: other.id } });
});

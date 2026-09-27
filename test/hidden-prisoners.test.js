import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
	startServer,
	stopServer,
	makeFixtures,
	makeUser,
	post,
	put,
	Chat,
	Prisoner
} from './helpers.js';

// A writer sees published prisoners only. Naming a hidden one in a thread or a
// letter used to succeed, where naming a missing one failed: a script could
// walk the ids and learn which pending records exist.
let f;
let hidden;
let writer;
before(async () => {
	await startServer();
	f = await makeFixtures();
	hidden = await Prisoner.createPrisoner({
		birthName: 'Not Yet Checked',
		prison: f.prison.id,
		inmateID: 'NYC-1',
		recordStatus: 'pending'
	});
	writer = await makeUser({ username: 'idwalker' });
});
after(stopServer);

const same = (a, b, what) => {
	assert.equal(a.status, 404, what + ': ' + JSON.stringify(a.body));
	assert.equal(b.status, 404, what + ': ' + JSON.stringify(b.body));
	assert.equal(a.body.code, b.body.code, what + ': the same code');
	assert.equal(
		a.body.error.replace(String(hidden.id), 'N'),
		b.body.error.replace('999999', 'N'),
		what + ': the same sentence'
	);
};

test('a hidden prisoner and a missing one are answered alike, and nothing is made', async () => {
	same(
		await post('/chat/chat', { prisoner: hidden.id }, writer),
		await post('/chat/chat', { prisoner: 999999 }, writer),
		'a thread'
	);
	const letter = (prisoner) => ({ messageText: 'Hello', sender: 'user', prisoner });
	same(
		await post('/messaging/message', letter(hidden.id), writer),
		await post('/messaging/message', letter(999999), writer),
		'a letter'
	);
	const sent = await post('/messaging/message', letter(f.prisoner1.id), writer);
	assert.equal(sent.status, 201, JSON.stringify(sent.body));
	same(
		await put('/messaging/message', { id: sent.body.data.id, prisoner: hidden.id }, writer),
		await put('/messaging/message', { id: sent.body.data.id, prisoner: 999999 }, writer),
		'moving a letter'
	);
	assert.equal(await Chat.count({ where: { prisoner: hidden.id } }), 0, 'no thread was made');
});

test('staff, who can see a pending record, may still open a thread to it', async () => {
	const res = await post('/chat/chat', { user: f.writer.id, prisoner: hidden.id }, f.chapter);
	assert.equal(res.status, 201, JSON.stringify(res.body));
});

test('no seeded thread or letter is to a prisoner a writer cannot see', () => {
	const read = (name) => JSON.parse(readFileSync('database/seeds/' + name, 'utf8')).seeds;
	const prisoners = read('prisonerSeed.json');
	// Seeded prisoners take ids in file order on a new database.
	const published = (id) => (prisoners[id - 1].recordStatus ?? 'published') === 'published';
	assert.deepEqual(
		read('chatSeed.json').filter((c) => !published(c.prisoner)),
		[],
		'threads'
	);
	assert.deepEqual(
		read('messageSeed.json').filter((m) => !published(m.prisoner)),
		[],
		'letters'
	);
});

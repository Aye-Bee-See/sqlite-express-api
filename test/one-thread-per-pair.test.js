import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
	startServer,
	stopServer,
	makeFixtures,
	makeUser,
	post,
	get,
	Chat,
	Message,
	sequelize
} from './helpers.js';
import { up as mergeThreads } from '../database/migrations/2026.09.27T00.00.00.one-thread-per-pair.js';

let f;
before(async () => {
	await startServer();
	f = await makeFixtures();
});
after(stopServer);

test('asking for a thread that exists gives that thread, not a second one', async () => {
	const writer = await makeUser({ username: 'onethread' });
	const first = await post('/chat/chat', { user: writer.id, prisoner: f.prisoner1.id }, writer);
	assert.equal(first.status, 201, JSON.stringify(first.body));
	const again = await post('/chat/chat', { user: writer.id, prisoner: f.prisoner1.id }, writer);
	assert.equal(again.status, 201);
	assert.equal(again.body.data.id, first.body.data.id, 'the same thread');
	assert.equal(
		await Chat.count({ where: { user: writer.id, prisoner: f.prisoner1.id } }),
		1,
		'one row for the pair'
	);

	// A letter files itself under that same thread, as it always has.
	const letter = await post(
		'/messaging/message',
		{ messageText: 'Hello', sender: 'user', prisoner: f.prisoner1.id },
		writer
	);
	assert.equal(letter.status, 201, JSON.stringify(letter.body));
	assert.equal(letter.body.data.chat, first.body.data.id);
});

test('the database itself refuses a second thread for a pair', async () => {
	const writer = await makeUser({ username: 'doublethread' });
	await Chat.create({ user: writer.id, prisoner: f.prisoner2.id });
	await assert.rejects(
		() => Chat.create({ user: writer.id, prisoner: f.prisoner2.id }),
		/unique/i,
		'the unique index, not just the model, stops it'
	);
});

test('the migration merges threads that already existed, losing no letter', async () => {
	const writer = await makeUser({ username: 'mergeme' });
	const queryInterface = sequelize.getQueryInterface();
	// Put the database back as it was before this migration: the pair indexed, not unique.
	await queryInterface.removeIndex('Chats', 'chats_user_prisoner');
	await queryInterface.addIndex('Chats', ['user', 'prisoner'], { name: 'chats_user_prisoner' });

	const keeper = await Chat.create({ user: writer.id, prisoner: f.prisoner1.id });
	const duplicate = await Chat.create({ user: writer.id, prisoner: f.prisoner1.id });
	const stray = await Message.create({
		chat: duplicate.id,
		user: writer.id,
		prisoner: f.prisoner1.id,
		sender: 'user',
		messageText: 'Filed under the second thread',
		status: 'queued'
	});

	await mergeThreads({ context: queryInterface });

	assert.equal(await Chat.findByPk(duplicate.id), null, 'the duplicate thread is gone');
	assert.ok(await Chat.findByPk(keeper.id), 'the older thread is the one kept');
	assert.equal(
		(await Message.findByPk(stray.id)).chat,
		keeper.id,
		'its letter moved rather than went'
	);
	// And the pair cannot be doubled again.
	await assert.rejects(() => Chat.create({ user: writer.id, prisoner: f.prisoner1.id }), /unique/i);

	// The thread reads as one conversation.
	const threads = await get('/chat/chats?user=' + writer.id, f.admin);
	assert.equal(
		threads.body.data.filter((row) => row.prisoner === f.prisoner1.id).length,
		1,
		'one thread for the pair'
	);
});

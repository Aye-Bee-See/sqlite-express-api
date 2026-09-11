import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, get, post, put, del, makeFixtures, Chat } from './helpers.js';

let f;
let alice;
let bob;
let chapter;
let admin;
before(async () => {
	await startServer();
	f = await makeFixtures();
	alice = { token: f.alice.token };
	bob = { token: f.bob.token };
	chapter = { token: f.chapter.token };
	admin = { token: f.admin.token };
});
after(stopServer);

test('sending a message creates the chat and returns 201', async () => {
	const res = await post(
		'/messaging/message',
		{ messageText: 'Hello', sender: 'user', prisoner: f.prisoner1.id, user: f.alice.id },
		alice
	);
	assert.equal(res.status, 201);
	assert.equal(res.body.data.user, f.alice.id);
	assert.equal(res.body.data.prisoner, f.prisoner1.id);
	assert.equal(typeof res.body.data.chat, 'number');
	assert.equal(res.body.data.chatId, undefined);

	const chat = await get('/chat/chat?user=' + f.alice.id + '&prisoner=' + f.prisoner1.id, alice);
	assert.equal(chat.status, 200);
	assert.equal(chat.body.data.id, res.body.data.chat);
	assert.equal(typeof chat.body.data, 'object');
	assert.ok(!Array.isArray(chat.body.data));
});

test('a second message to the same pair reuses the chat', async () => {
	const first = await post(
		'/messaging/message',
		{ messageText: 'Again', sender: 'user', prisoner: f.prisoner1.id, user: f.alice.id },
		alice
	);
	const list = await get('/messaging/messages?chat=' + first.body.data.chat, alice);
	assert.equal(list.status, 200);
	assert.equal(list.body.data.length, 2);
	assert.ok(list.body.data.every((m) => m.chat === first.body.data.chat));
});

test('a user cannot spoof another user or the prisoner side', async () => {
	const res = await post(
		'/messaging/message',
		{ messageText: 'Spoof', sender: 'prisoner', prisoner: f.prisoner2.id, user: f.bob.id },
		alice
	);
	assert.equal(res.status, 201);
	assert.equal(res.body.data.user, f.alice.id);
	assert.equal(res.body.data.sender, 'user');
});

test('a user only sees their own chats and messages, whatever filters they pass', async () => {
	const chats = await get('/chat/chats?user=' + f.alice.id, bob);
	assert.equal(chats.status, 200);
	assert.deepEqual(chats.body.data, []);
	const messages = await get('/messaging/messages?user=' + f.alice.id, bob);
	assert.deepEqual(messages.body.data, []);
	const all = await get('/messaging/messages', bob);
	assert.deepEqual(all.body.data, []);

	const mine = await get('/chat/chats', alice);
	assert.ok(mine.body.data.length >= 2);
	assert.ok(mine.body.data.every((c) => c.user === f.alice.id));
});

test("a user gets 403 on another user's message or chat by id", async () => {
	const own = await get('/messaging/messages', alice);
	const messageId = own.body.data[0].id;
	const chatId = own.body.data[0].chat;
	assert.equal((await get('/messaging/message?id=' + messageId, bob)).status, 403);
	assert.equal((await get('/chat/chat?id=' + chatId, bob)).status, 403);
	assert.equal(
		(await put('/messaging/message', { id: messageId, messageText: 'x' }, bob)).status,
		403
	);
	assert.equal((await del('/messaging/message', { id: messageId }, bob)).status, 403);
	assert.equal((await del('/chat/chat', { id: chatId }, bob)).status, 403);
	assert.equal(
		(await put('/chat/chat', { id: chatId, prisoner: f.prisoner2.id }, bob)).status,
		403
	);
	assert.equal(
		(await get('/chat/chat?user=' + f.alice.id + '&prisoner=' + f.prisoner1.id, bob)).status,
		403
	);
});

test('admins read everything; chapters only their managed writers', async () => {
	const own = await get('/messaging/messages', alice);
	const messageId = own.body.data[0].id;
	assert.equal((await get('/messaging/message?id=' + messageId, admin)).status, 200);
	const all = await get('/messaging/messages?page_size=100', admin);
	assert.ok(all.body.data.length >= 3);

	// alice is independent: the group cannot see or write to her threads.
	assert.equal((await get('/messaging/message?id=' + messageId, chapter)).status, 403);
	assert.deepEqual((await get('/messaging/messages?page_size=100', chapter)).body.data, []);
	assert.deepEqual((await get('/messaging/messages?user=' + f.alice.id, chapter)).body.data, []);
	const spoof = await post(
		'/messaging/message',
		{ messageText: 'From inside', sender: 'prisoner', prisoner: f.prisoner1.id, user: f.alice.id },
		chapter
	);
	assert.equal(spoof.status, 403);

	// An admin can record the prisoner's side of any thread.
	const reply = await post(
		'/messaging/message',
		{ messageText: 'From inside', sender: 'prisoner', prisoner: f.prisoner1.id, user: f.alice.id },
		admin
	);
	assert.equal(reply.status, 201);
	assert.equal(reply.body.data.sender, 'prisoner');
	assert.equal(reply.body.data.user, f.alice.id);
});

test("a user may not narrow to another user's pair but may omit user in a pair lookup", async () => {
	const res = await get('/chat/chat?prisoner=' + f.prisoner1.id, alice);
	assert.equal(res.status, 200);
	assert.equal(res.body.data.user, f.alice.id);
});

test('chat lookups with incomplete parameters are 400s', async () => {
	const onlyUser = await get('/chat/chat?user=' + f.alice.id, admin);
	assert.equal(onlyUser.status, 400);
	assert.equal(onlyUser.body.error, 'Both user and prisoner are required.');
	const none = await get('/chat/chat', admin);
	assert.equal(none.status, 400);
	assert.equal(none.body.error, 'Provide either id, or both user and prisoner.');
	assert.equal(
		(await get('/chat/chat?user=' + f.alice.id + '&prisoner=999999', admin)).status,
		404
	);
});

test('message input is validated', async () => {
	const badSender = await post(
		'/messaging/message',
		{ messageText: 'x', sender: 'robot', prisoner: f.prisoner1.id, user: f.alice.id },
		admin
	);
	assert.equal(badSender.status, 400);
	assert.deepEqual(badSender.body.errors, ['Sender must either be user or prisoner.']);

	const missing = await post('/messaging/message', { messageText: 'x', sender: 'user' }, admin);
	assert.equal(missing.status, 400);
	assert.ok(missing.body.errors.some((m) => m.includes('Prisoner ID')));
	assert.ok(missing.body.errors.some((m) => m.includes('User ID')));

	const ghost = await post(
		'/messaging/message',
		{ messageText: 'x', sender: 'user', prisoner: f.prisoner1.id, user: 999999 },
		admin
	);
	assert.equal(ghost.status, 400);
	assert.equal(ghost.body.name, 'SequelizeForeignKeyConstraintError');
});

test('partial update keeps the chat; changing the pair moves the message', async () => {
	const created = await post(
		'/messaging/message',
		{ messageText: 'Move me', sender: 'user', prisoner: f.prisoner1.id, user: f.alice.id },
		alice
	);
	const id = created.body.data.id;
	const originalChat = created.body.data.chat;

	const text = await put('/messaging/message', { id, messageText: 'Edited' }, alice);
	assert.equal(text.status, 200);
	assert.deepEqual(text.body.data.updatedRows, [1]);
	let now = await get('/messaging/message?id=' + id, alice);
	assert.equal(now.body.data.messageText, 'Edited');
	assert.equal(now.body.data.chat, originalChat);

	const moved = await put('/messaging/message', { id, prisoner: f.prisoner2.id }, admin);
	assert.equal(moved.status, 200);
	now = await get('/messaging/message?id=' + id, admin);
	assert.notEqual(now.body.data.chat, originalChat);
	const pairChat = await Chat.readChatByUserAndPrisoner(f.alice.id, f.prisoner2.id, false);
	assert.equal(now.body.data.chat, pairChat.id);
});

test('delete a message, then 404; delete a chat removes its messages', async () => {
	const created = await post(
		'/messaging/message',
		{ messageText: 'Bye', sender: 'user', prisoner: f.prisoner2.id, user: f.bob.id },
		bob
	);
	const id = created.body.data.id;
	assert.equal((await del('/messaging/message', { id }, bob)).status, 200);
	assert.equal((await del('/messaging/message', { id }, bob)).status, 404);

	const chatId = created.body.data.chat;
	await post(
		'/messaging/message',
		{ messageText: 'One more', sender: 'user', prisoner: f.prisoner2.id, user: f.bob.id },
		bob
	);
	const removed = await del('/chat/chat', { id: chatId }, bob);
	assert.equal(removed.status, 200);
	assert.equal((await get('/chat/chat?id=' + chatId, admin)).status, 404);
	const left = await get('/messaging/messages?user=' + f.bob.id, admin);
	assert.deepEqual(left.body.data, []);
});

test('a user with chats cannot be deleted; chats full=true embeds messages and details', async () => {
	const refused = await del('/auth/user', { id: f.alice.id }, admin);
	assert.equal(refused.status, 400);
	assert.equal(refused.body.name, 'SequelizeForeignKeyConstraintError');

	const full = await get('/chat/chats?user=' + f.alice.id + '&full=true', admin);
	const chat = full.body.data[0];
	assert.ok(Array.isArray(chat.messages) && chat.messages.length > 0);
	assert.equal(chat.user_details.username, 'alice');
	assert.equal(chat.user_details.password, undefined);
	assert.equal(chat.prisoner_details.id, chat.prisoner);
	assert.ok(!JSON.stringify(full.body).includes('$2b$'));
});

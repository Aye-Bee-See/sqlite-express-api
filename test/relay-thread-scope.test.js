import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
	startServer,
	stopServer,
	get,
	post,
	makeFixtures,
	makeUser,
	User,
	Chapter,
	Prison,
	Prisoner
} from './helpers.js';

// A group sees a thread because it relays a letter in it. It sees that letter,
// not the others the writer sent the same prisoner through somebody else: in
// server mode those are plain text, and they are not the group's to read.
let f;
let groupA;
let groupB;
let writer;
let prisoner;
let chatId;

before(async () => {
	await startServer();
	f = await makeFixtures();
	groupA = { token: f.chapter.token, id: f.group.id };
	const other = await Chapter.createChapter({
		name: 'Group B',
		location: {},
		accountStatus: 'active'
	});
	const member = await makeUser({ role: 'chapter', username: 'groupbmember' });
	await User.update({ chapterId: other.id }, { where: { id: member.id } });
	groupB = { token: member.token, id: other.id };

	const prison = await Prison.createPrison({ prisonName: 'Two Groups Mail Here', address: {} });
	await Prison.addRelay(groupA.id, prison.id);
	await Prison.addRelay(groupB.id, prison.id);
	prisoner = await Prisoner.createPrisoner({
		birthName: 'Shared Prisoner',
		chosenName: 'Shared',
		prison: prison.id,
		inmateID: 'SH-1',
		status: 'incarcerated'
	});
	writer = await makeUser({ username: 'twogroupwriter' });
	for (const [text, via] of [
		['FIRST-VIA-B', groupB.id],
		['ONLY-VIA-A', groupA.id],
		['NEWEST-VIA-B', groupB.id]
	]) {
		const sent = await post(
			'/messaging/message',
			{ messageText: text, sender: 'user', prisoner: prisoner.id, relayChapter: via },
			writer
		);
		assert.equal(sent.status, 201, JSON.stringify(sent.body));
		chatId = sent.body.data.chat;
	}
});
after(stopServer);

const texts = (messages) => messages.map((m) => m.messageText).sort();

test('a relay group reads only the letters it relays, in a thread and in the inbox', async () => {
	const one = await get('/chat/chat?id=' + chatId + '&full=true', groupA);
	assert.equal(one.status, 200, JSON.stringify(one.body));
	assert.deepEqual(texts(one.body.data.messages), ['ONLY-VIA-A']);

	const list = await get('/chat/chats?prisoner=' + prisoner.id + '&full=true', groupA);
	assert.equal(list.status, 200, JSON.stringify(list.body));
	const row = list.body.data.find((c) => c.id === chatId);
	assert.ok(row, 'the thread is listed');
	assert.deepEqual(texts(row.messages), ['ONLY-VIA-A']);
	assert.equal(row.last_message.messageText, 'ONLY-VIA-A', 'not the newest letter, which is B’s');

	const inbox = await get('/chat/chats', groupA);
	const line = inbox.body.data.find((c) => c.id === chatId);
	assert.equal(line.last_message.messageText, 'ONLY-VIA-A');
});

test('the other group sees its own two, and the writer sees all three', async () => {
	const b = await get('/chat/chat?id=' + chatId + '&full=true', groupB);
	assert.deepEqual(texts(b.body.data.messages), ['FIRST-VIA-B', 'NEWEST-VIA-B']);
	const bInbox = await get('/chat/chats', groupB);
	assert.equal(
		bInbox.body.data.find((c) => c.id === chatId).last_message.messageText,
		'NEWEST-VIA-B'
	);

	const mine = await get('/chat/chat?id=' + chatId + '&full=true', writer);
	assert.deepEqual(texts(mine.body.data.messages), ['FIRST-VIA-B', 'NEWEST-VIA-B', 'ONLY-VIA-A']);
	const all = await get('/chat/chat?id=' + chatId + '&full=true', f.admin);
	assert.equal(all.body.data.messages.length, 3);
});

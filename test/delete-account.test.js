import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
	startServer,
	stopServer,
	makeFixtures,
	makeUser,
	get,
	post,
	put,
	del,
	upload,
	uploadDir,
	User,
	Chapter,
	Chat,
	Message,
	Attachment,
	LetterKey,
	Prison
} from './helpers.js';
import AuditLog from '../database/models/audit-log.model.js';
import MessageStatus from '../database/models/message-status.model.js';

let f;
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 0x20)]);

before(async () => {
	await startServer();
	f = await makeFixtures();
	await Prison.addRelay(f.group.id, f.prison.id);
});
after(stopServer);

const write = async (who, prisoner, text = 'A letter') => {
	const res = await post(
		'/messaging/message',
		{ prisoner, messageText: text, sender: 'user' },
		who
	);
	assert.equal(res.status, 201, JSON.stringify(res.body));
	return res.body.data;
};

test('deleting your own account needs your password, and removes everything you wrote and received', async () => {
	const carol = await makeUser({ username: 'carol' });
	const queued = await write(carol, f.prisoner1.id, 'Still queued');
	const mailed = await write(carol, f.prisoner1.id, 'Already mailed');
	await write(carol, f.prisoner2.id, 'Another thread');
	const scan = await upload(
		'/messaging/attachment',
		{
			fields: { message: queued.id },
			file: { name: 'scan.pdf', type: 'application/pdf', bytes: PDF }
		},
		carol
	);
	assert.equal(scan.status, 201, JSON.stringify(scan.body));
	const stored = (await Attachment.scope('withStoredName').findByPk(scan.body.data.id)).storedName;
	assert.ok(existsSync(join(uploadDir, stored)));
	for (const status of ['printed', 'mailed']) {
		assert.equal(
			(await put('/messaging/status', { id: mailed.id, status }, f.chapter)).status,
			200
		);
	}
	const reply = await post(
		'/messaging/message',
		{ prisoner: f.prisoner1.id, user: carol.id, sender: 'prisoner', messageText: 'Thank you' },
		f.chapter
	);
	assert.equal(reply.status, 201, JSON.stringify(reply.body));

	// A token alone is not enough: a borrowed phone must not be able to do this.
	const bare = await del('/auth/user', { id: carol.id }, carol);
	assert.equal(bare.status, 400);
	assert.match(bare.body.errors[0], /password/);
	const wrong = await del('/auth/user', { id: carol.id, password: 'not-the-password' }, carol);
	assert.equal(wrong.status, 403);
	assert.equal(await Message.count({ where: { user: carol.id } }), 4, 'nothing was deleted');

	const gone = await del('/auth/user', { id: carol.id, password: carol.password }, carol);
	assert.equal(gone.status, 200, JSON.stringify(gone.body));
	assert.deepEqual(gone.body.data, {
		deleted: 1,
		letters: 3,
		replies: 1,
		attachments: 1,
		threads: 2
	});

	assert.equal(await User.count({ where: { id: carol.id } }), 0);
	assert.equal(await Message.count({ where: { user: carol.id } }), 0, 'mailed letters go too');
	assert.equal(await Chat.count({ where: { user: carol.id } }), 0);
	for (const id of [queued.id, mailed.id, reply.body.data.id]) {
		assert.equal(
			await LetterKey.count({ where: { message: id } }),
			0,
			'no key to a deleted letter stays'
		);
		assert.equal(await MessageStatus.count({ where: { message: id } }), 0);
	}
	assert.equal(await Attachment.count({ where: { message: queued.id } }), 0);
	assert.ok(!existsSync(join(uploadDir, stored)), 'the file is gone from the disk');

	// The session is dead, the password opens nothing, and the name is free at once.
	assert.equal((await get('/chat/chats', carol)).status, 401);
	assert.equal(
		(await post('/auth/login', { username: 'carol', password: carol.password })).status,
		401
	);
	const again = await post('/auth/user', {
		username: 'carol',
		password: 'a-new-person',
		email: 'someone-else@example.com'
	});
	assert.equal(again.status, 201, JSON.stringify(again.body));
	assert.equal(
		(await get('/chat/chats', carol)).status,
		401,
		'the old token does not pass to the new carol'
	);

	// What is written down about it names nobody.
	const entry = await AuditLog.findOne({ where: { action: 'user.delete', targetId: carol.id } });
	assert.equal(entry.actor, null);
	assert.deepEqual(entry.details, {
		by: 'self',
		letters: 3,
		replies: 1,
		attachments: 1,
		threads: 2
	});
	assert.ok(!JSON.stringify(entry).includes('carol'));
});

test('nobody deletes somebody else, except an admin', async () => {
	const dave = await makeUser({ username: 'dave' });
	await write(dave, f.prisoner1.id);
	assert.equal(
		(await del('/auth/user', { id: dave.id, password: f.bob.password }, f.bob)).status,
		403
	);
	assert.equal((await del('/auth/user', { id: dave.id }, f.chapter)).status, 403);
	assert.equal(await User.count({ where: { id: dave.id } }), 1);

	// An admin needs no password of the person's (they do not know it), and the entry says who did it.
	const res = await del('/auth/user', { id: dave.id }, f.admin);
	assert.equal(res.status, 200, JSON.stringify(res.body));
	assert.equal(res.body.data.letters, 1);
	const entry = await AuditLog.findOne({ where: { action: 'user.delete', targetId: dave.id } });
	assert.equal(entry.actor, f.admin.id);
	assert.equal(entry.details.by, 'admin');
	assert.equal((await del('/auth/user', { id: dave.id }, f.admin)).status, 404);
	assert.equal((await del('/auth/user', {}, f.admin)).status, 400);
});

test('a group deletes its unclaimed writers with their letters, and nobody else', async () => {
	const w = (await post('/auth/writer', { name: 'Short Stay' }, f.chapter)).body.data;
	const sent = await post(
		'/messaging/message',
		{ prisoner: f.prisoner1.id, user: w.id, messageText: 'Written for them', sender: 'user' },
		f.chapter
	);
	assert.equal(sent.status, 201, JSON.stringify(sent.body));
	const res = await del('/auth/user', { id: w.id }, f.chapter);
	assert.equal(res.status, 200, JSON.stringify(res.body));
	assert.equal(res.body.data.letters, 1);
	assert.equal(
		(await AuditLog.findOne({ where: { action: 'user.delete', targetId: w.id } })).details.by,
		'group'
	);
	// Alice is not theirs.
	assert.equal((await del('/auth/user', { id: f.alice.id }, f.chapter)).status, 403);
});

test("a group's shared anonymous account is not deleted by anyone", async () => {
	const anon = await User.anonymousWriterFor(f.group.id);
	for (const who of [f.chapter, f.admin]) {
		const res = await del('/auth/user', { id: anon.id }, who);
		assert.equal(res.status, 409, JSON.stringify(res.body));
		assert.equal(res.body.name, 'AccountDeleteError');
	}
	assert.equal(await User.count({ where: { id: anon.id } }), 1);
});

test('the only admin cannot delete themselves; with a second one they can', async () => {
	const only = await del('/auth/user', { id: f.admin.id, password: f.admin.password }, f.admin);
	assert.equal(only.status, 409, JSON.stringify(only.body));
	assert.match(only.body.error, /only admin/);
	const second = await makeUser({ role: 'admin', username: 'admin2' });
	const res = await del('/auth/user', { id: second.id, password: second.password }, second);
	assert.equal(res.status, 200, JSON.stringify(res.body));
});

test('what a member did as staff stays, without their name on it', async () => {
	const group = await Chapter.createChapter({
		name: 'Leaving Member',
		location: {},
		accountStatus: 'active'
	});
	const member = await makeUser({ role: 'chapter', username: 'leaver' });
	await User.update({ chapterId: group.id }, { where: { id: member.id } });
	await Prison.addRelay(group.id, f.prison.id);
	const letter = (
		await post(
			'/messaging/message',
			{
				prisoner: f.prisoner2.id,
				messageText: 'Via the leaver',
				sender: 'user',
				relayChapter: group.id
			},
			f.bob
		)
	).body.data;
	assert.equal(
		(await put('/messaging/status', { id: letter.id, status: 'printed' }, member)).status,
		200
	);

	const res = await del('/auth/user', { id: member.id, password: member.password }, member);
	assert.equal(res.status, 200, JSON.stringify(res.body));
	const kept = await Message.findByPk(letter.id);
	assert.equal(kept.status, 'printed', "Bob's letter is untouched");
	assert.equal(kept.statusChangedBy, null);
	const history = await MessageStatus.findAll({ where: { message: letter.id } });
	assert.ok(history.length >= 2 && history.every((row) => row.changedBy !== member.id));
});

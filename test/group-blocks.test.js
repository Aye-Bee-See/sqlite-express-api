import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
	startServer,
	stopServer,
	makeFixtures,
	makeUser,
	get,
	post,
	put,
	del,
	User,
	Chapter,
	Prison,
	Prisoner,
	Message
} from './helpers.js';
import Notification from '../database/models/notification.model.js';
import AuditLog from '../database/models/audit-log.model.js';

// A group may block a writer from its letters (decided 30 September 2026). It
// reaches that group only; a superadmin stops an account everywhere by banning it.
let f;
let otherGroup;
let otherAdmin;
let twoGroupPrisoner;
before(async () => {
	await startServer();
	f = await makeFixtures();
	await Prison.addRelay(f.group.id, f.prison.id);
	otherGroup = await Chapter.createChapter({
		name: 'Second Group',
		location: {},
		accountStatus: 'active'
	});
	otherAdmin = await makeUser({ role: 'chapter', username: 'secondgroupadmin' });
	await User.update({ chapterId: otherGroup.id }, { where: { id: otherAdmin.id } });
	// A facility both groups mail to, so a blocked writer still has a way to write.
	const shared = await Prison.createPrison({ prisonName: 'Shared', address: {} });
	await Prison.addRelay(f.group.id, shared.id);
	await Prison.addRelay(otherGroup.id, shared.id);
	twoGroupPrisoner = await Prisoner.createPrisoner({
		birthName: 'Two Groups',
		prison: shared.id,
		inmateID: 'TG-1',
		status: 'incarcerated'
	});
});
after(stopServer);

const letter = (prisoner, extra = {}) => ({
	messageText: 'Hello',
	sender: 'user',
	prisoner,
	...extra
});

test('a group blocks a writer: their queued letters are held, new ones refused, and everyone is told', async () => {
	const writer = await makeUser({ username: 'misuser' });
	// Another admin of the same group, who should hear about it.
	const colleague = await makeUser({ role: 'chapter', username: 'blockwatcher' });
	await User.update({ chapterId: f.group.id }, { where: { id: colleague.id } });
	const waiting = await post('/messaging/message', letter(f.prisoner1.id), writer);
	assert.equal(waiting.status, 201, JSON.stringify(waiting.body));

	const res = await post(
		'/chapter/block',
		{ user: writer.id, reason: 'Repeated threats in letters.' },
		f.chapter
	);
	assert.equal(res.status, 200, JSON.stringify(res.body));
	assert.deepEqual(res.body.data, {
		chapter: f.group.id,
		user: writer.id,
		reason: 'Repeated threats in letters.',
		held: 1
	});
	assert.equal((await Message.findByPk(waiting.body.data.id)).heldReason, 'writer_blocked');
	// The inbox says so too, on the newest letter, not only in the thread's count (#177).
	const inbox = await get('/chat/chats', writer);
	const line = inbox.body.data.find((c) => c.id === waiting.body.data.chat);
	assert.equal(line.last_message.heldReason, 'writer_blocked');
	assert.equal(line.last_message.status, 'queued');

	// A new letter through that group is refused, with a code a client can word.
	const refused = await post('/messaging/message', letter(f.prisoner1.id), writer);
	assert.equal(refused.status, 403, JSON.stringify(refused.body));
	assert.equal(refused.body.code, 'group_block');

	// Only that group: through the other one, where the facility has one, it goes.
	const elsewhere = await post(
		'/messaging/message',
		letter(twoGroupPrisoner.id, { relayChapter: otherGroup.id }),
		writer
	);
	assert.equal(elsewhere.status, 201, JSON.stringify(elsewhere.body));
	const chosen = await post(
		'/messaging/message',
		letter(twoGroupPrisoner.id, { relayChapter: f.group.id }),
		writer
	);
	assert.equal(chosen.status, 403, 'choosing the blocking group is refused too');

	// The writer is told, with the reason; the group's admins are told who.
	const toWriter = await Notification.findOne({
		where: { userId: writer.id, event: 'writer.block' }
	});
	assert.deepEqual(toWriter.detail, {
		action: 'blocked',
		chapter: { id: f.group.id, name: f.group.name },
		reason: 'Repeated threats in letters.'
	});
	const toColleague = await Notification.findOne({
		where: { userId: colleague.id, event: 'group.block' }
	});
	assert.deepEqual(toColleague.detail, { action: 'blocked', writer: writer.id, held: 1 });
	assert.ok(await AuditLog.findOne({ where: { action: 'chapter.block', targetId: f.group.id } }));

	// Listed for the group.
	const listed = await get('/chapter/blocks', f.chapter);
	assert.equal(listed.status, 200, JSON.stringify(listed.body));
	const row = listed.body.data.find((b) => b.writer.id === writer.id);
	assert.equal(row.reason, 'Repeated threats in letters.');
	assert.equal(row.blockedBy.id, f.chapter.id);

	// Lifting it lets the held letter go, and new letters through.
	const lifted = await del('/chapter/block', { user: writer.id }, f.chapter);
	assert.equal(lifted.status, 200, JSON.stringify(lifted.body));
	assert.equal(lifted.body.data.released, 1);
	assert.equal((await Message.findByPk(waiting.body.data.id)).heldReason, null);
	const after = (await get('/chat/chats', writer)).body.data.find(
		(c) => c.id === waiting.body.data.chat
	);
	assert.equal(after.last_message.heldReason, null, 'on its way again');
	assert.equal((await post('/messaging/message', letter(f.prisoner1.id), writer)).status, 201);
	assert.ok(
		await AuditLog.findOne({ where: { action: 'chapter.block.remove', targetId: f.group.id } })
	);
	assert.deepEqual(
		(
			await Notification.findOne({
				where: { userId: writer.id, event: 'writer.block' },
				order: [['id', 'DESC']]
			})
		).detail.action,
		'lifted'
	);
});

test('the group itself may still write for a managed writer it blocked; the block is about the writer', async () => {
	// A group writes only for the managed writers it looks after. Blocking one stops
	// the writer (once they claim the account) from sending through the group, not
	// the group from acting for them.
	await post(
		'/chapter/block',
		{ user: f.writer.id, reason: 'Paused while we talk to them.' },
		f.chapter
	);
	const logged = await post(
		'/messaging/message',
		letter(f.prisoner1.id, { user: f.writer.id, paper: true }),
		f.chapter
	);
	assert.equal(logged.status, 201, JSON.stringify(logged.body));
	await del('/chapter/block', { user: f.writer.id }, f.chapter);
});

test('who may block: a group admin for their own group; not a writer, not another group, not a superadmin', async () => {
	const writer = await makeUser({ username: 'blocktarget' });
	const body = { user: writer.id, reason: 'Spam.' };
	assert.equal((await post('/chapter/block', body, f.alice)).status, 403, 'a writer');
	assert.equal(
		(await post('/chapter/block', { ...body, chapter: f.group.id }, otherAdmin)).status,
		403,
		"another group's admin, naming this group"
	);
	const bySuperadmin = await post('/chapter/block', { ...body, chapter: f.group.id }, f.admin);
	assert.equal(bySuperadmin.status, 403, 'a superadmin bans instead');
	assert.match(bySuperadmin.body.error ?? bySuperadmin.body.info, /banning/);

	// Only writers, and always with a reason.
	assert.equal((await post('/chapter/block', { user: writer.id }, f.chapter)).status, 400);
	assert.equal(
		(await post('/chapter/block', { user: otherAdmin.id, reason: 'x' }, f.chapter)).status,
		400,
		'not a group admin'
	);
});

test('a superadmin may list and lift a group block; another group may not lift it', async () => {
	const writer = await makeUser({ username: 'liftedbyadmin' });
	await post('/chapter/block', { user: writer.id, reason: 'Harassing volunteers.' }, f.chapter);
	assert.equal(
		(await del('/chapter/block', { user: writer.id, chapter: f.group.id }, otherAdmin)).status,
		403
	);
	const list = await get('/chapter/blocks?chapter=' + f.group.id, f.admin);
	assert.ok(list.body.data.some((b) => b.writer.id === writer.id));
	assert.equal(
		(await del('/chapter/block', { user: writer.id }, f.admin)).status,
		400,
		'names the group'
	);
	const lifted = await del('/chapter/block', { user: writer.id, chapter: f.group.id }, f.admin);
	assert.equal(lifted.status, 200, JSON.stringify(lifted.body));
	assert.equal(
		(await del('/chapter/block', { user: writer.id, chapter: f.group.id }, f.admin)).status,
		404
	);
});

test('a held letter can still be declined, and printing it needs release', async () => {
	const writer = await makeUser({ username: 'heldthendeclined' });
	const sent = await post('/messaging/message', letter(f.prisoner1.id), writer);
	await post('/chapter/block', { user: writer.id, reason: 'Abuse.' }, f.chapter);
	const print = await put(
		'/messaging/status',
		{ id: sent.body.data.id, status: 'printed' },
		f.chapter
	);
	assert.equal(print.status, 409, 'held: printing it is a decision');
	const declined = await put(
		'/messaging/status',
		{ id: sent.body.data.id, status: 'declined', reason: 'content' },
		f.chapter
	);
	assert.equal(declined.status, 200, JSON.stringify(declined.body));
});

test('a writer can read which groups are not mailing their letters, and why, but not who decided (#174)', async () => {
	const writer = await makeUser({ username: 'readsblocks' });
	assert.deepEqual((await get('/auth/blocks', writer)).body.data, [], 'none yet');
	await post('/chapter/block', { user: writer.id, reason: 'Abusive letters.' }, f.chapter);
	const mine = await get('/auth/blocks', writer);
	assert.equal(mine.status, 200, JSON.stringify(mine.body));
	assert.equal(mine.body.data.length, 1);
	const [row] = mine.body.data;
	assert.deepEqual(row.chapter, { id: f.group.id, name: f.group.name });
	assert.equal(row.reason, 'Abusive letters.');
	assert.ok(row.blockedAt);
	assert.equal('blockedBy' in row, false, 'the writer is never told who');
	assert.deepEqual((await get('/auth/blocks', f.chapter)).body.data, [], 'not a writer: none');
	assert.equal((await get('/auth/blocks', {})).status, 401);
	// Newest first, across groups; lifting one leaves the other.
	await post('/chapter/block', { user: writer.id, reason: 'Spam to our volunteers.' }, otherAdmin);
	const both = (await get('/auth/blocks', writer)).body.data;
	assert.deepEqual(
		both.map((b) => b.chapter.id),
		[otherGroup.id, f.group.id]
	);
	await del('/chapter/block', { user: writer.id }, f.chapter);
	assert.deepEqual(
		(await get('/auth/blocks', writer)).body.data.map((b) => b.chapter.id),
		[otherGroup.id],
		'the lifted one is gone, the other stays'
	);
	await del('/chapter/block', { user: writer.id }, otherAdmin);
	assert.deepEqual((await get('/auth/blocks', writer)).body.data, [], 'lifted');
});

test("reading a writer's blocks uses an index, not the whole table", async () => {
	const { sequelize } = await import('./helpers.js');
	const [plan] = await sequelize.query(
		'EXPLAIN QUERY PLAN SELECT * FROM GroupBlocks WHERE userId = 1 ORDER BY id DESC'
	);
	const said = plan.map((row) => row.detail).join(' | ');
	assert.match(said, /USING (COVERING )?INDEX group_blocks_user/, said);
	assert.doesNotMatch(said, /TEMP B-TREE/, 'and needs no sort for newest first');
});

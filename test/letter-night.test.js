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
	User,
	Chapter,
	Message,
	Prison,
	Prisoner,
	sequelize
} from './helpers.js';
import Notification from '../database/models/notification.model.js';
import AuditLog from '../database/models/audit-log.model.js';
import MessageStatus from '../database/models/message-status.model.js';
import MailRule from '../database/models/mail-rule.model.js';

let f;
let other; // another active group, relaying for another facility

before(async () => {
	await startServer();
	f = await makeFixtures();
	await Prison.addRelay(f.group.id, f.prison.id);
	const group = await Chapter.createChapter({
		name: 'Other Relay',
		location: {},
		accountStatus: 'active'
	});
	const member = await makeUser({ role: 'chapter', username: 'othermember' });
	await User.update({ chapterId: group.id }, { where: { id: member.id } });
	const prison = await Prison.createPrison({
		prisonName: 'Other Prison',
		address: { street: '8 Far' }
	});
	await Prison.addRelay(group.id, prison.id);
	const prisoner = await Prisoner.createPrisoner({
		birthName: 'Far Away',
		prison: prison.id,
		inmateID: 'O-1'
	});
	other = { group, member, prisoner };
});
after(stopServer);

const write = async (who, prisoner = f.prisoner1.id, text = 'Dear friend') => {
	const res = await post(
		'/messaging/message',
		{ prisoner, messageText: text, sender: 'user' },
		who
	);
	assert.equal(res.status, 201, JSON.stringify(res.body));
	return res.body.data;
};
const statuses = async (ids) =>
	(await Message.findAll({ where: { id: ids }, order: [['id', 'ASC']], hooks: false })).map(
		(m) => m.status
	);

test('a batch moves every letter, with one audit entry and one notification per writer', async () => {
	const a1 = await write(f.alice);
	const a2 = await write(f.alice, f.prisoner2.id);
	const b1 = await write(f.bob);
	const ids = [a1.id, a2.id, b1.id];
	const notified = await Notification.count({ where: { event: 'letter.status' } });

	const res = await put('/messaging/status/batch', { ids, status: 'printed' }, f.chapter);
	assert.equal(res.status, 200, JSON.stringify(res.body));
	assert.deepEqual(res.body.data, { status: 'printed', count: 3, ids });
	assert.deepEqual(await statuses(ids), ['printed', 'printed', 'printed']);
	for (const id of ids) {
		const last = (await MessageStatus.historyFor(id)).at(-1);
		assert.deepEqual(
			[last.fromStatus, last.toStatus, last.changedBy],
			['queued', 'printed', f.chapter.id]
		);
	}

	const entry = await AuditLog.findOne({
		where: { action: 'letter.status.batch' },
		order: [['id', 'DESC']]
	});
	assert.deepEqual(entry.details, { to: 'printed', count: 3, ids });
	assert.equal(await Notification.count({ where: { event: 'letter.status' } }), notified + 2);
	// Two letters in two threads: the writer is told once, with both named.
	const alice = await Notification.findOne({
		where: { userId: f.alice.id },
		order: [['id', 'DESC']]
	});
	assert.deepEqual(alice.detail, { status: 'printed', count: 2, messages: [a1.id, a2.id] });
	assert.deepEqual([alice.chat, alice.message], [null, null]);
	// One letter: exactly what the single endpoint sends.
	const bob = await Notification.findOne({ where: { userId: f.bob.id }, order: [['id', 'DESC']] });
	assert.deepEqual(bob.detail, { status: 'printed' });
	assert.deepEqual([bob.chat, bob.message], [b1.chat, b1.id]);
});

test('all or none: one letter that cannot move stops the whole batch, and says which', async () => {
	const ready = await write(f.alice);
	const already = await write(f.alice);
	await put('/messaging/status', { id: already.id, status: 'printed' }, f.chapter);
	const res = await put(
		'/messaging/status/batch',
		{ ids: [ready.id, already.id], status: 'printed' },
		f.chapter
	);
	assert.equal(res.status, 409);
	assert.equal(res.body.name, 'LetterStatusError');
	assert.match(
		res.body.error,
		new RegExp('^Letter ' + already.id + ': a printed letter cannot move to printed')
	);
	assert.deepEqual(await statuses([ready.id]), ['queued']);
	assert.equal(
		(await MessageStatus.historyFor(ready.id)).length,
		1,
		'no history of a move that did not happen'
	);
	// The single endpoint's sentence is what it always was.
	const single = await put('/messaging/status', { id: already.id, status: 'printed' }, f.chapter);
	assert.equal(single.body.error, 'A printed letter cannot move to printed.');
});

test("a batch holding somebody else's letter, or one that does not exist, moves nothing", async () => {
	const mine = await write(f.alice);
	const theirs = await write(f.bob, other.prisoner.id);
	assert.equal(theirs.relayChapter, other.group.id);
	const foreign = await put(
		'/messaging/status/batch',
		{ ids: [mine.id, theirs.id], status: 'printed' },
		f.chapter
	);
	assert.equal(foreign.status, 403);
	assert.match(JSON.stringify(foreign.body), new RegExp('letter ' + theirs.id));
	const missing = await put(
		'/messaging/status/batch',
		{ ids: [mine.id, 987654], status: 'printed' },
		f.chapter
	);
	assert.equal(missing.status, 404);
	assert.equal(
		(await put('/messaging/status/batch', { ids: [mine.id], status: 'printed' }, f.alice)).status,
		403
	);
	assert.deepEqual(await statuses([mine.id, theirs.id]), ['queued', 'queued']);
	// An admin may move both.
	const admin = await put(
		'/messaging/status/batch',
		{ ids: [mine.id, theirs.id], status: 'printed' },
		f.admin
	);
	assert.equal(admin.status, 200, JSON.stringify(admin.body));
});

test('the list of ids has to be a list of ids', async () => {
	const one = await write(f.alice);
	for (const ids of [
		undefined,
		[],
		'all',
		[one.id, one.id],
		[0],
		['x'],
		Array.from({ length: 201 }, (_, i) => i + 1)
	]) {
		const res = await put('/messaging/status/batch', { ids, status: 'printed' }, f.chapter);
		assert.equal(res.status, 400, JSON.stringify(ids)?.slice(0, 40));
	}
	assert.equal(
		(await put('/messaging/status/batch', { ids: [one.id], status: 'sent' }, f.chapter)).status,
		400
	);
});

test('returns and held letters keep their rules in a batch', async () => {
	const first = await write(f.alice);
	const second = await write(f.alice);
	const ids = [first.id, second.id];
	for (const status of ['printed', 'mailed']) {
		assert.equal((await put('/messaging/status/batch', { ids, status }, f.chapter)).status, 200);
	}
	assert.equal(
		(await put('/messaging/status/batch', { ids, status: 'returned' }, f.chapter)).status,
		400
	);
	const back = await put(
		'/messaging/status/batch',
		{ ids, status: 'returned', reason: 'refused', note: 'Whole bundle came back' },
		f.chapter
	);
	assert.equal(back.status, 200, JSON.stringify(back.body));
	assert.deepEqual(
		(await Message.findAll({ where: { id: ids }, hooks: false })).map((m) => m.returnReason),
		['refused', 'refused']
	);
	const told = await Notification.findOne({
		where: { userId: f.alice.id },
		order: [['id', 'DESC']]
	});
	assert.deepEqual(told.detail, { status: 'returned', reason: 'refused', count: 2, messages: ids });

	const held = await write(f.bob);
	const free = await write(f.bob);
	await Message.update({ heldReason: 'prisoner_free' }, { where: { id: held.id } });
	const blind = await put(
		'/messaging/status/batch',
		{ ids: [free.id, held.id], status: 'printed' },
		f.chapter
	);
	assert.equal(blind.status, 409);
	assert.equal(blind.body.name, 'LetterHeldError');
	assert.deepEqual(await statuses([held.id, free.id]), ['queued', 'queued']);
	const knowing = await put(
		'/messaging/status/batch',
		{ ids: [free.id, held.id], status: 'printed', release: true },
		f.chapter
	);
	assert.equal(knowing.status, 200);
	assert.equal((await Message.findByPk(held.id)).heldReason, null);
});

test('a letter that changes between the check and the move stops the batch', async () => {
	const one = await write(f.alice);
	const two = await write(f.alice);
	// What a second volunteer at another laptop does at the same moment.
	const update = Message.update.bind(Message);
	let raced = false;
	Message.update = async (...args) => {
		if (!raced) {
			raced = true;
			await sequelize.query("UPDATE Messages SET status = 'printed' WHERE id = " + two.id);
		}
		return await update(...args);
	};
	let res;
	try {
		res = await put(
			'/messaging/status/batch',
			{ ids: [one.id, two.id], status: 'printed' },
			f.chapter
		);
	} finally {
		Message.update = update;
	}
	assert.equal(res.status, 409, JSON.stringify(res.body));
	assert.match(res.body.error, /changed by someone else meanwhile; nothing was moved/);
	assert.deepEqual(await statuses([one.id]), ['queued'], 'the first letter was rolled back');
	assert.equal((await MessageStatus.historyFor(one.id)).length, 1);
});

test('full=true on the queue carries what printing and addressing need, in a fixed number of queries', async () => {
	await MailRule.createRule({
		tag: 'night_white_paper',
		category: 'paper_and_ink',
		label: 'White paper only (night)'
	});
	await Prison.updatePrison({ id: f.prison.id, mailRules: ['night_white_paper'], pageLimit: 4 });
	for (let i = 0; i < 6; i += 1) {
		await write(i % 2 ? f.alice : f.bob, i % 3 ? f.prisoner1.id : f.prisoner2.id, 'Queue ' + i);
	}
	const url = '/messaging/messages?status=queued&relayChapter=' + f.group.id + '&page_size=50';
	const plain = await get(url, f.chapter);
	assert.equal(plain.body.data[0].prisoner_details, undefined, 'only when asked for');

	const queries = [];
	const log = sequelize.options.logging;
	sequelize.options.logging = (sql) => queries.push(sql);
	let res;
	try {
		res = await get(url + '&full=true', f.chapter);
	} finally {
		sequelize.options.logging = log;
	}
	assert.equal(res.status, 200, JSON.stringify(res.body));
	assert.ok(res.body.data.length >= 6);
	for (const row of res.body.data) {
		assert.equal(row.prisoner_details.id, row.prisoner);
		assert.ok(row.prisoner_details.birthName && 'inmateID' in row.prisoner_details);
		const prison = row.prisoner_details.prison_details;
		assert.equal(prison.prisonName, 'Test Prison');
		assert.deepEqual(prison.address, { street: '1 Main' });
		assert.deepEqual(prison.mailRules, ['night_white_paper']);
		assert.equal(prison.pageLimit, 4);
		assert.deepEqual(Object.keys(row.user_details).sort(), [
			'anonymousForChapter',
			'id',
			'managedBy',
			'name',
			'username'
		]);
		assert.equal(row.messageText.startsWith('Queue') || row.messageText === 'Dear friend', true);
	}
	const selects = queries.filter(
		(sql) => /SELECT/.test(sql) && /FROM `(Prisoners|Prisons|User|MailRules)`/.test(sql)
	);
	assert.ok(selects.length <= 6, 'not one query per letter: ' + selects.length);

	// A writer reading their own letters gets the same shape, without staff-only fields.
	await Prisoner.update(
		{ verificationNotes: 'staff eyes only' },
		{ where: { id: f.prisoner1.id } }
	);
	const mine = await get('/messaging/messages?full=true&page_size=50', f.alice);
	assert.ok(mine.body.data.length > 0);
	assert.ok(!JSON.stringify(mine.body).includes('staff eyes only'));
	const asStaff = await get(url + '&full=true', f.chapter);
	assert.ok(JSON.stringify(asStaff.body).includes('staff eyes only'));
	const single = await get('/messaging/message?id=' + mine.body.data[0].id + '&full=true', f.alice);
	assert.equal(single.body.data.prisoner_details.id, mine.body.data[0].prisoner);
});

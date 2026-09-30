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
	Prison,
	Message
} from './helpers.js';
import Notification from '../database/models/notification.model.js';
import AuditLog from '../database/models/audit-log.model.js';

// A group admin may decide not to mail a letter its group relays, and say why
// (decided 30 September 2026). The writer is told, and may write it again.
let f;
let otherGroup;
before(async () => {
	await startServer();
	f = await makeFixtures();
	await Prison.addRelay(f.group.id, f.prison.id);
	// The fixture facility forbids stickers and handwritten letters only.
	assert.equal(
		(
			await put(
				'/prison/prison',
				{ id: f.prison.id, mailRules: ['no_stickers_or_labels', 'handwritten_only'] },
				f.admin
			)
		).status,
		200
	);
	const group = await Chapter.createChapter({
		name: 'Other',
		location: {},
		accountStatus: 'active'
	});
	otherGroup = await makeUser({ role: 'chapter', username: 'otherdecliner' });
	await User.update({ chapterId: group.id }, { where: { id: otherGroup.id } });
});
after(stopServer);

const send = async (text = 'Dear friend') => {
	const res = await post(
		'/messaging/message',
		{ messageText: text, sender: 'user', prisoner: f.prisoner1.id },
		f.alice
	);
	assert.equal(res.status, 201, JSON.stringify(res.body));
	assert.equal(res.body.data.relayChapter, f.group.id);
	return res.body.data;
};
const decline = (id, body, who = f.chapter) =>
	put('/messaging/status', { id, status: 'declined', ...body }, who);

test('a group admin declines a letter, says why, and the writer is told', async () => {
	const letter = await send('Something that should not go out');
	const res = await decline(letter.id, { reason: 'content', note: 'It names a guard.' });
	assert.equal(res.status, 200, JSON.stringify(res.body));
	assert.equal(res.body.data.status, 'declined');
	assert.equal(res.body.data.declineReason, 'content');
	assert.equal(res.body.data.declineNote, 'It names a guard.');
	assert.equal(res.body.data.declineRule, null);
	const last = res.body.data.status_history.at(-1);
	assert.deepEqual(
		[last.fromStatus, last.toStatus, last.reason, last.note],
		['queued', 'declined', 'content', 'It names a guard.']
	);

	// The writer sees it, with the reason, and is told.
	const mine = await get('/messaging/message?id=' + letter.id, f.alice);
	assert.equal(mine.body.data.status, 'declined');
	const told = await Notification.findOne({
		where: { userId: f.alice.id, event: 'letter.status', message: letter.id },
		order: [['id', 'DESC']]
	});
	assert.deepEqual(told.detail, { status: 'declined', reason: 'content' });

	// Recorded as a decision, in the long window.
	const entry = await AuditLog.findOne({
		where: { action: 'letter.decline', targetId: letter.id }
	});
	assert.equal(entry.details.reason, 'content');

	// It goes no further.
	const print = await put('/messaging/status', { id: letter.id, status: 'printed' }, f.chapter);
	assert.equal(print.status, 409, JSON.stringify(print.body));
});

test("a facility's rule is named, and must be one that facility has", async () => {
	const letter = await send();
	const none = await decline(letter.id, { reason: 'facility_rule' });
	assert.equal(none.status, 400);
	assert.deepEqual(none.body.problems, [{ field: 'rule', code: 'required' }]);

	const notTheirs = await decline(letter.id, { reason: 'facility_rule', rule: 'postcards_only' });
	assert.equal(notTheirs.status, 400);
	assert.deepEqual(notTheirs.body.problems, [{ field: 'rule', code: 'not_eligible' }]);

	const typed = await decline(letter.id, {
		reason: 'facility_rule',
		rule: 'handwritten_only',
		note: 'This one only takes handwritten letters. Could you copy it out by hand?'
	});
	assert.equal(typed.status, 200, JSON.stringify(typed.body));
	assert.equal(typed.body.data.declineRule, 'handwritten_only');

	// A rule only goes with that reason, and a reason is always given.
	const other = await send();
	assert.equal(
		(await decline(other.id, { reason: 'content', rule: 'handwritten_only' })).status,
		400
	);
	const bare = await decline(other.id, {});
	assert.equal(bare.status, 400);
	assert.equal(bare.body.problems[0].field, 'reason');
	assert.equal(
		(await decline(other.id, { reason: 'refused' })).status,
		400,
		'a return reason is not one'
	);
});

test('only the group that relays it declines it: not a superadmin, the writer, or another group', async () => {
	const letter = await send();
	for (const [who, what] of [
		[f.admin, 'a superadmin, who holds no key'],
		[f.alice, 'the writer'],
		[otherGroup, 'another group']
	]) {
		const res = await decline(letter.id, { reason: 'other', note: 'no' }, who);
		assert.equal(res.status, 403, what + ': ' + JSON.stringify(res.body));
	}
	assert.equal((await Message.findByPk(letter.id)).status, 'queued');
});

test('a printed letter, a paper one, or a held one can be declined; a mailed one cannot', async () => {
	const printed = await send();
	await put('/messaging/status', { id: printed.id, status: 'printed' }, f.chapter);
	assert.equal((await decline(printed.id, { reason: 'other', note: 'Smudged.' })).status, 200);

	const paper = await post(
		'/messaging/message',
		{ messageText: 'By hand', sender: 'user', prisoner: f.prisoner1.id, paper: true },
		f.chapter
	);
	assert.equal(paper.status, 201, JSON.stringify(paper.body));
	assert.equal(paper.body.data.status, 'printed');
	assert.equal((await decline(paper.body.data.id, { reason: 'content' })).status, 200);

	// Held because the person was moved: printing it needs release, declining it does not.
	const held = await send();
	await Message.update({ heldReason: 'prisoner_free' }, { where: { id: held.id }, hooks: false });
	assert.equal((await decline(held.id, { reason: 'other', note: 'Released.' })).status, 200);

	const mailed = await send();
	await put('/messaging/status', { id: mailed.id, status: 'printed' }, f.chapter);
	await put('/messaging/status', { id: mailed.id, status: 'mailed' }, f.chapter);
	const late = await decline(mailed.id, { reason: 'content' });
	assert.equal(late.status, 409, JSON.stringify(late.body));
	assert.equal(late.body.code, 'letter_status');
});

test('the writer may write it again, pointing at the letter it replaces', async () => {
	const letter = await send();
	assert.equal((await decline(letter.id, { reason: 'content' })).status, 200);
	const again = await post(
		'/messaging/message',
		{ messageText: 'Rewritten', sender: 'user', prisoner: f.prisoner1.id, resendOf: letter.id },
		f.alice
	);
	assert.equal(again.status, 201, JSON.stringify(again.body));
	assert.equal(again.body.data.resendOf, letter.id);
});

test('a batch declines together, and each writer is told once', async () => {
	const one = await send();
	const two = await send();
	const res = await put(
		'/messaging/status/batch',
		{ ids: [one.id, two.id], status: 'declined', reason: 'other', note: 'Over the page limit.' },
		f.chapter
	);
	assert.equal(res.status, 200, JSON.stringify(res.body));
	for (const id of [one.id, two.id]) {
		const row = await Message.findByPk(id);
		assert.deepEqual(
			[row.status, row.declineReason, row.declineNote],
			['declined', 'other', 'Over the page limit.']
		);
	}
	const told = await Notification.findAll({
		where: { userId: f.alice.id, event: 'letter.status' },
		order: [['id', 'DESC']],
		limit: 1
	});
	assert.deepEqual(told[0].detail, {
		status: 'declined',
		reason: 'other',
		count: 2,
		messages: [one.id, two.id]
	});
	const entry = await AuditLog.findOne({
		where: { action: 'letter.decline', targetId: null },
		order: [['id', 'DESC']]
	});
	assert.deepEqual(entry.details.ids, [one.id, two.id]);
	const byAdmin = await put(
		'/messaging/status/batch',
		{ ids: [(await send()).id], status: 'declined', reason: 'other' },
		f.admin
	);
	assert.equal(byAdmin.status, 403, 'a superadmin cannot decline in a batch either');
});

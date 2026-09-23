import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
	startServer,
	stopServer,
	makeFixtures,
	get,
	post,
	put,
	del,
	Message,
	Prison,
	Prisoner
} from './helpers.js';
import AuditLog from '../database/models/audit-log.model.js';
import Notification from '../database/models/notification.model.js';
import { runRetention } from '../database/retention.js';

let f;

before(async () => {
	await startServer();
	f = await makeFixtures();
	await Prison.addRelay(f.group.id, f.prison.id);
});
after(stopServer);

/** Alice writes; the fixture group prints and mails it. */
async function mailed(prisoner = f.prisoner1.id, extra = {}) {
	const sent = await post(
		'/messaging/message',
		{ prisoner, messageText: 'Dear friend', sender: 'user', ...extra },
		f.alice
	);
	assert.equal(sent.status, 201, JSON.stringify(sent.body));
	for (const status of ['printed', 'mailed']) {
		const res = await put('/messaging/status', { id: sent.body.data.id, status }, f.chapter);
		assert.equal(res.status, 200, JSON.stringify(res.body));
	}
	return sent.body.data;
}

test('a mailed letter that comes back is returned, with the reason, and the writer is told', async () => {
	const letter = await mailed();
	const res = await put(
		'/messaging/status',
		{ id: letter.id, status: 'returned', reason: 'transferred', note: '  Stamped NOT HERE  ' },
		f.chapter
	);
	assert.equal(res.status, 200, JSON.stringify(res.body));
	assert.equal(res.body.data.status, 'returned');
	assert.equal(res.body.data.returnReason, 'transferred');
	assert.equal(res.body.data.returnNote, 'Stamped NOT HERE', 'the note sits on the letter too');
	const last = res.body.data.status_history.at(-1);
	assert.deepEqual(
		[last.fromStatus, last.toStatus, last.reason, last.note],
		['mailed', 'returned', 'transferred', 'Stamped NOT HERE']
	);

	// The writer sees it on the letter, in lists, and in the feed (content-free: ids and codes).
	const mine = await get('/messaging/messages?status=returned', f.alice);
	assert.deepEqual(
		mine.body.data.map((m) => [m.id, m.returnReason, m.returnNote]),
		[[letter.id, 'transferred', 'Stamped NOT HERE']]
	);
	const told = await Notification.findOne({
		where: { userId: f.alice.id, message: letter.id },
		order: [['id', 'DESC']]
	});
	assert.equal(told.event, 'letter.status');
	assert.deepEqual(told.detail, { status: 'returned', reason: 'transferred' });
	const entry = await AuditLog.findOne({
		where: { action: 'letter.status', targetId: letter.id },
		order: [['id', 'DESC']]
	});
	assert.deepEqual(entry.details, { from: 'mailed', to: 'returned', reason: 'transferred' });
});

test('only a mailed letter can come back, it needs a known reason, and it stays returned', async () => {
	const queued = (
		await post(
			'/messaging/message',
			{ prisoner: f.prisoner1.id, messageText: 'Not sent yet', sender: 'user' },
			f.alice
		)
	).body.data;
	const early = await put(
		'/messaging/status',
		{ id: queued.id, status: 'returned', reason: 'refused' },
		f.chapter
	);
	assert.equal(early.status, 409);

	const letter = await mailed();
	for (const body of [
		{},
		{ reason: 'lost in the post' },
		{ reason: 'refused', note: 'x'.repeat(201) }
	]) {
		const res = await put(
			'/messaging/status',
			{ id: letter.id, status: 'returned', ...body },
			f.chapter
		);
		assert.equal(res.status, 400, JSON.stringify(body));
	}
	assert.equal((await Message.findByPk(letter.id)).status, 'mailed');
	// A reason belongs to a return and to nothing else.
	const other = (
		await post(
			'/messaging/message',
			{ prisoner: f.prisoner1.id, messageText: 'Another', sender: 'user' },
			f.alice
		)
	).body.data;
	const misplaced = await put(
		'/messaging/status',
		{ id: other.id, status: 'printed', reason: 'refused' },
		f.chapter
	);
	assert.equal(misplaced.status, 400);

	// The writer cannot mark their own letter returned; the relay group or an admin does.
	const self = await put(
		'/messaging/status',
		{ id: letter.id, status: 'returned', reason: 'refused' },
		f.alice
	);
	assert.equal(self.status, 403);
	assert.equal(
		(
			await put(
				'/messaging/status',
				{ id: letter.id, status: 'returned', reason: 'refused' },
				f.admin
			)
		).status,
		200
	);
	assert.equal(
		(await put('/messaging/status', { id: letter.id, status: 'mailed' }, f.admin)).status,
		409
	);
	// Like a mailed letter, it is a record: the writer can pin it, not rewrite or delete it.
	assert.equal(
		(await put('/messaging/message', { id: letter.id, messageText: 'changed' }, f.alice)).status,
		403
	);
	assert.equal((await del('/messaging/message', { id: letter.id }, f.alice)).status, 403);
	assert.equal(
		(await put('/messaging/message', { id: letter.id, keep: true }, f.alice)).status,
		200
	);
});

test('a letter sent again names the returned one, and each shows the other', async () => {
	const letter = await mailed(f.prisoner2.id);
	const notYet = await post(
		'/messaging/message',
		{ prisoner: f.prisoner2.id, messageText: 'Again', sender: 'user', resendOf: letter.id },
		f.alice
	);
	assert.equal(notYet.status, 400, 'a letter that has not come back is not sent "again"');
	await put(
		'/messaging/status',
		{ id: letter.id, status: 'returned', reason: 'bad_address' },
		f.chapter
	);

	// Somebody else's returned letter, or another prisoner's, is not yours to send again.
	const theirs = await post(
		'/messaging/message',
		{ prisoner: f.prisoner2.id, messageText: 'Again', sender: 'user', resendOf: letter.id },
		f.bob
	);
	assert.equal(theirs.status, 400);
	const elsewhere = await post(
		'/messaging/message',
		{ prisoner: f.prisoner1.id, messageText: 'Again', sender: 'user', resendOf: letter.id },
		f.alice
	);
	assert.equal(elsewhere.status, 400);

	const again = await post(
		'/messaging/message',
		{
			prisoner: f.prisoner2.id,
			messageText: 'Dear friend, once more',
			sender: 'user',
			resendOf: letter.id
		},
		f.alice
	);
	assert.equal(again.status, 201, JSON.stringify(again.body));
	assert.equal(again.body.data.resendOf, letter.id);
	assert.equal(again.body.data.status, 'queued');
	const original = await get('/messaging/message?id=' + letter.id + '&full=true', f.alice);
	assert.deepEqual(
		original.body.data.resent_as.map((m) => [m.id, m.status]),
		[[again.body.data.id, 'queued']]
	);
	// An edit cannot forge or move the link.
	await put(
		'/messaging/message',
		{ id: again.body.data.id, resendOf: null, returnReason: 'refused', returnNote: 'forged' },
		f.alice
	);
	const stored = await Message.findByPk(again.body.data.id);
	assert.equal(stored.resendOf, letter.id);
	assert.equal(stored.returnReason, null);
	assert.equal(stored.returnNote, null);
});

test('mail that comes back as moved puts the address in doubt, for staff, until someone edits the record', async () => {
	const count = async () =>
		(await get('/moderation/summary', f.admin)).body.data.addressInDoubt.prisoner;
	const listed = async (who) =>
		(await get('/prisoner/prisoners?addressInDoubt=true&page_size=100', who)).body.data.map(
			(p) => p.id
		);
	await Prisoner.update(
		{ bio: 'A longer biography, edited just now.' },
		{ where: { id: f.prisoner1.id } }
	);
	const before = await count();

	// "Refused" says nothing about where the person is.
	const refused = await mailed(f.prisoner1.id);
	await put(
		'/messaging/status',
		{ id: refused.id, status: 'returned', reason: 'refused' },
		f.chapter
	);
	assert.equal(await count(), before);
	assert.ok(!(await listed(f.chapter)).includes(f.prisoner1.id));

	await new Promise((resolve) => setTimeout(resolve, 5));
	const moved = await mailed(f.prisoner1.id);
	await put(
		'/messaging/status',
		{ id: moved.id, status: 'returned', reason: 'released' },
		f.chapter
	);
	assert.equal(await count(), before + 1);
	assert.ok((await listed(f.chapter)).includes(f.prisoner1.id));
	// Not for the public directory: the parameter is ignored, as recordStatus is.
	const asPublic = await get('/prisoner/prisoners?addressInDoubt=true&page_size=100');
	assert.equal(asPublic.body.total, (await get('/prisoner/prisoners?page_size=100')).body.total);

	// Someone looks into it and updates the record: the doubt is answered.
	await new Promise((resolve) => setTimeout(resolve, 5));
	assert.equal(
		(await put('/prisoner/prisoner', { id: f.prisoner1.id, status: 'free' }, f.admin)).status,
		200
	);
	assert.equal(await count(), before);
});

test('retention removes a returned letter after the window, counted from the day it came back', async () => {
	const letter = await mailed(f.prisoner2.id);
	await put(
		'/messaging/status',
		{ id: letter.id, status: 'returned', reason: 'unknown' },
		f.chapter
	);
	const soon = await runRetention({ now: new Date(Date.now() + 30 * 86400000), log: () => {} });
	assert.ok(await Message.findByPk(letter.id), 'still inside the window: ' + JSON.stringify(soon));
	await runRetention({ now: new Date(Date.now() + 120 * 86400000), log: () => {} });
	assert.equal(await Message.findByPk(letter.id), null);
});

test('an Idempotency-Key covers which returned letter is being sent again', async () => {
	const first = await mailed(f.prisoner2.id);
	const second = await mailed(f.prisoner2.id);
	for (const letter of [first, second]) {
		await put(
			'/messaging/status',
			{ id: letter.id, status: 'returned', reason: 'unknown' },
			f.chapter
		);
	}
	const body = { prisoner: f.prisoner2.id, messageText: 'Once more', sender: 'user' };
	const options = { ...f.alice, headers: { 'Idempotency-Key': 'resend-of-the-first' } };
	const sent = await post('/messaging/message', { ...body, resendOf: first.id }, options);
	assert.equal(sent.status, 201, JSON.stringify(sent.body));
	const retry = await post('/messaging/message', { ...body, resendOf: first.id }, options);
	assert.equal(retry.headers.get('idempotent-replayed'), 'true');
	assert.equal(retry.body.data.id, sent.body.data.id);
	// The same key for another returned letter is another request, not a replay of this one.
	const other = await post('/messaging/message', { ...body, resendOf: second.id }, options);
	assert.equal(other.status, 422, JSON.stringify(other.body));
	assert.equal((await Message.findByPk(sent.body.data.id)).resendOf, first.id);
});

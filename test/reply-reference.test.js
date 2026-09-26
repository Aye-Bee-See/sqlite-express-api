import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
	startServer,
	stopServer,
	makeFixtures,
	makeUser,
	agePenNames,
	get,
	post,
	put,
	del,
	Prison,
	Chapter,
	User,
	Message
} from './helpers.js';
import ReplyReference from '../database/models/reply-reference.model.js';
import MailRule from '../database/models/mail-rule.model.js';
import { isReference, formatReference, newReference } from '../database/reply-reference.js';
import { runRetention } from '../database/retention.js';

let f;
before(async () => {
	await startServer();
	f = await makeFixtures();
	await Prison.addRelay(f.group.id, f.prison.id);
	await put('/auth/user', { id: f.alice.id, penName: 'Alice Wren' }, f.alice);
});
after(stopServer);

const letter = (extra = {}) => ({
	messageText: 'Dear friend',
	sender: 'user',
	prisoner: f.prisoner1.id,
	...extra
});

test('the check digit: a slip of the pen is refused, not filed', () => {
	for (let i = 0; i < 200; i += 1) {
		const ref = newReference();
		assert.match(ref, /^[0-9]{9}$/);
		assert.ok(isReference(ref));
		assert.ok(isReference(formatReference(ref)), 'with dashes');
		assert.ok(isReference(' ' + ref.slice(0, 4) + ' ' + ref.slice(4) + ' '), 'with spaces');
		// One wrong digit anywhere is caught.
		const at = i % 9;
		const wrong = ref.slice(0, at) + String((Number(ref[at]) + 1) % 10) + ref.slice(at + 1);
		assert.equal(isReference(wrong), false, ref + ' vs ' + wrong);
		// Two neighbouring digits swapped are caught (unless they are equal, or 0 and 9).
		const j = i % 8;
		const a = ref[j];
		const b = ref[j + 1];
		if (a !== b && !((a === '0' && b === '9') || (a === '9' && b === '0'))) {
			const swapped = ref.slice(0, j) + b + a + ref.slice(j + 2);
			assert.equal(isReference(swapped), false, ref + ' vs ' + swapped);
		}
	}
	assert.equal(isReference('12345678'), false);
	assert.equal(isReference('abcdefghi'), false);
	assert.equal(isReference(''), false);
	assert.equal(formatReference('482719356'), '4827-1935-6');
});

test('every outgoing letter carries a reference; the footer says who to write back to, care of whom', async () => {
	const sent = await post('/messaging/message', letter(), f.alice);
	assert.equal(sent.status, 201, JSON.stringify(sent.body));
	const ref = sent.body.data.replyReference;
	assert.match(ref, /^[0-9]{9}$/);
	assert.ok(isReference(ref));
	const row = await ReplyReference.findOne({ where: { reference: ref } });
	assert.deepEqual(
		[row.message, row.user, row.prisoner, row.chapter, row.mailedAt, row.expiresAt],
		[sent.body.data.id, f.alice.id, f.prisoner1.id, f.group.id, null, null]
	);
	const printed = await get('/messaging/message?id=' + sent.body.data.id + '&full=true', f.chapter);
	assert.deepEqual(printed.body.data.footer, {
		name: 'Alice Wren',
		anonymous: false,
		careOf: { id: f.group.id, name: 'Fixture Group' },
		reference: formatReference(ref),
		replySheetAllowed: false
	});
	// A reply has no reference of its own; the anonymous writer has no name.
	const reply = await post(
		'/messaging/message',
		letter({ sender: 'prisoner', user: f.writer.id }),
		f.chapter
	);
	assert.equal(reply.status, 201, JSON.stringify(reply.body));
	assert.equal(reply.body.data.replyReference ?? null, null);
	const anon = await post('/messaging/message', letter(), f.chapter);
	const anonPrinted = await get(
		'/messaging/message?id=' + anon.body.data.id + '&full=true',
		f.chapter
	);
	assert.deepEqual(
		[anonPrinted.body.data.footer.name, anonPrinted.body.data.footer.anonymous],
		[null, true]
	);
	// A writer without a pen name is written back to by their name.
	const bobs = await post('/messaging/message', letter(), f.bob);
	const bobPrinted = await get(
		'/messaging/message?id=' + bobs.body.data.id + '&full=true',
		f.chapter
	);
	assert.equal(bobPrinted.body.data.footer.name, f.bob.user.name ?? null);
	// Nobody edits the number.
	await put('/messaging/message', { id: sent.body.data.id, replyReference: '000000000' }, f.alice);
	assert.equal((await Message.findByPk(sent.body.data.id)).replyReference, ref);
});

test('a facility whose mail room rejects reference numbers gets a footer without one; a reply sheet only where allowed', async () => {
	const strict = await Prison.createPrison({
		prisonName: 'Strict',
		address: {},
		mailRules: ['no_reference_numbers']
	});
	await Prison.addRelay(f.group.id, strict.id);
	const person = await (
		await import('./helpers.js')
	).Prisoner.createPrisoner({ birthName: 'Strict Person', prison: strict.id, inmateID: 'S-1' });
	const sent = await post('/messaging/message', letter({ prisoner: person.id }), f.alice);
	assert.equal(sent.status, 201, JSON.stringify(sent.body));
	assert.ok(sent.body.data.replyReference, 'the number exists, it is just not printed');
	const printed = await get('/messaging/message?id=' + sent.body.data.id + '&full=true', f.chapter);
	assert.deepEqual(
		[printed.body.data.footer.reference, printed.body.data.footer.name],
		[null, 'Alice Wren']
	);
	await Prison.updatePrison({ id: strict.id, mailRules: ['reply_sheet_allowed'] });
	const again = await get('/messaging/message?id=' + sent.body.data.id + '&full=true', f.chapter);
	assert.deepEqual(
		[again.body.data.footer.reference, again.body.data.footer.replySheetAllowed],
		[formatReference(sent.body.data.replyReference), true]
	);
	const list = await get('/prison/mail-rules');
	const tags = list.body.data.rules.map((r) => r.tag);
	assert.ok(tags.includes('no_reference_numbers') && tags.includes('reply_sheet_allowed'));
	assert.equal(
		(await MailRule.findOne({ where: { tag: 'no_reference_numbers' } })).category,
		'addressing'
	);
});

test("a volunteer looks a reference up: a typo is refused, a stranger's number is not found, the group's opens the thread", async () => {
	const sent = await post('/messaging/message', letter(), f.alice);
	const ref = sent.body.data.replyReference;
	const typo = await get(
		'/messaging/reference?number=' + (ref.slice(0, 8) + String((Number(ref[8]) + 1) % 10)),
		f.chapter
	);
	assert.equal(typo.status, 400, JSON.stringify(typo.body));
	assert.deepEqual([typo.body.name, typo.body.condition], ['ReplyReferenceError', 'checksum']);
	assert.equal((await get('/messaging/reference?number=nonsense', f.chapter)).status, 400);
	const found = await get('/messaging/reference?number=' + formatReference(ref), f.chapter);
	assert.equal(found.status, 200, JSON.stringify(found.body));
	assert.deepEqual(found.body.data, {
		reference: formatReference(ref),
		letter: {
			id: sent.body.data.id,
			chat: sent.body.data.chat,
			status: 'queued',
			paper: false,
			createdAt: sent.body.data.createdAt
		},
		mailedAt: null,
		chat: sent.body.data.chat,
		writer: {
			id: f.alice.id,
			penName: 'Alice Wren',
			name: f.alice.user.name ?? null,
			anonymous: false
		},
		prisoner: { id: f.prisoner1.id, birthName: 'Prisoner One', chosenName: 'One' },
		careOf: { id: f.group.id, name: 'Fixture Group' }
	});
	// Another group, and a writer, see nothing; a number never issued is the same nothing.
	const other = await Chapter.createChapter({
		name: 'Other',
		location: {},
		accountStatus: 'active'
	});
	const otherAdmin = await makeUser({ role: 'chapter', username: 'otheradmin' });
	await User.update({ chapterId: other.id }, { where: { id: otherAdmin.id } });
	const theirs = await get('/messaging/reference?number=' + ref, otherAdmin);
	assert.equal(theirs.status, 404);
	assert.equal(theirs.body.condition, 'unknown');
	let never = newReference();
	while (never === ref) {
		never = newReference();
	}
	assert.equal((await get('/messaging/reference?number=' + never, f.chapter)).status, 404);
	assert.equal((await get('/messaging/reference?number=' + ref, f.alice)).status, 403);
	assert.equal(
		(await get('/messaging/reference?number=' + ref, f.admin)).status,
		200,
		'a superadmin sees any'
	);
});

test('a reply filed by reference lands in the right thread and says which letter it answers', async () => {
	const sent = await post('/messaging/message', letter(), f.alice);
	const ref = sent.body.data.replyReference;
	const printed = await put(
		'/messaging/status/batch',
		{ ids: [sent.body.data.id], status: 'printed' },
		f.chapter
	);
	assert.equal(printed.status, 200, JSON.stringify(printed.body));
	const mailed = await put(
		'/messaging/status/batch',
		{ ids: [sent.body.data.id], status: 'mailed' },
		f.chapter
	);
	assert.equal(mailed.status, 200, JSON.stringify(mailed.body));
	const row = await ReplyReference.findOne({ where: { reference: ref } });
	assert.ok(row.mailedAt && row.expiresAt, 'the year starts at mailing');
	assert.ok(row.expiresAt.getTime() - row.mailedAt.getTime() >= 360 * 24 * 60 * 60 * 1000);

	const reply = await post(
		'/messaging/message',
		{ messageText: 'Thank you for writing', sender: 'prisoner', reference: formatReference(ref) },
		f.chapter
	);
	assert.equal(reply.status, 201, JSON.stringify(reply.body));
	assert.deepEqual(
		[
			reply.body.data.user,
			reply.body.data.prisoner,
			reply.body.data.chat,
			reply.body.data.repliesTo,
			reply.body.data.status
		],
		[f.alice.id, f.prisoner1.id, sent.body.data.chat, sent.body.data.id, 'received']
	);
	// The writer sees which letter was answered.
	const mine = await get('/messaging/message?id=' + reply.body.data.id, f.alice);
	assert.equal(mine.body.data.repliesTo, sent.body.data.id);
	// Ids that contradict the number are refused; a reference on an outgoing letter too.
	const wrongPrisoner = await post(
		'/messaging/message',
		{ messageText: 'x', sender: 'prisoner', reference: ref, prisoner: f.prisoner2.id },
		f.chapter
	);
	assert.equal(wrongPrisoner.status, 400);
	assert.match(wrongPrisoner.body.errors[0], /different prisoner/);
	const outgoing = await post('/messaging/message', letter({ reference: ref }), f.alice);
	assert.equal(outgoing.status, 400);
	const typo = await post(
		'/messaging/message',
		{ messageText: 'x', sender: 'prisoner', reference: '123456789' },
		f.chapter
	);
	assert.equal(typo.status, 400);
	assert.equal(typo.body.condition, 'checksum');
});

test('after the letter is deleted the number still finds the writer for a year; then it is gone', async () => {
	const sent = await post('/messaging/message', letter(), f.alice);
	const ref = sent.body.data.replyReference;
	await put('/messaging/status/batch', { ids: [sent.body.data.id], status: 'printed' }, f.chapter);
	await put('/messaging/status/batch', { ids: [sent.body.data.id], status: 'mailed' }, f.chapter);
	assert.equal((await del('/messaging/message', { id: sent.body.data.id }, f.admin)).status, 200);
	const found = await get('/messaging/reference?number=' + ref, f.chapter);
	assert.equal(found.status, 200, JSON.stringify(found.body));
	assert.equal(found.body.data.letter, null);
	assert.equal(found.body.data.writer.id, f.alice.id);
	const reply = await post(
		'/messaging/message',
		{ messageText: 'Late reply', sender: 'prisoner', reference: ref },
		f.chapter
	);
	assert.equal(reply.status, 201, JSON.stringify(reply.body));
	assert.deepEqual([reply.body.data.user, reply.body.data.repliesTo ?? null], [f.alice.id, null]);
	// A queued letter the writer deletes never had a year: its number goes at the next run.
	const draft = await post('/messaging/message', letter(), f.alice);
	await del('/messaging/message', { id: draft.body.data.id }, f.alice);
	const before = await runRetention({ log: () => {} });
	assert.ok(before.references >= 1, JSON.stringify(before));
	assert.equal(
		await ReplyReference.count({ where: { reference: draft.body.data.replyReference } }),
		0
	);
	assert.equal(
		await ReplyReference.count({ where: { reference: ref } }),
		1,
		'the mailed one waits for its year'
	);
	await ReplyReference.update(
		{ expiresAt: new Date(Date.now() - 1000) },
		{ where: { reference: ref } }
	);
	await runRetention({ log: () => {} });
	assert.equal(await ReplyReference.count({ where: { reference: ref } }), 0);
	assert.equal((await get('/messaging/reference?number=' + ref, f.chapter)).status, 404);
});

test("a reference goes with its writer's account", async () => {
	const leaver = await makeUser({ username: 'leaver', password: 'a long enough password' });
	const sent = await post('/messaging/message', letter(), leaver);
	const ref = sent.body.data.replyReference;
	assert.equal(
		(await del('/auth/user', { id: leaver.id, password: 'a long enough password' }, leaver)).status,
		200
	);
	assert.equal(await ReplyReference.count({ where: { reference: ref } }), 0);
});

test('a volunteer with a name and no number searches the writers their group mailed, by current or old pen name', async () => {
	const writer = await makeUser({ username: 'penfriend' });
	await put('/auth/user', { id: writer.id, penName: 'Old Handle' }, writer);
	await agePenNames(writer.id);
	await put('/auth/user', { id: writer.id, penName: 'New Handle' }, writer);
	await post('/messaging/message', letter(), writer);
	const byNew = await get('/messaging/writers?name=new%20han', f.chapter);
	assert.equal(byNew.status, 200, JSON.stringify(byNew.body));
	assert.ok(Array.isArray(byNew.body.data), JSON.stringify(byNew.body));
	assert.deepEqual(
		byNew.body.data.map((w) => [w.id, w.penName, w.matched]),
		[[writer.id, 'New Handle', { name: 'New Handle', current: true }]]
	);
	const byOld = await get('/messaging/writers?name=OLD', f.chapter);
	assert.deepEqual(
		byOld.body.data.map((w) => [w.id, w.matched]),
		[[writer.id, { name: 'Old Handle', current: false }]]
	);
	// Only writers whose letters this group mailed; a stranger's pen name is invisible to it.
	const stranger = await makeUser({ username: 'unmailed' });
	await put('/auth/user', { id: stranger.id, penName: 'Quiet Handle' }, stranger);
	assert.deepEqual((await get('/messaging/writers?name=quiet', f.chapter)).body.data, []);
	assert.equal(
		(await get('/messaging/writers?name=quiet', f.admin)).body.data.length,
		1,
		'a superadmin searches everyone'
	);
	assert.equal((await get('/messaging/writers?name=q', f.chapter)).status, 400);
	assert.equal((await get('/messaging/writers?name=handle', f.alice)).status, 403);
});

test('a letter made any other way (a seed, a backfill) gets its number too; a retry under one key with another reference is another request', async () => {
	const [seeded] = await Message.createBulkMessages([
		{ messageText: 'Seeded', sender: 'user', prisoner: f.prisoner1.id, user: f.alice.id }
	]);
	assert.match(seeded.replyReference, /^[0-9]{9}$/);
	assert.equal(await ReplyReference.count({ where: { message: seeded.id } }), 1);
	const [reply] = await Message.createBulkMessages([
		{ messageText: 'Seeded reply', sender: 'prisoner', prisoner: f.prisoner1.id, user: f.alice.id }
	]);
	assert.equal(reply.replyReference ?? null, null);

	const one = await post('/messaging/message', letter(), f.alice);
	const two = await post('/messaging/message', letter(), f.alice);
	const keyed = (key) => ({ ...f.chapter, headers: { 'Idempotency-Key': key } });
	const first = await post(
		'/messaging/message',
		{ messageText: 'Reply', sender: 'prisoner', reference: one.body.data.replyReference },
		keyed('reply-key-1')
	);
	assert.equal(first.status, 201, JSON.stringify(first.body));
	const again = await post(
		'/messaging/message',
		{ messageText: 'Reply', sender: 'prisoner', reference: one.body.data.replyReference },
		keyed('reply-key-1')
	);
	assert.equal(again.body.data.id, first.body.data.id, 'the same request is replayed');
	const other = await post(
		'/messaging/message',
		{ messageText: 'Reply', sender: 'prisoner', reference: two.body.data.replyReference },
		keyed('reply-key-1')
	);
	assert.equal(other.status, 422, 'a reply to another letter is not the same request');
});

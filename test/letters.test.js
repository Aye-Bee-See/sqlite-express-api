import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
	startServer,
	stopServer,
	get,
	post,
	put,
	del,
	makeFixtures,
	makeUser,
	User,
	Chapter,
	Prison,
	Prisoner
} from './helpers.js';

let f;
let admin;
let chapter;
let alice;
let otherChapter;
let relayOnlyPrison;
let relayOnlyPrisoner;
let twoRelayPrison;
let twoRelayPrisoner;
let noRelayPrisoner;

before(async () => {
	await startServer();
	f = await makeFixtures();
	admin = { token: f.admin.token };
	chapter = { token: f.chapter.token };
	alice = { token: f.alice.token };
	const otherGroup = await Chapter.createChapter({
		name: 'Other Group',
		location: {},
		accountStatus: 'active'
	});
	const other = await makeUser({ role: 'chapter', username: 'otherchapter' });
	await User.update({ chapterId: otherGroup.id }, { where: { id: other.id } });
	otherChapter = { token: other.token, group: otherGroup };

	// The fixture prison is relayed by the fixture group only.
	await Prison.addRelay(f.group.id, f.prison.id);

	relayOnlyPrison = await Prison.createPrison({
		prisonName: 'Relay Only',
		address: {},
		routing: 'relay_only'
	});
	relayOnlyPrisoner = await Prisoner.createPrisoner({
		birthName: 'Relay Only Prisoner',
		chosenName: 'RO',
		prison: relayOnlyPrison.id,
		inmateID: 'RO-1'
	});
	twoRelayPrison = await Prison.createPrison({ prisonName: 'Two Relays', address: {} });
	await Prison.addRelay(f.group.id, twoRelayPrison.id);
	await Prison.addRelay(otherGroup.id, twoRelayPrison.id);
	twoRelayPrisoner = await Prisoner.createPrisoner({
		birthName: 'Two Relay Prisoner',
		chosenName: 'TR',
		prison: twoRelayPrison.id,
		inmateID: 'TR-1'
	});
	const noRelayPrison = await Prison.createPrison({ prisonName: 'No Relays', address: {} });
	noRelayPrisoner = await Prisoner.createPrisoner({
		birthName: 'No Relay Prisoner',
		chosenName: 'NR',
		prison: noRelayPrison.id,
		inmateID: 'NR-1'
	});
});
after(stopServer);

const letter = (prisoner, extra = {}) => ({
	messageText: 'Dear friend',
	sender: 'user',
	prisoner,
	...extra
});

// ---- creation and relay resolution ---------------------------------------

test('a letter starts queued with the facility only relay group and a history row', async () => {
	const res = await post(
		'/messaging/message',
		letter(f.prisoner1.id, { relayNote: 'Two pages' }),
		alice
	);
	assert.equal(res.status, 201);
	const m = res.body.data;
	assert.equal(m.status, 'queued');
	assert.equal(m.relayChapter, f.group.id);
	assert.equal(m.relayNote, 'Two pages');
	assert.equal(m.statusChangedBy, f.alice.id);
	assert.ok(m.statusChangedAt);

	const full = await get('/messaging/message?id=' + m.id + '&full=true', alice);
	assert.equal(full.status, 200);
	assert.equal(full.body.data.relay_group.id, f.group.id);
	assert.equal(full.body.data.status_history.length, 1);
	assert.equal(full.body.data.status_history[0].fromStatus, null);
	assert.equal(full.body.data.status_history[0].toStatus, 'queued');
	const plain = await get('/messaging/message?id=' + m.id, alice);
	assert.equal(plain.body.data.status_history, undefined);
});

test('relay resolution: explicit, default, ambiguous, relay-only, and none', async () => {
	// Explicit relay group must relay for that facility.
	const wrong = await post(
		'/messaging/message',
		letter(f.prisoner1.id, { relayChapter: otherChapter.group.id }),
		alice
	);
	assert.equal(wrong.status, 400);
	assert.match(wrong.body.errors[0], /does not relay mail for this facility/);

	// Two relay groups, routing unspecified: no default, letter still accepted.
	const ambiguous = await post('/messaging/message', letter(twoRelayPrisoner.id), alice);
	assert.equal(ambiguous.status, 201);
	assert.equal(ambiguous.body.data.relayChapter, null);
	const chosen = await post(
		'/messaging/message',
		letter(twoRelayPrisoner.id, { relayChapter: otherChapter.group.id }),
		alice
	);
	assert.equal(chosen.body.data.relayChapter, otherChapter.group.id);

	// A chapter sending for a facility it relays defaults to itself.
	const own = await post(
		'/messaging/message',
		letter(twoRelayPrisoner.id, { user: f.writer.id }),
		chapter
	);
	assert.equal(own.status, 201);
	assert.equal(own.body.data.relayChapter, f.group.id);

	// relay_only with no relay group is refused; no relay groups elsewhere is fine.
	const refused = await post('/messaging/message', letter(relayOnlyPrisoner.id), alice);
	assert.equal(refused.status, 400);
	assert.match(refused.body.errors[0], /no relay group yet/);
	await Prison.addRelay(f.group.id, relayOnlyPrison.id);
	await Prison.addRelay(otherChapter.group.id, relayOnlyPrison.id);
	const choose = await post('/messaging/message', letter(relayOnlyPrisoner.id), alice);
	assert.equal(choose.status, 400);
	assert.match(choose.body.errors[0], /choose a relay group/);
	const none = await post('/messaging/message', letter(noRelayPrisoner.id), alice);
	assert.equal(none.status, 201);
	assert.equal(none.body.data.relayChapter, null);
});

test('a reply is received from the start and cannot be moved', async () => {
	const res = await post(
		'/messaging/message',
		{ messageText: 'Thanks', sender: 'prisoner', prisoner: f.prisoner1.id, user: f.writer.id },
		chapter
	);
	assert.equal(res.status, 201);
	assert.equal(res.body.data.status, 'received');
	const move = await put('/messaging/status', { id: res.body.data.id, status: 'printed' }, chapter);
	assert.equal(move.status, 409);
	assert.equal(move.body.name, 'LetterStatusError');
});

// ---- the relay group sees relayed threads --------------------------------

test('the relay group sees an independent writer letter, the other group does not', async () => {
	const mine = (await get('/messaging/messages?user=' + f.alice.id + '&page_size=100', alice)).body
		.data;
	const relayed = mine.find((m) => m.prisoner === f.prisoner1.id && m.relayChapter === f.group.id);
	assert.ok(relayed);

	const asRelay = await get('/messaging/message?id=' + relayed.id, chapter);
	assert.equal(asRelay.status, 200);
	const list = await get(
		'/messaging/messages?relayChapter=' + f.group.id + '&page_size=100',
		chapter
	);
	assert.ok(list.body.data.some((m) => m.id === relayed.id));
	const byStatus = await get('/messaging/messages?status=queued&page_size=100', chapter);
	assert.ok(byStatus.body.data.every((m) => m.status === 'queued'));
	assert.ok(byStatus.body.data.some((m) => m.id === relayed.id));
	assert.equal((await get('/messaging/messages?status=lost', chapter)).status, 400);

	const chats = await get('/chat/chats?page_size=100', chapter);
	const aliceChat = chats.body.data.find(
		(c) => c.user === f.alice.id && c.prisoner === f.prisoner1.id
	);
	assert.ok(aliceChat, 'relayed chat is listed');
	assert.equal(aliceChat.last_message.status, 'queued');
	assert.equal((await get('/chat/chat?id=' + aliceChat.id, chapter)).status, 200);
	const byChat = await get('/messaging/messages?chat=' + aliceChat.id, chapter);
	assert.ok(byChat.body.data.some((m) => m.id === relayed.id));

	assert.equal((await get('/messaging/message?id=' + relayed.id, otherChapter)).status, 403);
	assert.equal((await get('/chat/chat?id=' + aliceChat.id, otherChapter)).status, 403);
	assert.ok(
		!(await get('/chat/chats?page_size=100', otherChapter)).body.data.some(
			(c) => c.id === aliceChat.id
		)
	);

	// The relay group may record the prisoner's reply, but not write as alice.
	const reply = await post(
		'/messaging/message',
		{ messageText: 'Reply', sender: 'prisoner', prisoner: f.prisoner1.id, user: f.alice.id },
		chapter
	);
	assert.equal(reply.status, 201);
	assert.equal(reply.body.data.status, 'received');
	const asAlice = await post(
		'/messaging/message',
		letter(f.prisoner1.id, { user: f.alice.id }),
		chapter
	);
	assert.equal(asAlice.status, 403);
	// A reply on a thread the group does not relay is refused.
	const stranger = await post(
		'/messaging/message',
		{ messageText: 'Reply', sender: 'prisoner', prisoner: f.prisoner2.id, user: f.alice.id },
		chapter
	);
	assert.equal(stranger.status, 403);
});

// ---- status transitions ---------------------------------------------------

test('the relay group moves a letter queued -> printed -> mailed, forward only', async () => {
	const { id } = (await post('/messaging/message', letter(f.prisoner1.id), alice)).body.data;

	assert.equal((await put('/messaging/status', { id, status: 'printed' }, alice)).status, 403);
	assert.equal(
		(await put('/messaging/status', { id, status: 'printed' }, otherChapter)).status,
		403
	);
	assert.equal((await put('/messaging/status', { id, status: 'mailed' }, chapter)).status, 409);
	const bad = await put('/messaging/status', { id, status: 'lost' }, chapter);
	assert.equal(bad.status, 400);
	assert.match(bad.body.errors[0], /Status must be one of/);
	assert.equal(
		(await put('/messaging/status', { id: 999999, status: 'printed' }, admin)).status,
		404
	);

	const printed = await put('/messaging/status', { id, status: 'printed' }, chapter);
	assert.equal(printed.status, 200);
	assert.equal(printed.body.data.status, 'printed');
	assert.equal(printed.body.data.statusChangedBy, f.chapter.id);
	assert.equal(printed.body.data.status_history.length, 2);
	assert.equal(printed.body.data.status_history[1].fromStatus, 'queued');

	assert.equal((await put('/messaging/status', { id, status: 'queued' }, chapter)).status, 409);
	const mailed = await put('/messaging/status', { id, status: 'mailed' }, admin);
	assert.equal(mailed.status, 200);
	assert.equal(mailed.body.data.status_history.length, 3);
	assert.equal((await put('/messaging/status', { id, status: 'printed' }, admin)).status, 409);

	const inbox = await get('/messaging/messages?status=mailed&page_size=100', alice);
	assert.ok(inbox.body.data.some((m) => m.id === id));
});

test('a letter is editable and deletable only while queued, except by admins', async () => {
	const { id } = (await post('/messaging/message', letter(f.prisoner1.id), alice)).body.data;
	assert.equal((await put('/messaging/message', { id, messageText: 'Edited' }, alice)).status, 200);
	// Status cannot be smuggled through the general update.
	await put('/messaging/message', { id, status: 'mailed' }, alice);
	assert.equal((await get('/messaging/message?id=' + id, alice)).body.data.status, 'queued');

	await put('/messaging/status', { id, status: 'printed' }, chapter);
	const edit = await put('/messaging/message', { id, messageText: 'Too late' }, alice);
	assert.equal(edit.status, 403);
	assert.match(edit.body.info, /can no longer be edited/);
	assert.equal((await del('/messaging/message', { id }, alice)).status, 403);
	assert.equal(
		(await put('/messaging/message', { id, messageText: 'Too late' }, chapter)).status,
		403
	);
	assert.equal(
		(await put('/messaging/message', { id, messageText: 'Admin fix' }, admin)).status,
		200
	);

	const fresh = (await post('/messaging/message', letter(f.prisoner1.id), alice)).body.data;
	assert.equal((await del('/messaging/message', { id: fresh.id }, alice)).status, 200);
	assert.equal((await del('/messaging/message', { id }, admin)).status, 200);
});

test('changing the relay group on edit is validated the same way as on create', async () => {
	const { id } = (await post('/messaging/message', letter(twoRelayPrisoner.id), alice)).body.data;
	const bad = await put('/messaging/message', { id, relayChapter: 999999 }, alice);
	assert.equal(bad.status, 400);
	const ok = await put('/messaging/message', { id, relayChapter: otherChapter.group.id }, alice);
	assert.equal(ok.status, 200);
	assert.equal(
		(await get('/messaging/message?id=' + id, alice)).body.data.relayChapter,
		otherChapter.group.id
	);
	// Now the other group relays it and can print it; the fixture group cannot.
	assert.equal((await put('/messaging/status', { id, status: 'printed' }, chapter)).status, 403);
	assert.equal(
		(await put('/messaging/status', { id, status: 'printed' }, otherChapter)).status,
		200
	);
});

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
	Prisoner
} from './helpers.js';
import Notification from '../database/models/notification.model.js';
import AuditLog from '../database/models/audit-log.model.js';

let f;
let north; // a second facility, mailed by a second group
let northGroup;
let northMember;
let crowded; // relay-only, with two groups: the writer has to choose

before(async () => {
	await startServer();
	f = await makeFixtures();
	await Prison.addRelay(f.group.id, f.prison.id);
	northGroup = await Chapter.createChapter({
		name: 'North Relay',
		location: {},
		accountStatus: 'active'
	});
	northMember = await makeUser({ role: 'chapter', username: 'northmember' });
	await User.update({ chapterId: northGroup.id }, { where: { id: northMember.id } });
	north = await Prison.createPrison({ prisonName: 'North Prison', address: { street: '2 North' } });
	await Prison.addRelay(northGroup.id, north.id);
	crowded = await Prison.createPrison({
		prisonName: 'Crowded Prison',
		address: { street: '3 Busy' },
		routing: 'relay_only'
	});
	await Prison.addRelay(f.group.id, crowded.id);
	await Prison.addRelay(northGroup.id, crowded.id);
});
after(stopServer);

const person = async (name, prison = f.prison.id) =>
	await Prisoner.createPrisoner({
		birthName: name,
		prison,
		inmateID: name,
		status: 'incarcerated'
	});

const write = async (who, prisoner, text = 'Dear friend') => {
	const res = await post(
		'/messaging/message',
		{ prisoner, messageText: text, sender: 'user' },
		who
	);
	assert.equal(res.status, 201, JSON.stringify(res.body));
	return res.body.data;
};

const lastTold = async (userId, event) =>
	await Notification.findOne({ where: { userId, event }, order: [['id', 'DESC']] });

test('when someone is moved, their writers are told and queued letters follow them', async () => {
	const mover = await person('Mover');
	const queued = await write(f.alice, mover.id);
	assert.equal(queued.relayChapter, f.group.id);
	const printed = await write(f.bob, mover.id);
	assert.equal(
		(await put('/messaging/status', { id: printed.id, status: 'printed' }, f.chapter)).status,
		200
	);

	const res = await put('/prisoner/prisoner', { id: mover.id, prison: north.id }, f.chapter);
	assert.equal(res.status, 200, JSON.stringify(res.body));
	assert.deepEqual(res.body.data.mail, {
		moved: true,
		freed: false,
		rerouted: 1,
		held: 0,
		released: 0
	});

	// The queued letter goes to the group that serves the new facility, which is told it is waiting.
	const routed = await Message.findByPk(queued.id);
	assert.equal(routed.relayChapter, northGroup.id);
	assert.equal(routed.heldReason, null);
	assert.ok(
		await Notification.findOne({
			where: { userId: northMember.id, event: 'letter.queued', message: queued.id }
		})
	);
	const entry = await AuditLog.findOne({
		where: { action: 'letter.rerouted', targetId: queued.id }
	});
	assert.deepEqual(entry.details, {
		from: f.group.id,
		to: northGroup.id,
		because: 'prisoner.moved'
	});
	// What was already printed is on paper, addressed: it is left alone.
	assert.equal((await Message.findByPk(printed.id)).relayChapter, f.group.id);

	// Everyone with a thread is told, with ids only.
	for (const writer of [f.alice, f.bob]) {
		const told = await lastTold(writer.id, 'prisoner.moved');
		assert.ok(told, 'told ' + writer.id);
		assert.deepEqual(told.detail, { prisoner: mover.id, prison: north.id, held: 0 });
		assert.ok(told.chat);
	}
	// An edit that moves nobody tells nobody.
	const count = await Notification.count({ where: { event: 'prisoner.moved' } });
	const quiet = await put('/prisoner/prisoner', { id: mover.id, chosenName: 'Mo' }, f.chapter);
	assert.equal(quiet.body.data.mail, undefined);
	assert.equal(await Notification.count({ where: { event: 'prisoner.moved' } }), count);
});

test('where the writer has to choose who mails it now, the letter is held until they do', async () => {
	const mover = await person('Chooser');
	const letter = await write(f.alice, mover.id);
	const res = await put('/prisoner/prisoner', { id: mover.id, prison: crowded.id }, f.admin);
	assert.deepEqual(res.body.data.mail, {
		moved: true,
		freed: false,
		rerouted: 0,
		held: 0,
		released: 0
	});
	// The group that had it serves the new facility too, so it simply keeps it.
	assert.equal((await Message.findByPk(letter.id)).heldReason, null);

	// From a facility only the north group serves, to the crowded one: north keeps it as well.
	// From one nobody here serves to the crowded one: somebody must choose.
	const lonely = await Prison.createPrison({ prisonName: 'Lonely', address: { street: '4 Far' } });
	const other = await person('Undecided', lonely.id);
	const waiting = await write(f.alice, other.id);
	assert.equal(waiting.relayChapter, null);
	const moved = await put('/prisoner/prisoner', { id: other.id, prison: crowded.id }, f.admin);
	assert.equal(moved.body.data.mail.held, 1);
	assert.equal((await Message.findByPk(waiting.id)).heldReason, 'choose_relay');
	assert.equal((await lastTold(f.alice.id, 'prisoner.moved')).detail.held, 1);
	// The inbox can mark the thread that needs its writer without loading its letters.
	const inbox = await get('/chat/chats?page_size=100', f.alice);
	const byChat = new Map(inbox.body.data.map((c) => [c.id, [c.heldCount, c.heldReasons]]));
	assert.deepEqual(byChat.get(waiting.chat), [1, ['choose_relay']]);
	assert.deepEqual(byChat.get(letter.chat), [0, []]);
	const one = await get('/chat/chat?id=' + waiting.chat, f.alice);
	assert.deepEqual([one.body.data.heldCount, one.body.data.heldReasons], [1, ['choose_relay']]);
	const held = await get('/messaging/messages?held=true', f.alice);
	assert.deepEqual(
		held.body.data.map((m) => m.id),
		[waiting.id]
	);

	// Choosing answers the question.
	const chosen = await put(
		'/messaging/message',
		{ id: waiting.id, relayChapter: northGroup.id },
		f.alice
	);
	assert.equal(chosen.status, 200, JSON.stringify(chosen.body));
	const stored = await Message.findByPk(waiting.id);
	assert.deepEqual([stored.relayChapter, stored.heldReason], [northGroup.id, null]);
});

test('when someone is freed, their writers are told and queued letters wait for a decision', async () => {
	const leaver = await person('Leaver');
	const letter = await write(f.alice, leaver.id);
	const res = await put('/prisoner/prisoner', { id: leaver.id, status: 'free' }, f.chapter);
	assert.deepEqual(res.body.data.mail, {
		moved: false,
		freed: true,
		rerouted: 0,
		held: 1,
		released: 0
	});
	assert.equal((await Message.findByPk(letter.id)).heldReason, 'prisoner_free');
	assert.deepEqual((await lastTold(f.alice.id, 'prisoner.status')).detail, {
		prisoner: leaver.id,
		status: 'free',
		held: 1
	});

	// Printing it is a decision, not an oversight.
	const blind = await put('/messaging/status', { id: letter.id, status: 'printed' }, f.chapter);
	assert.equal(blind.status, 409);
	assert.equal(blind.body.name, 'LetterHeldError');
	const knowing = await put(
		'/messaging/status',
		{ id: letter.id, status: 'printed', release: true },
		f.chapter
	);
	assert.equal(knowing.status, 200, JSON.stringify(knowing.body));
	assert.equal(knowing.body.data.heldReason, null);

	// The news was wrong: the hold on what is still queued is lifted.
	const second = await write(f.bob, leaver.id);
	await Message.update({ heldReason: 'prisoner_free' }, { where: { id: second.id } });
	const back = await put(
		'/prisoner/prisoner',
		{ id: leaver.id, status: 'incarcerated' },
		f.chapter
	);
	assert.equal(back.body.data.mail.released, 1);
	assert.equal((await Message.findByPk(second.id)).heldReason, null);
});

test('an approved proposal that moves someone has the same effect as a direct edit', async () => {
	const mover = await person('Proposed');
	const letter = await write(f.alice, mover.id);
	const proposal = await post(
		'/moderation/submission',
		{ resource: 'prisoner', target: mover.id, fields: { prison: north.id } },
		f.bob
	);
	assert.equal(proposal.status, 201, JSON.stringify(proposal.body));
	const approved = await put('/moderation/approve', { id: proposal.body.data.id }, f.admin);
	assert.equal(approved.status, 200, JSON.stringify(approved.body));
	assert.equal((await Message.findByPk(letter.id)).relayChapter, northGroup.id);
	assert.equal((await lastTold(f.alice.id, 'prisoner.moved')).detail.prisoner, mover.id);
});

test('nobody can set or clear a hold by editing the letter', async () => {
	const someone = await person('Steady');
	const letter = await write(f.alice, someone.id);
	await put('/messaging/message', { id: letter.id, heldReason: 'prisoner_free' }, f.alice);
	assert.equal((await Message.findByPk(letter.id)).heldReason, null);
	await Message.update({ heldReason: 'prisoner_free' }, { where: { id: letter.id } });
	await put(
		'/messaging/message',
		{ id: letter.id, heldReason: null, messageText: 'Edited' },
		f.alice
	);
	assert.equal((await Message.findByPk(letter.id)).heldReason, 'prisoner_free');
	assert.equal((await get('/messaging/messages?held=maybe', f.alice)).status, 400);
});

test('the count a writer is told includes letters that were already waiting', async () => {
	const someone = await person('Twice');
	const letter = await write(f.alice, someone.id);
	await put('/prisoner/prisoner', { id: someone.id, status: 'free' }, f.chapter);
	assert.equal((await lastTold(f.alice.id, 'prisoner.status')).detail.held, 1);

	// Still free, and now the record says they were moved as well. Nothing new is held
	// by this edit, and Alice's letter is waiting all the same.
	const res = await put('/prisoner/prisoner', { id: someone.id, prison: north.id }, f.chapter);
	assert.equal(res.body.data.mail.held, 0, 'the editor is told what this edit newly held');
	assert.equal((await Message.findByPk(letter.id)).heldReason, 'prisoner_free');
	assert.equal((await lastTold(f.alice.id, 'prisoner.moved')).detail.held, 1);
});

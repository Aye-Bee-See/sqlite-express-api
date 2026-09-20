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
	login,
	User,
	Chapter,
	Chat,
	Message,
	Prison,
	Prisoner,
	sequelize
} from './helpers.js';
import MailRule from '../database/models/mail-rule.model.js';

/**
 * One test per finding of the September 2026 audit, so none of them comes back.
 */

let f;
/** A second active group that relays for the fixture prison and manages nobody in these threads. */
let relay;

before(async () => {
	await startServer();
	f = await makeFixtures();
	const group = await Chapter.createChapter({
		name: 'Relay Only',
		location: {},
		accountStatus: 'active'
	});
	const member = await makeUser({ role: 'chapter', username: 'relaymember' });
	await User.update({ chapterId: group.id }, { where: { id: member.id } });
	await Prison.addRelay(group.id, f.prison.id);
	relay = { group, member };
	await Prisoner.update(
		{ verificationNotes: 'source: a confidential contact' },
		{ where: { id: f.prisoner1.id } }
	);
});

after(async () => {
	await stopServer();
});

/** Alice writes to prisoner one through the relay group; returns the letter. */
async function aliceWrites(text = 'Hello from Alice') {
	const res = await post(
		'/messaging/message',
		{ prisoner: f.prisoner1.id, messageText: text, sender: 'user', relayChapter: relay.group.id },
		f.alice
	);
	assert.equal(res.status, 201, JSON.stringify(res.body));
	return res.body.data;
}

// Account takeover

test('PUT /auth/user cannot plant a recovery challenge', async () => {
	const res = await put(
		'/auth/user',
		{
			id: f.bob.id,
			recoveryChallengeHash: 'abc',
			recoveryChallengeExpiresAt: '2099-01-01T00:00:00Z'
		},
		f.bob
	);
	assert.equal(res.status, 400, JSON.stringify(res.body));
	assert.match(res.body.errors[0], /recoveryChallengeHash/);
	const stored = await User.scope('withKeys').findByPk(f.bob.id);
	assert.equal(stored.recoveryChallengeHash, null);
});

test('the user model writes no column a profile update has no business with', async () => {
	const before = await User.findByPk(f.bob.id);
	await User.updateUser({
		id: f.bob.id,
		bio: 'still bob, only more so',
		createdAt: new Date(0),
		sessionsRevokedAt: new Date(),
		recoveryChallengeHash: 'abc'
	});
	const stored = await User.scope('withKeys').findByPk(f.bob.id);
	assert.equal(stored.bio, 'still bob, only more so');
	assert.equal(stored.createdAt.getTime(), before.createdAt.getTime());
	assert.equal(stored.sessionsRevokedAt, null);
	assert.equal(stored.recoveryChallengeHash, null);
});

// Leaks through the thread embeds

test('a thread read with full=true keeps staff notes and private user fields to itself', async () => {
	await aliceWrites();
	await User.update({ managerNote: 'met at the March night' }, { where: { id: f.alice.id } });
	for (const reader of [f.alice, relay.member]) {
		const list = await get('/chat/chats?full=true', reader);
		assert.equal(list.status, 200);
		const chat = list.body.data.find((c) => c.user === f.alice.id);
		assert.ok(chat, 'the thread is listed');
		assert.equal(chat.prisoner_details.chosenName, 'One');
		assert.deepEqual(Object.keys(chat.user_details).sort(), [
			'anonymousForChapter',
			'bio',
			'chapterId',
			'claimedAt',
			'id',
			'managedBy',
			'name',
			'publicKey',
			'role',
			'username'
		]);
		const one = await get('/chat/chat?id=' + chat.id + '&full=true', reader);
		assert.equal(one.status, 200);
		assert.ok(!JSON.stringify(one.body).includes('met at the March night'));
		assert.ok(!JSON.stringify(one.body).includes('@example.com'));
	}
	// A plain user never sees the verification notes; an active group's account does.
	const asAlice = JSON.stringify((await get('/chat/chats?full=true', f.alice)).body);
	assert.ok(!asAlice.includes('confidential contact'));
	const asRelay = JSON.stringify((await get('/chat/chats?full=true', relay.member)).body);
	assert.ok(asRelay.includes('confidential contact'));
});

// A group that only mails a thread does not own it

test('a relay group can read a thread and cannot delete, move, or rewrite it', async () => {
	const letter = await aliceWrites('Do not touch');
	const chat = await Chat.findOne({ where: { user: f.alice.id, prisoner: f.prisoner1.id } });
	assert.equal((await get('/chat/chat?id=' + chat.id, relay.member)).status, 200);

	assert.equal((await del('/chat/chat', { id: chat.id }, relay.member)).status, 403);
	assert.equal(
		(await put('/chat/chat', { id: chat.id, prisoner: f.prisoner2.id }, relay.member)).status,
		403
	);
	const edit = await put(
		'/messaging/message',
		{ id: letter.id, messageText: 'rewritten by the relay' },
		relay.member
	);
	assert.equal(edit.status, 403, JSON.stringify(edit.body));
	assert.equal((await del('/messaging/message', { id: letter.id }, relay.member)).status, 403);
	assert.equal((await Message.findByPk(letter.id)).messageText, 'Do not touch');
	assert.ok(await Chat.findByPk(chat.id));
});

test('a relay group can still correct a reply it recorded', async () => {
	await aliceWrites();
	const reply = await post(
		'/messaging/message',
		{ prisoner: f.prisoner1.id, user: f.alice.id, sender: 'prisoner', messageText: 'Thanks Alise' },
		relay.member
	);
	assert.equal(reply.status, 201, JSON.stringify(reply.body));
	const fixed = await put(
		'/messaging/message',
		{ id: reply.body.data.id, messageText: 'Thanks Alice' },
		relay.member
	);
	assert.equal(fixed.status, 200, JSON.stringify(fixed.body));
});

test('a thread with mailed letters cannot be deleted by its writer, nor moved once it has letters', async () => {
	const pal = await makeUser({ username: 'carol' });
	const sent = await post(
		'/messaging/message',
		{ prisoner: f.prisoner2.id, messageText: 'Dear Two', sender: 'user' },
		pal
	);
	assert.equal(sent.status, 201);
	const chat = await Chat.findOne({ where: { user: pal.id, prisoner: f.prisoner2.id } });
	const moved = await put('/chat/chat', { id: chat.id, prisoner: f.prisoner1.id }, pal);
	assert.equal(moved.status, 403);
	await Message.update({ status: 'mailed' }, { where: { id: sent.body.data.id } });
	const gone = await del('/chat/chat', { id: chat.id }, pal);
	assert.equal(gone.status, 403);
	assert.match(JSON.stringify(gone.body), /printed or mailed/);
	assert.ok(await Message.findByPk(sent.body.data.id));
});

test('PUT /messaging/message cannot move a letter into another thread or change who sent it', async () => {
	const letter = await aliceWrites('Mine');
	const bobs = await post(
		'/messaging/message',
		{ prisoner: f.prisoner2.id, messageText: 'Bob here', sender: 'user' },
		f.bob
	);
	const bobChat = bobs.body.data.chat;
	const res = await put(
		'/messaging/message',
		{ id: letter.id, chat: bobChat, sender: 'prisoner', createdAt: '2001-01-01T00:00:00Z' },
		f.alice
	);
	assert.equal(res.status, 200, JSON.stringify(res.body));
	const stored = await Message.findByPk(letter.id);
	assert.notEqual(stored.chat, bobChat);
	assert.equal(stored.sender, 'user');
	assert.ok(stored.createdAt.getFullYear() > 2001);
});

test('a letter moved to a prisoner elsewhere is routed again', async () => {
	const elsewhere = await Prison.createPrison({
		prisonName: 'Elsewhere',
		address: { street: '9 Far' }
	});
	const three = await Prisoner.createPrisoner({
		birthName: 'Prisoner Three',
		chosenName: 'Three',
		prison: elsewhere.id,
		inmateID: 'P-3'
	});
	const letter = await aliceWrites('To be moved');
	assert.equal(letter.relayChapter, relay.group.id);
	const res = await put('/messaging/message', { id: letter.id, prisoner: three.id }, f.alice);
	assert.equal(res.status, 200, JSON.stringify(res.body));
	// The relay group does not serve the new facility, and nobody does.
	assert.equal((await Message.findByPk(letter.id)).relayChapter, null);
});

// Sign-in

test('sign-in refuses credentials in the URL and credentials that are not text', async () => {
	const inUrl = await post('/auth/login?username=alice&password=' + f.alice.password, {});
	assert.equal(inUrl.status, 400);
	assert.match(inUrl.body.errors[0], /never in the URL/);
	// A number reached bcrypt and answered 500 for real accounts only: a way to find them.
	for (const username of ['alice', 'nobody-by-this-name']) {
		const res = await post('/auth/login', { username, password: 1234567 });
		assert.equal(res.status, 400);
		assert.deepEqual(res.body, { success: false, errors: ['username and password must be text.'] });
	}
});

// Names the API keeps for itself

test('nobody can take the name of a group anonymous writer, or a placeholder address', async () => {
	const reg = await post('/auth/user', {
		username: 'anon-' + relay.group.id,
		password: 'longenough',
		email: 'squatter@example.com'
	});
	assert.equal(reg.status, 400, JSON.stringify(reg.body));
	const rename = await put('/auth/user', { id: f.bob.id, username: 'Writer-abc' }, f.bob);
	assert.equal(rename.status, 400);
	const email = await put(
		'/auth/user',
		{ id: f.bob.id, email: 'writer-anon-' + relay.group.id + '@managed.example' },
		f.bob
	);
	assert.equal(email.status, 400);
	// The group still gets its anonymous writer.
	const anon = await User.anonymousWriterFor(relay.group.id);
	assert.equal(anon.username, 'anon-' + relay.group.id);
});

test('a group can still edit a managed writer whose placeholder address is sent back unchanged', async () => {
	const writer = await User.findByPk(f.writer.id);
	const res = await put(
		'/auth/user',
		{ id: writer.id, name: 'Renamed Writer', email: writer.email },
		f.chapter
	);
	assert.equal(res.status, 200, JSON.stringify(res.body));
});

// Claims

test('a claim needs a username and a password, and leaves the token usable when it fails', async () => {
	const w = (await post('/auth/writer', { name: 'To Claim' }, f.chapter)).body.data;
	const { token } = (await post('/auth/writer/token', { writer: w.id }, f.chapter)).body.data;
	const bare = await post('/auth/claim', { token });
	assert.equal(bare.status, 400, JSON.stringify(bare.body));
	assert.equal((await User.findByPk(w.id)).claimedAt, null);
	const taken = await post('/auth/claim', { token, username: 'alice', password: 'longenough' });
	assert.equal(taken.status, 400);
	assert.equal((await get('/auth/claim?token=' + token)).status, 200);
});

test('two claims with one token: one account, one winner', async () => {
	const w = (await post('/auth/writer', { name: 'Raced' }, f.chapter)).body.data;
	const { token } = (await post('/auth/writer/token', { writer: w.id }, f.chapter)).body.data;
	const results = await Promise.all([
		post('/auth/claim', { token, username: 'racer-one', password: 'longenough1' }),
		post('/auth/claim', { token, username: 'racer-two', password: 'longenough2' })
	]);
	const statuses = results.map((r) => r.status).sort();
	assert.equal(statuses[0], 201, JSON.stringify(results.map((r) => r.body)));
	assert.ok(statuses[1] >= 400, 'the second claim is refused');
	const winner = results.find((r) => r.status === 201).body.data.username;
	assert.equal((await User.findByPk(w.id)).username, winner);
	await login(winner, winner === 'racer-one' ? 'longenough1' : 'longenough2');
});

// Pending and suspended groups

test('an account of a group that is not active reads what the public reads', async () => {
	const pending = await Chapter.createChapter({ name: 'Not Yet', location: {} });
	const member = await makeUser({ role: 'chapter', username: 'pendingmember' });
	await User.update({ chapterId: pending.id }, { where: { id: member.id } });
	const hidden = await Prisoner.createPrisoner({
		birthName: 'Unpublished Person',
		prison: f.prison.id,
		inmateID: 'P-H',
		recordStatus: 'pending'
	});
	for (const status of ['pending', 'suspended']) {
		await Chapter.update({ accountStatus: status }, { where: { id: pending.id } });
		const one = await get('/prisoner/prisoner?id=' + f.prisoner1.id, member);
		assert.equal(one.status, 200);
		assert.equal(one.body.data.verificationNotes, undefined, status);
		const list = await get('/prisoner/prisoners?page_size=100&recordStatus=pending', member);
		assert.ok(!list.body.data.some((p) => p.id === hidden.id), status);
		assert.equal((await get('/auth/member-keys?chapter=' + pending.id, member)).status, 403);
	}
	await Chapter.update({ accountStatus: 'active' }, { where: { id: pending.id } });
	const asStaff = await get('/prisoner/prisoner?id=' + f.prisoner1.id, member);
	assert.equal(asStaff.body.data.verificationNotes, 'source: a confidential contact');
});

// One id is one value

test('a list of ids is refused everywhere, and a missing id is a 400', async () => {
	const many = await del('/prisoner/prisoner', { id: [f.prisoner1.id, f.prisoner2.id] }, f.admin);
	assert.equal(many.status, 400);
	assert.deepEqual(many.body.errors, ['id must be a single value.']);
	assert.equal(await Prisoner.count({ where: { id: [f.prisoner1.id, f.prisoner2.id] } }), 2);
	const query = await get('/prisoner/prisoner?id=1&id=2');
	assert.equal(query.status, 400);
	const none = await put('/prisoner/prisoner', { chosenName: 'Nobody' }, f.admin);
	assert.equal(none.status, 400, JSON.stringify(none.body));
	assert.deepEqual(none.body.errors, ['id is required.']);
});

test('names every object has are not sort orders or resources, and a page has an upper bound', async () => {
	const sort = await get('/prisoner/prisoners?sort=constructor');
	assert.equal(sort.status, 400);
	const resource = await post(
		'/moderation/submission',
		{ resource: 'constructor', fields: { a: 1 } },
		f.alice
	);
	assert.equal(resource.status, 400);
	const page = await get('/prisoner/prisoners?page=1e21');
	assert.equal(page.status, 400);
});

test('directory updates write directory fields only', async () => {
	const before = await Prisoner.findByPk(f.prisoner2.id);
	const res = await put(
		'/prisoner/prisoner',
		{ id: f.prisoner2.id, chosenName: 'Deux', createdAt: '2001-01-01T00:00:00Z' },
		f.admin
	);
	assert.equal(res.status, 200);
	const stored = await Prisoner.findByPk(f.prisoner2.id);
	assert.equal(stored.chosenName, 'Deux');
	assert.equal(stored.createdAt.getTime(), before.createdAt.getTime());
});

// Moderation

test('a reviewer sees the rule set a proposal would replace, and is not made to approve a revision unread', async () => {
	await MailRule.createRule({
		tag: 'audit_no_stickers',
		category: 'enclosures',
		label: 'No stickers (audit)'
	});
	await MailRule.createRule({
		tag: 'audit_white_paper',
		category: 'enclosures',
		label: 'White paper only (audit)'
	});
	await Prison.updatePrison({ id: f.prison.id, mailRules: ['audit_no_stickers'] });
	const proposed = await post(
		'/moderation/submission',
		{ resource: 'prison', target: f.prison.id, fields: { mailRules: ['audit_white_paper'] } },
		f.alice
	);
	assert.equal(proposed.status, 201, JSON.stringify(proposed.body));
	const id = proposed.body.data.id;
	const read = await get('/moderation/submission?id=' + id, f.admin);
	assert.deepEqual(read.body.data.current, { mailRules: ['audit_no_stickers'] });
	const seen = read.body.data.updatedAt;

	await new Promise((resolve) => setTimeout(resolve, 5));
	const revised = await put(
		'/moderation/submission',
		{ id, fields: { notes: 'Swapped in after the review' } },
		f.alice
	);
	assert.equal(revised.status, 200, JSON.stringify(revised.body));
	const stale = await put('/moderation/approve', { id, ifUnchangedSince: seen }, f.admin);
	assert.equal(stale.status, 409, JSON.stringify(stale.body));
	assert.equal(stale.body.name, 'SubmissionChangedError');
	const fresh = (await get('/moderation/submission?id=' + id, f.admin)).body.data.updatedAt;
	const ok = await put('/moderation/approve', { id, ifUnchangedSince: fresh }, f.admin);
	assert.equal(ok.status, 200, JSON.stringify(ok.body));
});

test('the tables behind these tests are intact', async () => {
	const [rows] = await sequelize.query('PRAGMA foreign_key_check');
	assert.deepEqual(rows, []);
});

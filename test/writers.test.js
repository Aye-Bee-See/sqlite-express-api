import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
	startServer,
	stopServer,
	get,
	post,
	put,
	del,
	login,
	makeFixtures,
	makeUser,
	User,
	Chapter,
	ClaimToken,
	Message
} from './helpers.js';

let f;
let admin;
let chapter;
let alice;
let otherChapter;

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
});
after(stopServer);

// ---- creating writers -----------------------------------------------------

test('a chapter member creates a writer under its own group', async () => {
	const res = await post('/auth/writer', { name: 'Sam', managerNote: 'Tuesday nights' }, chapter);
	assert.equal(res.status, 201);
	const w = res.body.data;
	assert.equal(w.managedBy, f.group.id);
	assert.equal(w.claimedAt, null);
	assert.equal(w.role, 'user');
	assert.equal(w.managerNote, 'Tuesday nights');
	assert.ok(w.username.startsWith('writer-'));
	assert.ok(w.email.endsWith('@managed.example'));
	assert.equal(w.password, undefined);
});

test('an email may be given; name is required; a chapter cannot pick another group', async () => {
	const withEmail = await post('/auth/writer', { name: 'Joan', email: 'jo@example.com' }, chapter);
	assert.equal(withEmail.status, 201);
	assert.equal(withEmail.body.data.email, 'jo@example.com');
	assert.equal((await post('/auth/writer', { email: 'x@example.com' }, chapter)).status, 400);
	const elsewhere = await post(
		'/auth/writer',
		{ name: 'Xavier', chapter: otherChapter.group.id },
		chapter
	);
	assert.equal(elsewhere.status, 201);
	assert.equal(elsewhere.body.data.managedBy, f.group.id, 'chapter argument is ignored');
});

test('an admin must name the chapter; users and groupless chapters may not create writers', async () => {
	assert.equal((await post('/auth/writer', { name: 'X' }, admin)).status, 403);
	const ok = await post('/auth/writer', { name: 'Adminmade', chapter: f.group.id }, admin);
	assert.equal(ok.status, 201);
	assert.equal(ok.body.data.managedBy, f.group.id);
	assert.equal((await post('/auth/writer', { name: 'X', chapter: 999999 }, admin)).status, 404);
	assert.equal((await post('/auth/writer', { name: 'X' }, alice)).status, 403);
	const groupless = await makeUser({ role: 'chapter', username: 'nogroup' });
	const res = await post('/auth/writer', { name: 'X' }, { token: groupless.token });
	assert.equal(res.status, 403);
	assert.match(res.body.info, /not a member of a group/);
});

test('an unclaimed writer cannot log in', async () => {
	const writer = await User.findByPk(f.writer.id);
	const res = await post('/auth/login', { username: writer.username, password: 'anything' });
	assert.equal(res.status, 401);
});

// ---- listing --------------------------------------------------------------

test('writer lists are scoped to the group; admins see all or one group', async () => {
	const mine = await get('/auth/writers?page_size=100', chapter);
	assert.equal(mine.status, 200);
	assert.ok(mine.body.data.length >= 4);
	assert.ok(mine.body.data.every((w) => w.managedBy === f.group.id));
	assert.ok(mine.body.data.every((w) => w.password === undefined));
	assert.ok(mine.body.data.every((w) => 'claimToken' in w));

	const theirs = await get('/auth/writers?page_size=100', otherChapter);
	assert.deepEqual(theirs.body.data, []);

	const all = await get('/auth/writers?page_size=100', admin);
	assert.ok(all.body.data.length >= mine.body.data.length);
	const one = await get('/auth/writers?chapter=' + f.group.id + '&page_size=100', admin);
	assert.equal(one.body.data.length, mine.body.data.length);
	const search = await get('/auth/writers?q=Adminmade', chapter);
	assert.equal(search.body.data.length, 1);

	assert.equal((await get('/auth/writers', alice)).status, 403);
});

test('the manager note is hidden from everyone but the managing group and admins', async () => {
	const res = await get('/auth/user?id=' + f.writer.id, otherChapter);
	assert.equal(res.status, 403);
	const asAdmin = await get('/auth/user?id=' + f.writer.id, admin);
	assert.equal(asAdmin.status, 200);
	assert.equal('managerNote' in asAdmin.body.data, true);
	const asManager = await get('/auth/user?id=' + f.writer.id, chapter);
	assert.equal(asManager.status, 200);
	assert.equal('managerNote' in asManager.body.data, true);
	const self = await get('/auth/user?id=' + f.alice.id, alice);
	assert.equal('managerNote' in self.body.data, false);
	const list = await get('/auth/users?page_size=100', admin);
	assert.ok(list.body.data.every((u) => 'managerNote' in u));
});

// ---- editing / deleting managed accounts ---------------------------------

test('a chapter may edit name, email, and note of its unclaimed writers only', async () => {
	const ok = await put(
		'/auth/user',
		{ id: f.writer.id, name: 'Renamed', managerNote: 'note' },
		chapter
	);
	assert.equal(ok.status, 200);
	assert.equal((await User.findByPk(f.writer.id)).name, 'Renamed');

	const role = await put('/auth/user', { id: f.writer.id, role: 'admin' }, chapter);
	assert.equal(role.status, 403);
	const pw = await put('/auth/user', { id: f.writer.id, password: 'newpass' }, chapter);
	assert.equal(pw.status, 403);
	const notMine = await put('/auth/user', { id: f.writer.id, name: 'Nope' }, otherChapter);
	assert.equal(notMine.status, 403);
	const independent = await put('/auth/user', { id: f.alice.id, name: 'Nope' }, chapter);
	assert.equal(independent.status, 403);
	assert.equal((await del('/auth/user', { id: f.alice.id }, chapter)).status, 403);
});

test('a chapter may delete its unclaimed writers', async () => {
	const w = (await post('/auth/writer', { name: 'Temporary' }, chapter)).body.data;
	assert.equal((await del('/auth/user', { id: w.id }, otherChapter)).status, 403);
	assert.equal((await del('/auth/user', { id: w.id }, chapter)).status, 200);
	assert.equal(await User.findByPk(w.id), null);
});

// ---- tokens and claiming --------------------------------------------------

test('token lifecycle: issue, regenerate, revoke', async () => {
	const w = (await post('/auth/writer', { name: 'Tokened' }, chapter)).body.data;
	const first = await post('/auth/writer/token', { writer: w.id }, chapter);
	assert.equal(first.status, 201);
	assert.equal(first.body.data.writer, w.id);
	assert.match(first.body.data.token, /^[0-9A-HJKMNP-TV-Z]{24}$/);
	// Two weeks unless CLAIM_TOKEN_DAYS says otherwise: long enough for a code handed
	// over at a letter night.
	const days = (new Date(first.body.data.expiresAt) - Date.now()) / 86400000;
	assert.ok(days > 13.9 && days < 14.1, 'got ' + days + ' days');
	assert.ok(!JSON.stringify(await ClaimToken.findAll()).includes(first.body.data.token));

	const listed = (await get('/auth/writers?page_size=100', chapter)).body.data.find(
		(x) => x.id === w.id
	);
	assert.equal(listed.claimToken.expiresAt, first.body.data.expiresAt);
	assert.equal(listed.claimToken.token, undefined);

	const second = await post('/auth/writer/token', { writer: w.id }, chapter);
	assert.notEqual(second.body.data.token, first.body.data.token);
	assert.equal((await get('/auth/claim?token=' + first.body.data.token)).status, 404);
	assert.equal((await get('/auth/claim?token=' + second.body.data.token)).status, 200);

	assert.equal((await post('/auth/writer/token', { writer: w.id }, otherChapter)).status, 403);
	assert.equal((await del('/auth/writer/token', { writer: w.id }, otherChapter)).status, 403);
	assert.equal((await del('/auth/writer/token', { writer: w.id }, chapter)).status, 200);
	assert.equal((await del('/auth/writer/token', { writer: w.id }, chapter)).status, 404);
	assert.equal((await get('/auth/claim?token=' + second.body.data.token)).status, 404);
	assert.equal((await post('/auth/writer/token', { writer: f.alice.id }, admin)).status, 409);
	assert.equal((await post('/auth/writer/token', { writer: 999999 }, admin)).status, 404);
});

test('claiming turns a managed writer into an independent account', async () => {
	const w = (await post('/auth/writer', { name: 'Claimer', managerNote: 'secret' }, chapter)).body
		.data;
	const { token } = (await post('/auth/writer/token', { writer: w.id }, chapter)).body.data;

	const info = await get('/auth/claim?token=' + token.toLowerCase());
	assert.equal(info.status, 200);
	assert.deepEqual(info.body.data.writer, { id: w.id, name: 'Claimer' });
	assert.equal(info.body.data.chapter.id, f.group.id);
	assert.equal(info.body.data.managerNote, undefined);

	const short = await post('/auth/claim', { token, username: 'cl', password: 'x' });
	assert.equal(short.status, 400);
	const taken = await post('/auth/claim', { token, username: 'alice', password: 'longenough' });
	assert.equal(taken.status, 400);

	const res = await post('/auth/claim', {
		token,
		username: 'claimer',
		password: 'claimerpass',
		email: 'claimer@example.com'
	});
	assert.equal(res.status, 201);
	assert.equal(res.body.data.username, 'claimer');
	assert.equal(res.body.data.email, 'claimer@example.com');
	assert.equal(res.body.data.managedBy, null);
	assert.equal(res.body.data.claimedFrom, f.group.id);
	assert.ok(res.body.data.claimedAt);
	assert.equal(res.body.data.managerNote, undefined);
	assert.equal(res.body.data.password, undefined);

	const jwt = await login('claimer', 'claimerpass');
	assert.ok(jwt);
	const reuse = await post('/auth/claim', { token, username: 'again', password: 'againpass' });
	assert.equal(reuse.status, 410);
	assert.match(reuse.body.info, /already been used/);
	assert.equal(reuse.body.condition, 'used', 'serialised, not only in the sentence');
	const usedInfo = await get('/auth/claim?token=' + token);
	assert.equal(usedInfo.status, 410);
	assert.equal(usedInfo.body.condition, 'used');

	// Once claimed, the group no longer manages the account.
	const listed = (await get('/auth/writers?page_size=100', chapter)).body.data;
	assert.ok(!listed.some((x) => x.id === w.id));
	assert.equal((await put('/auth/user', { id: w.id, name: 'Nope' }, chapter)).status, 403);
	const self = await get('/auth/user?id=' + w.id, { token: jwt });
	assert.equal(self.status, 200);
	assert.equal(self.body.data.managerNote, undefined);
});

test('expired and unknown tokens are refused', async () => {
	const w = (await post('/auth/writer', { name: 'Late' }, chapter)).body.data;
	const { token } = (await post('/auth/writer/token', { writer: w.id }, chapter)).body.data;
	await ClaimToken.update({ expiresAt: new Date(Date.now() - 1000) }, { where: { userId: w.id } });
	const info = await get('/auth/claim?token=' + token);
	assert.equal(info.status, 410);
	assert.match(info.body.info, /expired/);
	assert.equal(info.body.condition, 'expired');
	const claim = await post('/auth/claim', { token, username: 'late', password: 'latepass' });
	assert.equal(claim.status, 410);
	assert.equal(claim.body.condition, 'expired');
	const unknown = await get('/auth/claim?token=NOPE');
	assert.equal(unknown.status, 404);
	assert.equal(unknown.body.condition, 'unknown');
	assert.match(unknown.body.info, /not valid/);
	assert.equal((await get('/auth/claim')).status, 404);
});

// ---- thread scoping -------------------------------------------------------

test('a chapter writes and reads threads for its managed writers only', async () => {
	const sent = await post(
		'/messaging/message',
		{ messageText: 'On behalf', sender: 'user', prisoner: f.prisoner1.id, user: f.writer.id },
		chapter
	);
	assert.equal(sent.status, 201);
	assert.equal(sent.body.data.user, f.writer.id);
	const reply = await post(
		'/messaging/message',
		{ messageText: 'Back', sender: 'prisoner', prisoner: f.prisoner1.id, user: f.writer.id },
		chapter
	);
	assert.equal(reply.status, 201);
	assert.equal(reply.body.data.sender, 'prisoner');

	const chats = await get('/chat/chats?full=true', chapter);
	assert.equal(chats.status, 200);
	assert.ok(chats.body.data.length >= 1);
	assert.ok(
		chats.body.data.every((c) => c.user === f.writer.id || c.user_details.managedBy === f.group.id)
	);
	const byPrisoner = await get('/chat/chats?prisoner=' + f.prisoner1.id, chapter);
	assert.ok(byPrisoner.body.data.every((c) => c.user !== f.alice.id));
	const messages = await get('/messaging/messages?prisoner=' + f.prisoner1.id, chapter);
	assert.ok(messages.body.data.length >= 2);
	assert.ok(messages.body.data.every((m) => m.user !== f.alice.id));
	const single = await get(
		'/chat/chat?user=' + f.writer.id + '&prisoner=' + f.prisoner1.id,
		chapter
	);
	assert.equal(single.status, 200);

	// The other group sees none of it.
	assert.deepEqual((await get('/chat/chats', otherChapter)).body.data, []);
	assert.equal((await get('/chat/chat?id=' + single.body.data.id, otherChapter)).status, 403);
	assert.equal((await get('/messaging/message?id=' + sent.body.data.id, otherChapter)).status, 403);
	assert.equal(
		(await del('/messaging/message', { id: sent.body.data.id }, otherChapter)).status,
		403
	);
	assert.equal((await del('/chat/chat', { id: single.body.data.id }, otherChapter)).status, 403);
	const notMine = await post(
		'/messaging/message',
		{ messageText: 'x', sender: 'user', prisoner: f.prisoner1.id, user: f.writer.id },
		otherChapter
	);
	assert.equal(notMine.status, 403);

	// Editing stays inside the scope, too.
	const moved = await put(
		'/messaging/message',
		{ id: sent.body.data.id, user: f.alice.id },
		chapter
	);
	assert.equal(moved.status, 403);
	const edited = await put(
		'/messaging/message',
		{ id: sent.body.data.id, messageText: 'Edited' },
		chapter
	);
	assert.equal(edited.status, 200);
});

test('omitting the writer sends as the group anonymous writer', async () => {
	const res = await post(
		'/messaging/message',
		{ messageText: 'Anonymous letter', sender: 'user', prisoner: f.prisoner2.id },
		chapter
	);
	assert.equal(res.status, 201);
	const anon = await User.findByPk(res.body.data.user);
	assert.equal(anon.anonymousForChapter, f.group.id);
	assert.equal(anon.managedBy, f.group.id);
	const again = await post(
		'/messaging/message',
		{ messageText: 'Second', sender: 'user', prisoner: f.prisoner2.id },
		chapter
	);
	assert.equal(again.body.data.user, anon.id, 'one anonymous account per group');
	const chat = await post('/chat/chat', { prisoner: f.prisoner1.id }, chapter);
	assert.equal(chat.status, 201);
	assert.equal(chat.body.data.user, anon.id);
	assert.ok(
		(await get('/auth/writers?page_size=100', chapter)).body.data.some((w) => w.id === anon.id)
	);
});

test("a group's shared anonymous account cannot be handed to anyone", async () => {
	// Two different people at a letter night, both sent anonymously.
	await post(
		'/messaging/message',
		{ messageText: 'From one person', sender: 'user', prisoner: f.prisoner1.id },
		chapter
	);
	await post(
		'/messaging/message',
		{ messageText: 'From somebody else', sender: 'user', prisoner: f.prisoner2.id },
		chapter
	);
	const anon = await User.findOne({ where: { anonymousForChapter: f.group.id } });
	const lettersBefore = await Message.count({ where: { user: anon.id } });
	assert.ok(lettersBefore >= 2);

	for (const who of [chapter, { token: f.admin.token }]) {
		const res = await post('/auth/writer/token', { writer: anon.id }, who);
		assert.equal(res.status, 409, JSON.stringify(res.body));
		assert.equal(res.body.name, 'ClaimError');
		assert.match(JSON.stringify(res.body), /shared by everyone it writes for/);
	}

	// A token issued for it before this was refused must not work either.
	const { token } = await ClaimToken.issue(anon.id, f.chapter.id);
	assert.equal((await get('/auth/claim?token=' + token)).status, 410);
	const claim = await post('/auth/claim', { token, username: 'grabber', password: 'longenough' });
	assert.equal(claim.status, 410, JSON.stringify(claim.body));
	const still = await User.findByPk(anon.id);
	assert.equal(still.claimedAt, null);
	assert.equal(still.username, 'anon-' + f.group.id);
	assert.equal(await Message.count({ where: { user: anon.id } }), lettersBefore);
	await assert.rejects(
		User.claim(still, { username: 'grabber', password: 'longenough' }),
		/cannot be claimed/
	);

	// It never has keys either: its letters are sealed to the group alone, and a key
	// on it would make every anonymous letter look like it had a reader nobody is.
	const client = await import('./e2e-client.js');
	await client.ready;
	const keys = client.keypair();
	const attempts = [
		{ publicKey: keys.publicKey },
		{ orgWrappedPrivateKey: 'sealed-to-the-group', orgKeyVersion: 1 },
		{ publicKey: keys.publicKey, orgWrappedPrivateKey: 'sealed-to-the-group', orgKeyVersion: 1 }
	];
	for (const who of [chapter, { token: f.admin.token }]) {
		for (const fields of attempts) {
			const res = await put('/auth/user', { id: anon.id, ...fields }, who);
			assert.equal(res.status, 400, JSON.stringify(fields) + ' -> ' + JSON.stringify(res.body));
		}
	}
	const keyless = await User.scope('withKeys').findByPk(anon.id);
	assert.equal(keyless.publicKey, null);
	assert.equal(keyless.orgWrappedPrivateKey, null);
	// Ordinary fields on it can still be edited by its group.
	const renamed = await put(
		'/auth/user',
		{ id: anon.id, managerNote: 'Letter night walk-ins' },
		chapter
	);
	assert.equal(renamed.status, 200, JSON.stringify(renamed.body));

	// The way to do it: a managed writer of their own, which can be handed off.
	const own = await post('/auth/writer', { name: 'Walk-in from letter night' }, chapter);
	assert.equal(own.status, 201);
	assert.equal(
		(await post('/auth/writer/token', { writer: own.body.data.id }, chapter)).status,
		201
	);
});

test('a claimed writer keeps their threads and the group loses access', async () => {
	const w = (await post('/auth/writer', { name: 'Leaver' }, chapter)).body.data;
	const sent = await post(
		'/messaging/message',
		{ messageText: 'Before claim', sender: 'user', prisoner: f.prisoner1.id, user: w.id },
		chapter
	);
	assert.equal(sent.status, 201);
	const { token } = (await post('/auth/writer/token', { writer: w.id }, chapter)).body.data;
	await post('/auth/claim', { token, username: 'leaver', password: 'leaverpass' });
	const me = { token: await login('leaver', 'leaverpass') };
	const mine = await get('/messaging/messages', me);
	assert.equal(mine.body.data.length, 1);
	assert.equal(mine.body.data[0].id, sent.body.data.id);
	assert.equal((await get('/messaging/message?id=' + sent.body.data.id, chapter)).status, 403);
});

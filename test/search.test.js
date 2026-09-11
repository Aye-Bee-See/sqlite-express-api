import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
	startServer,
	stopServer,
	get,
	post,
	makeFixtures,
	Prison,
	Prisoner,
	Chapter,
	Rule
} from './helpers.js';

let f;
let admin;
before(async () => {
	await startServer();
	f = await makeFixtures();
	admin = { token: f.admin.token };
	await Prison.createPrison({ prisonName: 'Alpha Correctional', address: {} });
	await Prison.createPrison({ prisonName: 'Beta Penitentiary', address: {} });
	await Prison.createPrison({ prisonName: 'Hidden Alpha', address: {}, recordStatus: 'draft' });
	await Prisoner.createPrisoner({
		birthName: 'Zed Zebra',
		chosenName: 'Ada',
		prison: f.prison.id,
		status: 'free'
	});
	await Prisoner.createPrisoner({
		birthName: 'Quinn Alpha',
		chosenName: 'Q',
		prison: f.prison.id,
		status: 'pretrial'
	});
	await Chapter.createChapter({ name: 'Portland ABC', location: {} });
	await Chapter.createChapter({ name: 'NYC ABC', location: {} });
	await Rule.createRule({ title: 'No staples', description: 'Loose pages only' });
});
after(stopServer);

test('q searches prison names, case-insensitively, and totals reflect the match', async () => {
	const res = await get('/prison/prisons?q=alpha');
	assert.equal(res.status, 200);
	assert.deepEqual(
		res.body.data.map((p) => p.prisonName),
		['Alpha Correctional']
	);
	assert.equal(res.body.total, 1);
	// Staff also see the draft that matches.
	const staff = await get('/prison/prisons?q=ALPHA', admin);
	assert.deepEqual(staff.body.data.map((p) => p.prisonName).sort(), [
		'Alpha Correctional',
		'Hidden Alpha'
	]);
	assert.equal(staff.body.total, 2);
	const none = await get('/prison/prisons?q=zzzz');
	assert.deepEqual(none.body.data, []);
	assert.equal(none.body.total, 0);
	const blank = await get('/prison/prisons?q=%20');
	assert.equal(blank.body.total, (await get('/prison/prisons')).body.total);
});

test('q searches prisoners by birth or chosen name', async () => {
	const byChosen = await get('/prisoner/prisoners?q=ada');
	assert.deepEqual(
		byChosen.body.data.map((p) => p.chosenName),
		['Ada']
	);
	const byBirth = await get('/prisoner/prisoners?q=alpha');
	assert.deepEqual(
		byBirth.body.data.map((p) => p.birthName),
		['Quinn Alpha']
	);
});

test('prisoner status filter works alone, with q, with prison, and is validated', async () => {
	const free = await get('/prisoner/prisoners?status=free');
	assert.ok(free.body.data.length >= 1);
	assert.ok(free.body.data.every((p) => p.status === 'free'));
	const combined = await get('/prisoner/prisoners?status=pretrial&q=quinn&prison=' + f.prison.id);
	assert.equal(combined.body.total, 1);
	assert.equal(combined.body.data[0].birthName, 'Quinn Alpha');
	const bad = await get('/prisoner/prisoners?status=escaped');
	assert.equal(bad.status, 400);
	assert.deepEqual(bad.body.errors, ['status must be one of pretrial, incarcerated, free.']);
});

test('q searches chapters and rules', async () => {
	const chapters = await get('/chapter/chapters?q=abc');
	assert.deepEqual(chapters.body.data.map((c) => c.name).sort(), ['NYC ABC', 'Portland ABC']);
	const rules = await get('/rule/rules?q=loose');
	assert.deepEqual(
		rules.body.data.map((r) => r.title),
		['No staples']
	);
	const byPrison = await get('/rule/rules?prison=' + f.prison.id + '&q=pictures');
	assert.equal(byPrison.status, 200);
});

test('sort=name, newest, oldest are honoured; unknown sorts are rejected', async () => {
	const byName = await get('/prison/prisons?sort=name&page_size=100');
	const names = byName.body.data.map((p) => p.prisonName);
	assert.deepEqual(
		names,
		[...names].sort((a, b) => a.localeCompare(b))
	);

	const newest = await get('/prison/prisons?sort=newest&page_size=100');
	const oldest = await get('/prison/prisons?sort=oldest&page_size=100');
	assert.deepEqual(
		newest.body.data.map((p) => p.id),
		oldest.body.data.map((p) => p.id).reverse()
	);

	const prisoners = await get('/prisoner/prisoners?sort=name&page_size=100');
	const chosen = prisoners.body.data.map((p) => p.chosenName || '');
	assert.deepEqual(
		chosen,
		[...chosen].sort((a, b) => a.localeCompare(b))
	);

	const bad = await get('/chapter/chapters?sort=random');
	assert.equal(bad.status, 400);
	assert.deepEqual(bad.body.errors, ['sort must be one of name, newest, oldest.']);
});

test('several bad parameters are reported together', async () => {
	const res = await get('/prisoner/prisoners?status=nope&sort=nope&recordStatus=nope', admin);
	assert.equal(res.status, 400);
	assert.equal(res.body.errors.length, 3);
});

test('chats list most recently active first, with lastMessageAt and a last_message summary', async () => {
	const alice = { token: f.alice.token };
	const first = await post(
		'/messaging/message',
		{ messageText: 'older thread', sender: 'user', prisoner: f.prisoner1.id, user: f.alice.id },
		alice
	);
	await new Promise((r) => setTimeout(r, 15));
	const second = await post(
		'/messaging/message',
		{ messageText: 'newer thread', sender: 'user', prisoner: f.prisoner2.id, user: f.alice.id },
		alice
	);
	const empty = await post('/chat/chat', { user: f.bob.id, prisoner: f.prisoner1.id }, admin);

	const mine = await get('/chat/chats', alice);
	assert.deepEqual(
		mine.body.data.map((c) => c.id),
		[second.body.data.chat, first.body.data.chat]
	);
	assert.equal(mine.body.data[0].last_message.messageText, 'newer thread');
	assert.equal(mine.body.data[0].last_message.sender, 'user');
	assert.equal(mine.body.data[0].lastMessageAt, mine.body.data[0].last_message.createdAt);
	assert.match(mine.body.data[0].lastMessageAt, /^\d{4}-\d{2}-\d{2}T/);
	assert.ok(mine.body.data[0].lastMessageAt >= mine.body.data[1].lastMessageAt);

	// A reply moves the older thread back to the top.
	await new Promise((r) => setTimeout(r, 15));
	await post(
		'/messaging/message',
		{ messageText: 'reply', sender: 'prisoner', prisoner: f.prisoner1.id, user: f.alice.id },
		admin
	);
	const again = await get('/chat/chats', alice);
	assert.equal(again.body.data[0].id, first.body.data.chat);
	assert.equal(again.body.data[0].last_message.sender, 'prisoner');

	// Chats with no messages come last, with null summaries; full=true still works.
	const all = await get('/chat/chats?page_size=100', admin);
	const last = all.body.data[all.body.data.length - 1];
	assert.equal(last.id, empty.body.data.id);
	assert.equal(last.last_message, null);
	assert.equal(last.lastMessageAt, null);
	const full = await get('/chat/chats?user=' + f.alice.id + '&full=true', admin);
	assert.equal(full.status, 200);
	assert.equal(full.body.data[0].id, first.body.data.chat);
	assert.ok(Array.isArray(full.body.data[0].messages));
	assert.ok(full.body.data[0].last_message);
});

test('admin user list supports q on username, email, and name', async () => {
	const byName = await get('/auth/users?q=ali', admin);
	assert.deepEqual(
		byName.body.data.map((u) => u.username),
		['alice']
	);
	const byEmail = await get('/auth/users?q=bob@example', admin);
	assert.equal(byEmail.body.total, 1);
	const withRole = await get('/auth/users?role=user&q=nobody', admin);
	assert.deepEqual(withRole.body.data, []);
	assert.ok(!JSON.stringify(byName.body).includes('$2b$'));
});

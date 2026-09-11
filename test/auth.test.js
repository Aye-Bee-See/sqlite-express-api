import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import {
	startServer,
	stopServer,
	baseUrlOf,
	get,
	post,
	put,
	del,
	makeFixtures,
	makeUser,
	User
} from './helpers.js';

let f;
before(async () => {
	await startServer();
	f = await makeFixtures();
});
after(stopServer);

test('health reports ok once the database is ready', async () => {
	const res = await get('/health');
	assert.equal(res.status, 200);
	assert.deepEqual(res.body, { status: 'ok' });
});

test('login returns a token and a user without a password hash', async () => {
	const res = await post('/auth/login', { username: 'alice', password: f.alice.password });
	assert.equal(res.status, 200);
	assert.equal(res.body.success, true);
	assert.equal(res.body.name, 'user login');
	assert.equal(typeof res.body.data.token.token, 'string');
	assert.equal(typeof res.body.data.token.expires, 'number');
	assert.equal(res.body.data.user.username, 'alice');
	assert.equal(res.body.data.user.password, undefined);
	assert.ok(!JSON.stringify(res.body).includes('$2b$'));
});

test('login accepts form-encoded bodies', async () => {
	const res = await fetch(baseUrlOf() + '/auth/login', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: 'username=alice&password=' + encodeURIComponent(f.alice.password)
	});
	assert.equal(res.status, 200);
});

test('login rejects a wrong password with 401', async () => {
	const res = await post('/auth/login', { username: 'alice', password: 'nope' });
	assert.equal(res.status, 401);
	assert.equal(res.body.name, 'AuthenticationError');
	assert.equal(res.body.success, false);
});

test('login rejects a missing field with 400', async () => {
	const res = await post('/auth/login', { username: 'alice' });
	assert.equal(res.status, 400);
	assert.equal(res.body.name, 'AuthenticationError');
});

test('a protected route rejects a missing token', async () => {
	const res = await get('/chat/chats');
	assert.equal(res.status, 401);
	assert.deepEqual(res.body, {
		success: false,
		name: 'AuthenticationError',
		info: 'Unauthorized',
		status: 401
	});
});

test('a valid token is accepted', async () => {
	const res = await get('/prison/prisons', { token: f.alice.token });
	assert.equal(res.status, 200);
});

test('tokens signed with the wrong secret, with no id, or for a missing user are rejected', async () => {
	const wrongSecret = jwt.sign({ id: f.alice.id }, 'not-the-secret', { expiresIn: '1w' });
	const noId = jwt.sign({ foo: 'bar' }, 'test-secret', { expiresIn: '1w' });
	const ghost = jwt.sign({ id: 999999 }, 'test-secret', { expiresIn: '1w' });
	const expired = jwt.sign({ id: f.alice.id }, 'test-secret', { expiresIn: '-1s' });
	for (const token of [wrongSecret, noId, ghost, expired]) {
		const res = await get('/prison/prisons', { token });
		assert.equal(res.status, 401);
	}
});

test('a deleted user token stops working', async () => {
	const temp = await makeUser({ username: 'temporary' });
	assert.equal((await get('/prison/prisons', { token: temp.token })).status, 200);
	const removed = await del('/auth/user', { id: temp.id }, { token: f.admin.token });
	assert.equal(removed.status, 200);
	assert.equal((await get('/prison/prisons', { token: temp.token })).status, 401);
});

test('a banned user cannot log in and an existing token stops working', async () => {
	const victim = await makeUser({ username: 'victim' });
	assert.equal((await get('/prison/prisons', { token: victim.token })).status, 200);
	const ban = await put('/auth/user', { id: victim.id, role: 'banned' }, { token: f.admin.token });
	assert.equal(ban.status, 200);
	assert.equal((await get('/prison/prisons', { token: victim.token })).status, 401);
	const login = await post('/auth/login', { username: 'victim', password: victim.password });
	assert.equal(login.status, 401);
});

test('public registration creates a user with role user and status 201', async () => {
	const res = await post('/auth/user', {
		username: 'newbie',
		password: 'longenough',
		email: 'newbie@example.com',
		name: 'New Person'
	});
	assert.equal(res.status, 201);
	assert.equal(res.body.status, 201);
	assert.equal(res.body.data.role, 'user');
	assert.equal(res.body.data.password, undefined);
	assert.equal((await User.findByPk(res.body.data.id)).role, 'user');
});

test('anonymous registration cannot request another role', async () => {
	const res = await post('/auth/user', {
		username: 'sneaky',
		password: 'longenough',
		email: 'sneaky@example.com',
		role: 'admin'
	});
	assert.equal(res.status, 403);
	assert.equal(res.body.name, 'AuthorizationError');
	assert.equal(await User.getUser({ username: 'sneaky' }), null);
});

test('a non-admin token cannot create another role either', async () => {
	const res = await post(
		'/auth/user',
		{ username: 'sneaky2', password: 'longenough', email: 'sneaky2@example.com', role: 'chapter' },
		{ token: f.alice.token }
	);
	assert.equal(res.status, 403);
});

test('a bad token on registration is rejected rather than treated as anonymous', async () => {
	const res = await post(
		'/auth/user',
		{ username: 'sneaky3', password: 'longenough', email: 'sneaky3@example.com' },
		{ token: 'garbage' }
	);
	assert.equal(res.status, 401);
});

test('an admin can create a chapter account; role is case-insensitive', async () => {
	const res = await post(
		'/auth/user',
		{ username: 'chap2', password: 'longenough', email: 'chap2@example.com', role: 'Chapter' },
		{ token: f.admin.token }
	);
	assert.equal(res.status, 201);
	assert.equal(res.body.data.role, 'chapter');
});

test('registration validates input and reports every problem', async () => {
	const res = await post('/auth/user', {
		username: 'x',
		password: 'short',
		email: 'bad',
		bio: 'tiny'
	});
	assert.equal(res.status, 400);
	assert.equal(res.body.success, false);
	assert.ok(Array.isArray(res.body.errors));
	assert.ok(res.body.errors.some((m) => m.includes('Username')));
	assert.ok(res.body.errors.some((m) => m.includes('Password')));
	assert.ok(res.body.errors.some((m) => m.includes('Email')));
	assert.ok(res.body.errors.some((m) => m.includes('Bio')));
});

test('duplicate usernames and emails are refused with 400', async () => {
	const dupeName = await post('/auth/user', {
		username: 'alice',
		password: 'longenough',
		email: 'fresh@example.com'
	});
	assert.equal(dupeName.status, 400);
	assert.equal(dupeName.body.name, 'SequelizeUniqueConstraintError');
	assert.equal(dupeName.body.error, 'Username already in use.');
	const dupeMail = await post('/auth/user', {
		username: 'freshname',
		password: 'longenough',
		email: 'alice@example.com'
	});
	assert.equal(dupeMail.status, 400);
	assert.equal(dupeMail.body.error, 'Email address already in use.');
});

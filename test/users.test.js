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
	User
} from './helpers.js';
import { newPenName } from './helpers.js';

let f;
let admin;
before(async () => {
	await startServer();
	f = await makeFixtures();
	admin = { token: f.admin.token };
});
after(stopServer);

test('user list returns full rows without hashes and paginates', async () => {
	const res = await get('/auth/users?page_size=2', admin);
	assert.equal(res.status, 200);
	assert.equal(res.body.data.length, 2);
	assert.deepEqual(Object.keys(res.body.data[0]).sort(), [
		'anonymousForChapter',
		'authScheme',
		'bio',
		'chapterId',
		'claimedAt',
		'claimedFrom',
		'createdAt',
		'email',
		'id',
		'managedBy',
		'managerNote',
		'name',
		'penName',
		'publicKey',
		'retentionDays',
		'role',
		'sessionsRevokedAt',
		'sponsoredBy',
		'twoFactorEnabled',
		'updatedAt',
		'username'
	]);
	const everyone = await get('/auth/users?page_size=100', admin);
	assert.ok(!JSON.stringify(everyone.body).includes('$2b$'));
	assert.ok(!/totp/i.test(JSON.stringify(everyone.body)), 'no two-factor secrets, only the flag');
});

test('an admin sees whether each account has two-factor sign-in on; nobody else does', async () => {
	// Two-factor is on when it was confirmed (totpEnabledAt); the secret never travels (#207).
	const on = await makeUser({ username: 'twofactoron' });
	await User.update({ totpEnabledAt: new Date() }, { where: { id: on.id } });
	const everyone = await get('/auth/users?page_size=100', admin);
	const row = (id) => everyone.body.data.find((u) => u.id === id);
	assert.equal(row(on.id).twoFactorEnabled, true);
	assert.equal(row(f.admin.id).twoFactorEnabled, false);
	const one = await get('/auth/user?id=' + on.id, admin);
	assert.equal(one.body.data.twoFactorEnabled, true);
	const self = await get('/auth/user?id=' + on.id, { token: on.token });
	assert.equal(self.status, 200, JSON.stringify(self.body));
	assert.equal(self.body.data.twoFactorEnabled, undefined, 'admins only');
});

test('user list filters by role, case-insensitively, and validates the role', async () => {
	const chapters = await get('/auth/users?role=Chapter', admin);
	assert.equal(chapters.status, 200);
	assert.ok(chapters.body.data.length >= 1);
	assert.ok(chapters.body.data.every((u) => u.role === 'chapter'));
	const banned = await get('/auth/users?role=banned', admin);
	assert.equal(banned.status, 200);
	assert.deepEqual(banned.body.data, []);
	const bad = await get('/auth/users?role=wizard', admin);
	assert.equal(bad.status, 400);
	assert.ok(bad.body.errors[0].includes('wizard'));
});

test('full=true embeds chats on user reads', async () => {
	await post(
		'/messaging/message',
		{ messageText: 'hi', sender: 'user', prisoner: f.prisoner1.id, user: f.alice.id },
		{ token: f.alice.token }
	);
	const one = await get('/auth/user?id=' + f.alice.id + '&full=true', admin);
	assert.equal(one.body.data.chats.length, 1);
	const many = await get('/auth/users?role=user&full=true', admin);
	const alice = many.body.data.find((u) => u.username === 'alice');
	assert.equal(alice.chats.length, 1);
	assert.equal(alice.password, undefined);
});

test('a password change is hashed, takes effect, and is not echoed', async () => {
	const u = await makeUser({ username: 'pwchange', password: 'firstpass1' });
	const res = await put('/auth/user', { id: u.id, password: 'secondpass2' }, { token: u.token });
	assert.equal(res.status, 200);
	assert.deepEqual(res.body.data.updatedRows, [1]);
	assert.equal(res.body.data.newUser.password, undefined);
	assert.ok(!JSON.stringify(res.body).includes('secondpass2'));
	assert.ok(!JSON.stringify(res.body).includes('$2b$'));

	const stored = await User.getUserWithPassword({ username: 'pwchange' });
	assert.ok(stored.password.startsWith('$2b$'));
	assert.notEqual(stored.password, 'secondpass2');

	assert.equal(
		(await post('/auth/login', { username: 'pwchange', password: 'secondpass2' })).status,
		200
	);
	assert.equal(
		(await post('/auth/login', { username: 'pwchange', password: 'firstpass1' })).status,
		401
	);
});

test('an unrelated update leaves the password hash untouched', async () => {
	const u = await makeUser({ username: 'nametouch', password: 'firstpass1' });
	const before = (await User.getUserWithPassword({ username: 'nametouch' })).password;
	await put('/auth/user', { id: u.id, name: 'Renamed Person' }, { token: u.token });
	const after = (await User.getUserWithPassword({ username: 'nametouch' })).password;
	assert.equal(before, after);
	assert.equal(
		(await post('/auth/login', { username: 'nametouch', password: 'firstpass1' })).status,
		200
	);
});

test('a too-short password on update is rejected before hashing', async () => {
	const u = await makeUser({ username: 'shortpw', password: 'firstpass1' });
	const res = await put('/auth/user', { id: u.id, password: 'short' }, { token: u.token });
	assert.equal(res.status, 400);
	assert.deepEqual(res.body.errors, ['Password must be a minimum of 7 characters.']);
	assert.equal(
		(await post('/auth/login', { username: 'shortpw', password: 'firstpass1' })).status,
		200
	);
});

test("an admin can reset another user's password", async () => {
	const u = await makeUser({ username: 'resetme', password: 'firstpass1' });
	assert.equal((await put('/auth/user', { id: u.id, password: 'adminreset3' }, admin)).status, 200);
	assert.equal(
		(await post('/auth/login', { username: 'resetme', password: 'adminreset3' })).status,
		200
	);
});

test('string length rules are enforced', async () => {
	const cases = [
		[{ username: 'ab' }, 'Username'],
		[{ username: 'abcdefghijklmnopq' }, 'Username'],
		[{ name: 'Jo' }, 'Name'],
		[{ bio: 'short bio' }, 'Bio']
	];
	for (const [overrides, field] of cases) {
		const res = await post('/auth/user', {
			penName: newPenName(),
			username: 'valid' + Math.random().toString(36).slice(2, 8),
			password: 'longenough',
			email: Math.random().toString(36).slice(2, 10) + '@example.com',
			...overrides
		});
		assert.equal(res.status, 400, JSON.stringify(overrides));
		assert.ok(
			res.body.errors.some((m) => m.startsWith(field)),
			JSON.stringify(res.body)
		);
	}
});

test('lookups for missing users are 404 and no-parameter lookups are 400', async () => {
	assert.equal((await get('/auth/user?id=999999', admin)).status, 404);
	assert.equal((await get('/auth/user?email=nobody@example.com', admin)).status, 404);
	assert.equal((await get('/auth/user?username=nobody', admin)).status, 404);
	const none = await get('/auth/user', admin);
	assert.equal(none.status, 400);
	assert.deepEqual(none.body.errors, ['No ID, username, or email provided.']);
	assert.deepEqual(none.body.problems, [{ field: 'id', code: 'required' }]);
	assert.equal((await put('/auth/user', { id: 999999, name: 'Valid Name' }, admin)).status, 404);
	assert.equal((await del('/auth/user', { id: 999999 }, admin)).status, 404);
});

process.env.RATE_LIMIT_ENABLED = 'true';
process.env.RATE_LIMIT_LOGIN_FAILURES_PER_USER = '3';
process.env.RATE_LIMIT_LOGIN_PER_IP = '1000';
process.env.RATE_LIMIT_CLAIM_PER_IP = '3';
process.env.RATE_LIMIT_RECOVER_START_PER_USER = '2';
process.env.RATE_LIMIT_RECOVER_START_PER_IP = '1000';
process.env.RATE_LIMIT_RECOVER_FINISH_PER_USER = '2';

const { test, before, after, beforeEach } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const { startServer, stopServer, get, post, makeUser } = await import('./helpers.js');
const { reset } = await import('../routes/services/ratelimit.services.js');
const { rateLimits } = await import('../constants.js');

before(startServer);
after(stopServer);
beforeEach(reset);

test('limits come from the environment, with defaults for the rest', () => {
	assert.equal(rateLimits.enabled, true);
	assert.equal(rateLimits.loginFailuresPerUser, 3);
	assert.equal(rateLimits.claimPerIp, 3);
	assert.equal(rateLimits.loginWindowMinutes, 15, 'default kept');
	assert.equal(rateLimits.recoverWindowMinutes, 60, 'default kept');
});

test('failed sign-ins lock the username, not the successful ones, and not other users', async () => {
	const u = await makeUser({ username: 'lockme' });
	const other = await makeUser({ username: 'bystander' });
	// Successful logins never count.
	for (let i = 0; i < 5; i++) {
		assert.equal(
			(await post('/auth/login', { username: 'lockme', password: u.password })).status,
			200
		);
	}
	for (let i = 0; i < 3; i++) {
		assert.equal(
			(await post('/auth/login', { username: 'lockme', password: 'wrong-password' })).status,
			401
		);
	}
	const locked = await post('/auth/login', { username: 'LockMe', password: u.password });
	assert.equal(locked.status, 429, 'even the right password, in any letter case');
	assert.equal(locked.body.name, 'RateLimitError');
	assert.equal(locked.body.success, false);
	assert.match(locked.body.info, /Too many sign-in attempts/);
	assert.ok(Number(locked.headers.get('retry-after')) > 0);
	assert.equal(
		(await post('/auth/login', { username: 'bystander', password: other.password })).status,
		200
	);
	reset();
	assert.equal(
		(await post('/auth/login', { username: 'lockme', password: u.password })).status,
		200
	);
});

test('claim token checks are limited per address', async () => {
	for (let i = 0; i < 3; i++) {
		assert.equal((await get('/auth/claim?token=NOPE' + i)).status, 404);
	}
	const res = await get('/auth/claim?token=NOPE9');
	assert.equal(res.status, 429);
	assert.match(res.body.info, /claim token checks/);
});

test('recovery starts and finishes are limited per username', async () => {
	for (let i = 0; i < 2; i++) {
		assert.equal((await get('/auth/recover?username=ghost')).status, 404);
	}
	assert.equal((await get('/auth/recover?username=ghost')).status, 429);
	assert.equal(
		(await get('/auth/recover?username=someoneelse')).status,
		404,
		'another username is unaffected'
	);
	for (let i = 0; i < 2; i++) {
		assert.equal(
			(await post('/auth/recover', { username: 'ghost', challenge: 'x', password: 'whatever1' }))
				.status,
			401
		);
	}
	assert.equal(
		(await post('/auth/recover', { username: 'ghost', challenge: 'x', password: 'whatever1' }))
			.status,
		429
	);
});

test('deleting your own account is not a place to guess the password', async () => {
	const { del } = await import('./helpers.js');
	const victim = await makeUser({ username: 'guessed' });
	// Whoever holds the token gets as many guesses as a sign-in allows (3 here), and no more.
	for (let i = 0; i < 3; i += 1) {
		const res = await del('/auth/user', { id: victim.id, password: 'guess-' + i }, victim);
		assert.equal(res.status, 403);
	}
	const blocked = await del('/auth/user', { id: victim.id, password: victim.password }, victim);
	assert.equal(blocked.status, 429, 'even the right password waits now');
	assert.ok(blocked.headers.get('retry-after'));
});

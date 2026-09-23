process.env.REQUIRE_SPLIT_AUTH = 'true';

const { test, before, after } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const { startServer, stopServer, post, makeFixtures } = await import('./helpers.js');
const client = await import('./e2e-client.js');

let f;
before(async () => {
	await client.ready;
	await startServer();
	f = await makeFixtures();
});
after(stopServer);

test('with REQUIRE_SPLIT_AUTH no new account may send its password, and split ones still can be made', async () => {
	const plain = await post('/auth/user', {
		username: 'stillplain',
		email: 'p@example.com',
		password: 'a plain password'
	});
	assert.equal(plain.status, 400);
	assert.match(plain.body.errors[0], /never reaches it/);
	const keys = client.splitKeys('a split password', 'R');
	const split = await post('/auth/user', {
		username: 'nowsplit',
		email: 's@example.com',
		password: keys.authKey,
		...keys.fields
	});
	assert.equal(split.status, 201, JSON.stringify(split.body));
	// Accounts made before the rule (the fixtures, the seeded admin) still sign in.
	assert.equal(
		(await post('/auth/login', { username: 'alice', password: f.alice.password })).status,
		200
	);
});

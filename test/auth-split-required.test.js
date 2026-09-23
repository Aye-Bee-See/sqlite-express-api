process.env.REQUIRE_SPLIT_AUTH = 'true';

const { test, before, after } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const { startServer, stopServer, get, post, makeFixtures, User } = await import('./helpers.js');
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

test('with the setting on, login-params says the same thing about everyone', async () => {
	// A plain account (alice), a split one, and nobody: one shape, one scheme.
	const answers = await Promise.all(
		['alice', 'nowsplit', 'nobody-at-all'].map((name) => get('/auth/login-params?username=' + name))
	);
	for (const res of answers) {
		assert.equal(res.status, 200);
		assert.equal(res.body.data.scheme, 'split');
		assert.deepEqual(Object.keys(res.body.data).sort(), ['kdfParams', 'kdfSalt', 'scheme']);
	}
	// The real salt still comes back for the split account, so it can sign in.
	assert.equal(
		answers[1].body.data.kdfSalt,
		(await User.scope('withKeys').findOne({ where: { username: 'nowsplit' } })).kdfSalt
	);
});

test('with the setting on, a plain account cannot recover to another plain password', async () => {
	const keys = client.accountKeys('old plain password', 'RECOVER-ME');
	await User.createUser({
		username: 'legacy',
		email: 'l@example.com',
		password: 'old plain password',
		role: 'user',
		...keys.fields
	});
	const start = await get('/auth/recover?username=legacy');
	assert.equal(start.status, 200, JSON.stringify(start.body));
	const challenge = Buffer.from(
		client.open(start.body.data.sealedChallenge, keys.fields.publicKey, keys.privateKey)
	).toString('base64');
	const plain = await post('/auth/recover', {
		username: 'legacy',
		challenge,
		password: 'another plain password',
		wrappedPrivateKey: keys.fields.wrappedPrivateKey,
		kdfSalt: keys.fields.kdfSalt,
		kdfParams: keys.fields.kdfParams
	});
	assert.equal(plain.status, 400, JSON.stringify(plain.body));
	assert.match(plain.body.errors[0], /never reaches it/);
	// The challenge was not spent by the refusal: recovering the right way still works.
	const moved = client.splitKeys('a split password now', 'RECOVER-ME');
	const split = await post('/auth/recover', {
		username: 'legacy',
		challenge,
		password: moved.authKey,
		authScheme: 'split',
		wrappedPrivateKey: moved.fields.wrappedPrivateKey,
		kdfSalt: moved.fields.kdfSalt,
		kdfParams: moved.fields.kdfParams
	});
	assert.equal(split.status, 201, JSON.stringify(split.body));
	assert.equal((await User.findOne({ where: { username: 'legacy' } })).authScheme, 'split');
});

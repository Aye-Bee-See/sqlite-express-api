import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import sodium from 'libsodium-wrappers';
import { startServer, stopServer, makeFixtures, get, post, put, User, Prison } from './helpers.js';
import * as client from './e2e-client.js';
import * as authScheme from '../services/auth-scheme.js';

let f;
before(async () => {
	await client.ready;
	await sodium.ready;
	await startServer();
	f = await makeFixtures();
	await Prison.addRelay(f.group.id, f.prison.id);
});
after(stopServer);

/** A device signs in as the clients will: params, derive, send the auth key. */
async function signIn(username, password) {
	const params = await get('/auth/login-params?username=' + encodeURIComponent(username));
	assert.equal(params.status, 200, JSON.stringify(params.body));
	const { scheme, kdfSalt, kdfParams } = params.body.data;
	return await post('/auth/login', {
		username,
		password: scheme === 'split' ? client.authKeyFor(password, kdfSalt, kdfParams) : password
	});
}

test('the two derivations match the vectors in the proposal, byte for byte', () => {
	const master = new Uint8Array(32).map((_, i) => i);
	const b64 = (bytes) => Buffer.from(bytes).toString('base64');
	assert.equal(b64(master), 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=');
	assert.equal(
		b64(sodium.crypto_kdf_derive_from_key(32, 1, 'abcwrap_', master)),
		'NFKvOp5duAjQ7QmoxriVlK2aftNJI7xkGi/wooDCMcI='
	);
	assert.equal(
		b64(sodium.crypto_kdf_derive_from_key(32, 2, 'abcauth_', master)),
		'wjrINHoPKZiRPnOiURiE/mvNm6+UZXEkNDE/lgfPOWo='
	);
});

test('login-params never says whether an account exists', async () => {
	const unknown = await get('/auth/login-params?username=nobody-here');
	assert.equal(unknown.status, 200);
	assert.deepEqual(Object.keys(unknown.body.data).sort(), ['kdfParams', 'kdfSalt', 'scheme']);
	assert.equal(unknown.body.data.scheme, 'split');
	assert.deepEqual(unknown.body.data.kdfParams, authScheme.DEFAULT_KDF_PARAMS);
	assert.equal(Buffer.from(unknown.body.data.kdfSalt, 'base64').length, 16);
	// Stable for one name, different for another, and not a function anyone can guess.
	const again = await get('/auth/login-params?username=nobody-here');
	assert.equal(again.body.data.kdfSalt, unknown.body.data.kdfSalt);
	const spelt = await get('/auth/login-params?username=Nobody-Here');
	assert.equal(
		spelt.body.data.kdfSalt,
		unknown.body.data.kdfSalt,
		'case does not change the answer'
	);
	const other = await get('/auth/login-params?username=nobody-there');
	assert.notEqual(other.body.data.kdfSalt, unknown.body.data.kdfSalt);
	assert.equal((await get('/auth/login-params')).status, 200, 'no username: still an answer');
	// Alice exists and is plain: the only thing that says so is the scheme, which every
	// account built before this has; once all are split the answers are identical.
	const alice = await get('/auth/login-params?username=alice');
	assert.equal(alice.body.data.scheme, 'plain');
	assert.equal(alice.body.data.kdfSalt, authScheme.fakeSalt('alice'), 'no real salt is handed out');
});

test('a split account is made, signs in with its auth key, and its password never works', async () => {
	const keys = client.splitKeys('correct horse battery', 'RECOVERY-CODE');
	const made = await post('/auth/user', {
		username: 'splitter',
		email: 'splitter@example.com',
		password: keys.authKey,
		...keys.fields
	});
	assert.equal(made.status, 201, JSON.stringify(made.body));
	assert.equal(made.body.data.authScheme, 'split');
	assert.equal(made.body.data.password, undefined);
	assert.equal((await User.findOne({ where: { username: 'splitter' } })).authScheme, 'split');

	const params = await get('/auth/login-params?username=splitter');
	assert.deepEqual(
		[params.body.data.scheme, params.body.data.kdfSalt, params.body.data.kdfParams],
		['split', keys.fields.kdfSalt, keys.fields.kdfParams]
	);
	const ok = await signIn('splitter', 'correct horse battery');
	assert.equal(ok.status, 200, JSON.stringify(ok.body));
	assert.equal(ok.body.data.user.authScheme, 'split');
	// What the device sent is the auth key; the password itself opens nothing.
	assert.equal(
		(await post('/auth/login', { username: 'splitter', password: 'correct horse battery' })).status,
		401
	);
	// And the wrap key, which never left the device, opens the private key the server returned.
	const bundle = await get('/auth/keys', { token: ok.body.data.token.token });
	const master = client.deriveKey(
		'correct horse battery',
		bundle.body.data.kdfSalt,
		bundle.body.data.kdfParams
	);
	const wrapKey = sodium.crypto_kdf_derive_from_key(32, 1, 'abcwrap_', master);
	const { ciphertext, nonce } = JSON.parse(bundle.body.data.wrappedPrivateKey);
	assert.equal(
		Buffer.from(
			(await import('../services/crypto.js')).decrypt(ciphertext, nonce, wrapKey)
		).toString('base64'),
		keys.privateKey
	);
});

test('a split password has one shape, and comes with its salt', async () => {
	const keys = client.splitKeys('another password here', 'R');
	const base = { username: 'shapely', email: 'shapely@example.com', ...keys.fields };
	for (const password of [
		'another password here',
		'short',
		keys.authKey.slice(0, 43),
		keys.authKey + '=',
		'x'.repeat(44)
	]) {
		const res = await post('/auth/user', { ...base, password });
		assert.equal(res.status, 400, password);
		assert.match(res.body.errors[0], /auth key/);
	}
	const bare = await post('/auth/user', {
		username: 'shapely',
		email: 'shapely@example.com',
		password: keys.authKey,
		authScheme: 'split'
	});
	assert.equal(bare.status, 400, 'no salt, no split');
	assert.equal(
		(await post('/auth/user', { ...base, password: keys.authKey, authScheme: 'sideways' })).status,
		400
	);
	assert.equal(await User.count({ where: { username: 'shapely' } }), 0);
});

test('a split account never goes back, and changes its password with a new salt, by its holder only', async () => {
	const first = client.splitKeys('first password here', 'R1');
	await post('/auth/user', {
		username: 'mover',
		email: 'mover@example.com',
		password: first.authKey,
		...first.fields
	});
	const session = await signIn('mover', 'first password here');
	const me = { token: session.body.data.token.token };
	const id = session.body.data.user.id;

	// Sending a real password again, with or without saying so, is refused.
	for (const body of [
		{ id, password: 'a plain password' },
		{ id, password: 'a plain password', authScheme: 'plain' }
	]) {
		const res = await put('/auth/user', body, me);
		assert.equal(res.status, 409, JSON.stringify(res.body));
		assert.equal(res.body.name, 'AuthSchemeError');
	}
	// authScheme on its own means nothing.
	assert.equal((await put('/auth/user', { id, authScheme: 'split' }, me)).status, 400);
	// A new split password without the re-wrapped key is refused.
	const next = client.splitKeys('second password here', 'R1');
	assert.equal(
		(await put('/auth/user', { id, password: next.authKey, authScheme: 'split' }, me)).status,
		400
	);
	// An admin cannot set it: the auth key is derived on the holder's device.
	const byAdmin = await put(
		'/auth/user',
		{
			id,
			password: next.authKey,
			authScheme: 'split',
			wrappedPrivateKey: next.fields.wrappedPrivateKey,
			kdfSalt: next.fields.kdfSalt,
			kdfParams: next.fields.kdfParams
		},
		f.admin
	);
	assert.equal(byAdmin.status, 400);
	// The holder, with the key re-wrapped under the new salt: done, and the old auth key is dead.
	const changed = await put(
		'/auth/user',
		{
			id,
			password: next.authKey,
			authScheme: 'split',
			wrappedPrivateKey: next.fields.wrappedPrivateKey,
			kdfSalt: next.fields.kdfSalt,
			kdfParams: next.fields.kdfParams
		},
		me
	);
	assert.equal(changed.status, 200, JSON.stringify(changed.body));
	assert.equal((await signIn('mover', 'first password here')).status, 401);
	assert.equal((await signIn('mover', 'second password here')).status, 200);
});

test('claiming, accepting an invitation, and finishing recovery can all move to split', async () => {
	// Claim.
	const w = (await post('/auth/writer', { name: 'Claimer' }, f.chapter)).body.data;
	const { token } = (await post('/auth/writer/token', { writer: w.id }, f.chapter)).body.data;
	const ck = client.splitKeys('claimed password here', 'RC');
	const plainClaim = await post('/auth/claim', {
		token,
		username: 'claimer',
		password: 'claimed password here',
		authScheme: 'split'
	});
	assert.equal(plainClaim.status, 400, 'the password itself is not an auth key');
	const claimed = await post('/auth/claim', {
		token,
		username: 'claimer',
		password: ck.authKey,
		...ck.fields
	});
	assert.equal(claimed.status, 201, JSON.stringify(claimed.body));
	assert.equal((await signIn('claimer', 'claimed password here')).status, 200);

	// Invitation.
	const invite = await post(
		'/invitation/invitation',
		{ kind: 'member', inviteeName: 'New Volunteer' },
		f.chapter
	);
	assert.equal(invite.status, 201, JSON.stringify(invite.body));
	const ik = client.splitKeys('volunteer password', 'RV');
	const accepted = await post('/invitation/accept', {
		token: invite.body.data.token,
		username: 'volunteer2',
		email: 'v2@example.com',
		password: ik.authKey,
		...ik.fields
	});
	assert.equal(accepted.status, 201, JSON.stringify(accepted.body));
	assert.equal((await signIn('volunteer2', 'volunteer password')).status, 200);

	// Recovery: a plain account with keys moves to split as it recovers.
	const plainKeys = client.accountKeys('old plain password', 'RECOVER-ME');
	await post('/auth/user', {
		username: 'recoverer',
		email: 'r@example.com',
		password: 'old plain password',
		...plainKeys.fields
	});
	const start = await get('/auth/recover?username=recoverer');
	assert.equal(start.status, 200, JSON.stringify(start.body));
	const challenge = client.open(
		start.body.data.sealedChallenge,
		plainKeys.fields.publicKey,
		plainKeys.privateKey
	);
	const rk = client.splitKeys('brand new password', 'RECOVER-ME');
	const finished = await post('/auth/recover', {
		username: 'recoverer',
		challenge: Buffer.from(challenge).toString('base64'),
		password: rk.authKey,
		authScheme: 'split',
		wrappedPrivateKey: rk.fields.wrappedPrivateKey,
		kdfSalt: rk.fields.kdfSalt,
		kdfParams: rk.fields.kdfParams
	});
	assert.equal(finished.status, 201, JSON.stringify(finished.body));
	assert.equal((await User.findOne({ where: { username: 'recoverer' } })).authScheme, 'split');
	assert.equal((await signIn('recoverer', 'brand new password')).status, 200);
	assert.equal((await signIn('recoverer', 'old plain password')).status, 401);
});

test('the readiness report counts who still sends a password', async () => {
	const report = await get('/auth/encryption-readiness', f.admin);
	assert.equal(report.status, 200);
	const { split, plain } = report.body.data.authSchemes;
	assert.ok(split >= 4, 'split ' + split);
	assert.ok(plain >= 3, 'plain ' + plain);
});

test('an account that moves to split while a plain password is being set is not moved back', async () => {
	await post('/auth/user', {
		username: 'racer',
		email: 'racer@example.com',
		password: 'plain password one'
	});
	const session = await post('/auth/login', { username: 'racer', password: 'plain password one' });
	const me = { token: session.body.data.token.token };
	const id = session.body.data.user.id;
	// Between this request's check (still plain) and its write, another device of
	// the same person moves the account to split.
	const update = User.update.bind(User);
	let raced = false;
	User.update = async (...args) => {
		if (!raced) {
			raced = true;
			await update({ authScheme: 'split' }, { where: { id } });
		}
		return await update(...args);
	};
	let res;
	try {
		res = await put('/auth/user', { id, password: 'plain password two' }, me);
	} finally {
		User.update = update;
	}
	assert.equal(res.status, 409, JSON.stringify(res.body));
	assert.equal(res.body.name, 'AuthSchemeError');
	assert.equal((await User.findByPk(id)).authScheme, 'split', 'the invariant held');
});

test('in server mode a split account needs no keys: the salt and recipe travel alone', async () => {
	// What the Android client sends on a server-mode API: the auth key with the
	// salt and recipe it came from, and no private key to wrap.
	const keys = client.splitKeys('another fine password', 'RECOVERY-CODE');
	const made = await post(
		'/auth/user',
		{
			username: 'keyless',
			email: 'keyless@example.com',
			password: keys.authKey,
			authScheme: 'split',
			kdfSalt: keys.fields.kdfSalt,
			kdfParams: keys.fields.kdfParams
		},
		f.admin
	);
	assert.equal(made.status, 201, JSON.stringify(made.body));
	assert.equal(made.body.data.authScheme, 'split');
	const params = await get('/auth/login-params?username=keyless');
	assert.deepEqual(
		[params.body.data.scheme, params.body.data.kdfSalt],
		['split', keys.fields.kdfSalt]
	);
	const ok = await signIn('keyless', 'another fine password');
	assert.equal(ok.status, 200, JSON.stringify(ok.body));
	// Only one of the pair is still refused, and a wrapped key without them.
	const half = await post('/auth/user', {
		username: 'halfway',
		email: 'halfway@example.com',
		password: keys.authKey,
		authScheme: 'split',
		kdfSalt: keys.fields.kdfSalt
	});
	assert.equal(half.status, 400);
	assert.match(half.body.errors[0], /kdfSalt and kdfParams go together/);
});

test('the Argon2id step matches the vector every client checks against', async () => {
	// The step before the two derivations: master = crypto_pwhash(32, NFKC(password), salt, params).
	// test/e2e-client.js uses scrypt as a stand-in; this is the real thing, so the web,
	// Android, and iOS sides have one number to compare with.
	// The sumo package's ESM entry (0.7.16) points at a file it does not ship; its CommonJS entry is whole.
	const { createRequire } = await import('node:module');
	const sumo = createRequire(import.meta.url)('libsodium-wrappers-sumo');
	await sumo.ready;
	const salt = new Uint8Array(16).map((_, i) => i);
	const params = { kdf: 'argon2id', alg: 2, opslimit: 2, memlimit: 67108864 };
	const master = (password) =>
		sumo.crypto_pwhash(
			32,
			sumo.from_string(password.normalize('NFKC')),
			salt,
			params.opslimit,
			params.memlimit,
			sumo.crypto_pwhash_ALG_ARGON2ID13
		);
	assert.equal(sumo.crypto_pwhash_ALG_ARGON2ID13, params.alg);
	const m = master('correct horse battery staple');
	assert.equal(Buffer.from(m).toString('base64'), 'wFzkxN1+DkXuYBHMWdBoreR98bAfwM+c1GeL32ilt7A=');
	assert.equal(
		Buffer.from(sodium.crypto_kdf_derive_from_key(32, 1, 'abcwrap_', m)).toString('base64'),
		'tOggbVRmxTeDlXjvpt6YS1UxcYLSb8DRaDfpFMXoEv8='
	);
	assert.equal(
		Buffer.from(sodium.crypto_kdf_derive_from_key(32, 2, 'abcauth_', m)).toString('base64'),
		'OY25VECyUEJUDcyPZSqK4R+oG5BvSzBlQNOrdiwgkR4='
	);
	// NFKC: the composed and the decomposed spelling of one word are one password.
	const composed = Buffer.from(master('caf\u00e9')).toString('base64');
	assert.equal(composed, 'lEpmh4tmC0xaD5DhMboQo/3Hw7JqT3VThdqq0n1pImc=');
	assert.equal(Buffer.from(master('cafe\u0301')).toString('base64'), composed);
});

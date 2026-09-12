import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
	startServer,
	stopServer,
	api,
	get,
	post,
	put,
	login,
	makeFixtures,
	makeUser,
	RevokedToken
} from './helpers.js';
import * as client from './e2e-client.js';

let f;
let admin;

before(async () => {
	await startServer();
	f = await makeFixtures();
	admin = { token: f.admin.token };
});
after(stopServer);

const me = (who) => get('/auth/user?id=' + who.id, who);

test('logging out revokes this token and nothing else', async () => {
	const u = await makeUser({ username: 'twophones' });
	const phone = { token: await login('twophones', u.password), id: u.id };
	const laptop = { token: u.token, id: u.id };
	assert.equal((await me(phone)).status, 200);

	const res = await post('/auth/logout', {}, phone);
	assert.equal(res.status, 200);
	assert.equal(res.body.data.everywhere, false);
	assert.match(res.body.info, /This token no longer works/);
	assert.equal((await me(phone)).status, 401);
	assert.equal((await me(laptop)).status, 200, 'the other device stays signed in');
	assert.equal(
		(await post('/auth/logout', {}, phone)).status,
		401,
		'a revoked token cannot log out again'
	);
	assert.equal(await RevokedToken.count(), 1);

	const again = { token: await login('twophones', u.password), id: u.id };
	assert.equal((await me(again)).status, 200, 'logging in again issues a fresh token');
});

test('logging out everywhere ends every session for the account', async () => {
	const u = await makeUser({ username: 'everywhere' });
	const a = { token: u.token, id: u.id };
	const b = { token: await login('everywhere', u.password), id: u.id };
	const res = await post('/auth/logout', { everywhere: true }, a);
	assert.equal(res.status, 200);
	assert.equal(res.body.data.everywhere, true);
	assert.equal((await me(a)).status, 401);
	assert.equal((await me(b)).status, 401);
	// A new login works and is not caught by the revocation instant.
	const c = { token: await login('everywhere', u.password), id: u.id };
	assert.equal((await me(c)).status, 200);
});

test('an admin can revoke every session of an account without banning it', async () => {
	const u = await makeUser({ username: 'lostphone' });
	const lost = { token: u.token, id: u.id };
	assert.equal((await post('/auth/revoke', { user: u.id }, lost)).status, 403);
	const res = await post('/auth/revoke', { user: u.id }, admin);
	assert.equal(res.status, 200);
	assert.ok(res.body.data.sessionsRevokedAt);
	assert.equal((await me(lost)).status, 401);
	assert.equal((await post('/auth/revoke', { user: 999999 }, admin)).status, 404);
	const fresh = { token: await login('lostphone', u.password), id: u.id };
	assert.equal((await me(fresh)).status, 200, 'the account itself still works');
	const log = await get('/moderation/audit?action=user.revoke', admin);
	assert.ok(log.body.data.some((e) => e.targetId === u.id));
});

test('a password change ends other sessions and hands back a fresh token', async () => {
	const u = await makeUser({ username: 'rotator' });
	const other = { token: await login('rotator', u.password), id: u.id };
	const res = await put('/auth/user', { id: u.id, password: 'rotatedpass' }, { token: u.token });
	assert.equal(res.status, 200);
	assert.ok(res.body.data.token && res.body.data.token.token, 'a fresh token comes back');
	assert.equal(
		(await me({ token: u.token, id: u.id })).status,
		401,
		'the token used to change it is gone'
	);
	assert.equal((await me(other)).status, 401, 'and so is the other device');
	const fresh = { token: res.body.data.token.token, id: u.id };
	assert.equal((await me(fresh)).status, 200);

	// An admin reset ends the user's sessions and returns no token.
	const reset = await put('/auth/user', { id: u.id, password: 'adminresetpw' }, admin);
	assert.equal(reset.status, 200);
	assert.equal(reset.body.data.token, undefined);
	assert.equal((await me(fresh)).status, 401);
	assert.equal(
		(await post('/auth/login', { username: 'rotator', password: 'adminresetpw' })).status,
		200
	);
});

test('recovery ends every session', async () => {
	await client.ready;
	const u = await makeUser({ username: 'recoverer' });
	const before = { token: u.token, id: u.id };
	const { privateKey, fields } = client.accountKeys(u.password, 'RECOVERY-code');
	assert.equal((await put('/auth/keys', fields, before)).status, 200);
	const start = await get('/auth/recover?username=recoverer');
	const challenge = Buffer.from(
		client.open(start.body.data.sealedChallenge, fields.publicKey, privateKey)
	).toString('base64');
	const pw = client.wrapPrivateKey(privateKey, 'recoveredpass', '');
	const done = await post('/auth/recover', {
		username: 'recoverer',
		challenge,
		password: 'recoveredpass',
		wrappedPrivateKey: pw.WrappedPrivateKey,
		kdfSalt: pw.Salt,
		kdfParams: pw.KdfParams
	});
	assert.equal(done.status, 201);
	assert.equal((await me(before)).status, 401);
	assert.equal(
		(await post('/auth/login', { username: 'recoverer', password: 'recoveredpass' })).status,
		200
	);
});

test('expired revocations are swept', async () => {
	await RevokedToken.revoke('old-token', null, new Date(Date.now() - 1000));
	await RevokedToken.revoke('live-token', null, new Date(Date.now() + 1000000));
	const removed = await RevokedToken.sweep();
	assert.ok(removed >= 1);
	assert.equal(await RevokedToken.isRevoked('old-token'), false);
	assert.equal(await RevokedToken.isRevoked('live-token'), true);
});

test('logout works without a request body', async () => {
	const u = await makeUser({ username: 'bodyless' });
	const res = await api('POST', '/auth/logout', { token: u.token });
	assert.equal(res.status, 200, JSON.stringify(res.body));
	assert.equal((await me({ token: u.token, id: u.id })).status, 401);
});

test('the revocation marker cannot be cleared through the user update', async () => {
	const u = await makeUser({ username: 'sneaky' });
	const a = { token: u.token, id: u.id };
	await post('/auth/revoke', { user: u.id }, admin);
	const b = { token: await login('sneaky', u.password), id: u.id };
	const clear = await put('/auth/user', { id: u.id, sessionsRevokedAt: null }, b);
	assert.equal(clear.status, 403);
	assert.match(clear.body.info, /cannot be set directly/);
	assert.equal(
		(await put('/auth/user', { id: u.id, sessionsRevokedAt: '2000-01-01T00:00:00.000Z' }, admin))
			.status,
		403
	);
	assert.equal((await me(a)).status, 401, 'the old token stays revoked');
	assert.equal((await me(b)).status, 200);
});

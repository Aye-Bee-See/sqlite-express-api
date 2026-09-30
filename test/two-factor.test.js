import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, makeUser, get, post, del } from './helpers.js';
import { base32Encode, codeAt, stepAt, verify } from '../services/totp.js';
import AuditLog from '../database/models/audit-log.model.js';

before(startServer);
after(stopServer);

test('the codes are the ones every authenticator app makes (RFC 6238)', () => {
	// The RFC's SHA-1 secret, and its first two test times; six digits are the last six.
	const secret = base32Encode(Buffer.from('12345678901234567890'));
	assert.equal(secret, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
	assert.equal(codeAt(secret, stepAt(59 * 1000)), '287082');
	assert.equal(codeAt(secret, stepAt(1111111109 * 1000)), '081804');
	// A clock a step out either way is fine; two steps is not; a used step is refused.
	const now = 1111111109 * 1000;
	assert.equal(verify(secret, '081804', { now: now + 30_000 }), stepAt(now));
	assert.equal(verify(secret, '081804', { now: now + 60_000 }), null);
	assert.equal(verify(secret, '081804', { now, after: stepAt(now) }), null);
	assert.equal(verify(secret, '08 18 04', { now }), stepAt(now), 'spaces are ignored');
});

const signIn = (who) =>
	post('/auth/login', { username: who.user.username, password: who.password });

/** Switch two-factor sign-in on for an account; answers the secret and recovery codes. */
async function switchOn(who) {
	const setup = await post('/auth/two-factor/setup', {}, who);
	assert.equal(setup.status, 200, JSON.stringify(setup.body));
	const { secret } = setup.body.data;
	const confirmed = await post('/auth/two-factor/confirm', { code: codeAt(secret, stepAt()) }, who);
	assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
	return { secret, recoveryCodes: confirmed.body.data.recoveryCodes };
}

test('setting it up: a secret and a link for the app, then a code confirms it and shows recovery codes once', async () => {
	const who = await makeUser({ username: 'twofactorset' });
	assert.deepEqual((await get('/auth/two-factor', who)).body.data, {
		enabled: false,
		enabledAt: null,
		settingUp: false,
		recoveryCodesLeft: 0,
		required: false,
		requiredBecause: []
	});
	const setup = await post('/auth/two-factor/setup', {}, who);
	assert.match(setup.body.data.secret, /^[A-Z2-7]{32}$/);
	assert.match(
		setup.body.data.otpauthUri,
		/^otpauth:\/\/totp\/letters\.support%3Atwofactorset\?secret=/
	);
	assert.equal((await get('/auth/two-factor', who)).body.data.settingUp, true);

	const wrong = await post('/auth/two-factor/confirm', { code: '000000' }, who);
	assert.equal(wrong.status, 400);
	assert.deepEqual(wrong.body.problems, [{ field: 'code', code: 'not_eligible' }]);

	const ok = await post(
		'/auth/two-factor/confirm',
		{ code: codeAt(setup.body.data.secret, stepAt()) },
		who
	);
	assert.equal(ok.status, 200, JSON.stringify(ok.body));
	assert.equal(ok.body.data.recoveryCodes.length, 10);
	assert.ok(ok.body.data.recoveryCodes.every((c) => /^[0-9A-Z]{5}-[0-9A-Z]{5}$/.test(c)));
	const status = (await get('/auth/two-factor', who)).body.data;
	assert.equal(status.enabled, true);
	assert.equal(status.recoveryCodesLeft, 10);
	assert.equal((await post('/auth/two-factor/setup', {}, who)).status, 409, 'on already');
	assert.ok(
		await AuditLog.findOne({ where: { action: 'user.two-factor.enable', targetId: who.id } })
	);

	// The secret never leaves the two-factor endpoints.
	const me = await get('/auth/user?id=' + who.id, who);
	for (const column of ['totpSecret', 'totpPendingSecret', 'totpEnabledAt', 'totpLastStep']) {
		assert.equal(column in me.body.data, false, column);
	}
});

test('signing in: the password gives a challenge, not a session; the code finishes it, once', async () => {
	const who = await makeUser({ username: 'twofactorin' });
	const { secret } = await switchOn(who);

	const first = await signIn(who);
	assert.equal(first.status, 200, JSON.stringify(first.body));
	assert.deepEqual(Object.keys(first.body.data), ['twoFactor']);
	const { challenge } = first.body.data.twoFactor;
	assert.ok(first.body.data.twoFactor.expiresAt);
	// The challenge is not a session.
	assert.equal((await get('/auth/two-factor', { token: challenge })).status, 401);

	const wrong = await post('/auth/login/two-factor', { challenge, code: '123456' });
	assert.equal(wrong.status, 400, JSON.stringify(wrong.body));
	assert.equal(wrong.body.problems[0].field, 'code');

	// The code confirming set-up was this step's, so the next step's code signs in.
	const code = codeAt(secret, stepAt() + 1);
	const done = await post('/auth/login/two-factor', { challenge, code });
	assert.equal(done.status, 200, JSON.stringify(done.body));
	assert.ok(done.body.data.token.token, 'a session');
	assert.equal(done.body.data.user.id, who.id);
	assert.equal('totpSecret' in done.body.data.user, false);
	assert.equal((await get('/auth/two-factor', { token: done.body.data.token.token })).status, 200);

	// The challenge is spent, and the code cannot be used again either.
	const again = await post('/auth/login/two-factor', { challenge, code });
	assert.equal(again.status, 401, JSON.stringify(again.body));
	assert.equal(again.body.condition, 'challenge_expired');
	const fresh = (await signIn(who)).body.data.twoFactor.challenge;
	const replay = await post('/auth/login/two-factor', { challenge: fresh, code });
	assert.equal(replay.status, 400, 'a code works once');
});

test('a recovery code signs in once, in any spelling; then it is gone', async () => {
	const who = await makeUser({ username: 'twofactorlost' });
	const { recoveryCodes } = await switchOn(who);
	const typed = recoveryCodes[0].toLowerCase().replace('-', ' ').replace(/0/g, 'o');
	const challenge = (await signIn(who)).body.data.twoFactor.challenge;
	const done = await post('/auth/login/two-factor', { challenge, recoveryCode: typed });
	assert.equal(done.status, 200, JSON.stringify(done.body));
	assert.equal((await get('/auth/two-factor', who)).body.data.recoveryCodesLeft, 9);
	assert.ok(
		await AuditLog.findOne({ where: { action: 'user.two-factor.recovery-used', targetId: who.id } })
	);
	const again = (await signIn(who)).body.data.twoFactor.challenge;
	const reused = await post('/auth/login/two-factor', {
		challenge: again,
		recoveryCode: recoveryCodes[0]
	});
	assert.equal(reused.status, 400);
	assert.equal(reused.body.problems[0].field, 'recoveryCode');
});

test('new recovery codes replace the old; switching it off needs a code, and sign-in is one step again', async () => {
	const who = await makeUser({ username: 'twofactoroff' });
	const { secret, recoveryCodes: old } = await switchOn(who);
	const renewed = await post(
		'/auth/two-factor/recovery-codes',
		{ code: codeAt(secret, stepAt() + 1) },
		who
	);
	assert.equal(renewed.status, 200, JSON.stringify(renewed.body));
	assert.equal(renewed.body.data.recoveryCodes.length, 10);
	const challenge = (await signIn(who)).body.data.twoFactor.challenge;
	assert.equal(
		(await post('/auth/login/two-factor', { challenge, recoveryCode: old[1] })).status,
		400,
		'the old codes stopped working'
	);

	assert.equal((await del('/auth/two-factor', {}, who)).status, 400, 'a code is needed');
	const off = await del(
		'/auth/two-factor',
		{ recoveryCode: renewed.body.data.recoveryCodes[0] },
		who
	);
	assert.equal(off.status, 200, JSON.stringify(off.body));
	assert.equal((await get('/auth/two-factor', who)).body.data.enabled, false);
	const plain = await signIn(who);
	assert.ok(plain.body.data.token, 'one step again');
	assert.equal((await del('/auth/two-factor', { code: '000000' }, who)).status, 409, 'not on');
	assert.ok(
		await AuditLog.findOne({ where: { action: 'user.two-factor.disable', targetId: who.id } })
	);
});

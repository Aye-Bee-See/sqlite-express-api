#!/usr/bin/env node
/**
 * The auth key a client would send for an account: what POST /auth/login
 * takes as `password` once an account uses the split scheme (README, "Signing
 * in without sending the password"). For curl and scripts against a
 * development server; the real clients derive it themselves.
 *
 *   npm run auth-key -- <username> <password> [apiUrl]
 *
 * Asks the API for the account's salt and recipe (GET /auth/login-params),
 * derives with Argon2id (the sumo build of libsodium, a dev dependency), and
 * prints the auth key. Nothing is sent but the username.
 */
import { createRequire } from 'node:module';

const [username, password, apiUrl = 'http://localhost:' + (process.env.PORT || 3000)] =
	process.argv.slice(2);
if (!username || !password) {
	console.error('usage: npm run auth-key -- <username> <password> [apiUrl]');
	process.exit(2);
}
const sumo = createRequire(import.meta.url)('libsodium-wrappers-sumo');
await sumo.ready;
const res = await fetch(apiUrl + '/auth/login-params?username=' + encodeURIComponent(username));
const body = await res.json();
if (!res.ok || !body.data) {
	console.error('login-params answered ' + res.status + ': ' + JSON.stringify(body));
	process.exit(1);
}
const { scheme, kdfSalt, kdfParams } = body.data;
if (scheme !== 'split') {
	console.error(
		username +
			' still signs in with its password (scheme ' +
			scheme +
			'); send the password itself.'
	);
	process.exit(1);
}
// The one recipe the clients agreed on (README, "End-to-end encryption"). The
// server stores any recipe a client names, so refuse the rest rather than
// print a key that can never sign in.
if (kdfParams?.kdf !== 'argon2id' || kdfParams.alg !== sumo.crypto_pwhash_ALG_ARGON2ID13) {
	console.error(
		username +
			"'s recipe is not Argon2id 1.3 (" +
			JSON.stringify(kdfParams) +
			'); this script derives only that one.'
	);
	process.exit(1);
}
const master = sumo.crypto_pwhash(
	32,
	sumo.from_string(password.normalize('NFKC')),
	Buffer.from(kdfSalt, 'base64'),
	kdfParams.opslimit,
	kdfParams.memlimit,
	sumo.crypto_pwhash_ALG_ARGON2ID13
);
console.log(
	Buffer.from(sumo.crypto_kdf_derive_from_key(32, 2, 'abcauth_', master)).toString('base64')
);

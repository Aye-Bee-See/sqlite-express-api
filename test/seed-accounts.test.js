import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const sumo = require('libsodium-wrappers-sumo');
const { seeds } = JSON.parse(
	readFileSync(new URL('../database/seeds/userSeed.json', import.meta.url), 'utf8')
);

/** The documented passwords (README, "Credentials"). */
const passwords = { admin: 'abcpassword', chapter1: 'a long enough password' };
for (let n = 1; n <= 40; n += 1) {
	passwords['user' + n] = 'password' + n;
}

test('every seeded account is a split account whose auth key comes from its documented password', async () => {
	await sumo.ready;
	assert.equal(seeds.length, 42);
	for (const row of seeds) {
		assert.equal(row.authScheme, 'split', row.username);
		assert.deepEqual(
			row.kdfParams,
			{ kdf: 'argon2id', alg: 2, opslimit: 2, memlimit: 67108864 },
			row.username
		);
		const salt = createHash('sha256')
			.update('letters.support seed salt ' + row.username)
			.digest()
			.subarray(0, 16);
		assert.equal(
			row.kdfSalt,
			Buffer.from(salt).toString('base64'),
			row.username + ': the seed salt is deterministic'
		);
		const master = sumo.crypto_pwhash(
			32,
			sumo.from_string(passwords[row.username].normalize('NFKC')),
			Buffer.from(row.kdfSalt, 'base64'),
			row.kdfParams.opslimit,
			row.kdfParams.memlimit,
			sumo.crypto_pwhash_ALG_ARGON2ID13
		);
		const authKey = Buffer.from(
			sumo.crypto_kdf_derive_from_key(32, 2, 'abcauth_', master)
		).toString('base64');
		assert.equal(
			row.password,
			authKey,
			row.username + ': the stored auth key is the one a client derives'
		);
	}
	const chapter = seeds.find((row) => row.username === 'chapter1');
	assert.deepEqual([chapter.role, chapter.chapterId], ['chapter', 1]);
	assert.equal(seeds.filter((row) => row.role === 'admin').length, 1);
});

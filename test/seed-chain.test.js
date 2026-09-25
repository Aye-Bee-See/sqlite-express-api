import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { startServer, stopServer, post, get, User, Chapter } from './helpers.js';
import { createSeeds } from '../database/seeds/all.seeds.js';

const run = promisify(execFile);
const script = fileURLToPath(new URL('../scripts/auth-key.js', import.meta.url));
const baseUrl = await startServer();
await createSeeds();
after(stopServer);

/** What `npm run auth-key -- <username> <password> <apiUrl>` prints, or its failure. */
async function authKey(username, password) {
	try {
		const { stdout } = await run(process.execPath, [script, username, password, baseUrl]);
		return { code: 0, out: stdout.trim() };
	} catch (err) {
		return { code: err.code, out: err.stderr.trim() };
	}
}

test('the seeded group admin signs in with the key auth-key derives, as a group admin of Test Chapter', async () => {
	const chapter = await Chapter.findOne({ where: { name: 'Test Chapter' } });
	const { code, out } = await authKey('chapter1', 'a long enough password');
	assert.equal(code, 0, out);
	const res = await post('/auth/login', { username: 'chapter1', password: out });
	assert.equal(res.status, 200, JSON.stringify(res.body));
	assert.equal(res.body.data.user.role, 'chapter');
	const row = await User.findOne({ where: { username: 'chapter1' } });
	assert.equal(row.chapterId, chapter.id);
	const refused = await post('/auth/login', {
		username: 'chapter1',
		password: 'a long enough password'
	});
	assert.notEqual(refused.status, 200, 'a split account never takes its password');
});

test('the seeded admin signs in with the documented auth key', async () => {
	const { out } = await authKey('admin', 'abcpassword');
	assert.equal(out, 'sgecshRAYib5Nf55Ru7liO8bcl6I8/FtrhDmYah1zkc=');
	const res = await post('/auth/login', { username: 'admin', password: out });
	assert.equal(res.status, 200, JSON.stringify(res.body));
});

test('auth-key refuses a recipe it cannot derive instead of printing a useless key', async () => {
	await User.create({
		username: 'scrypt-account',
		email: 'scrypt@example.com',
		role: 'user',
		password: 'A'.repeat(43) + '=',
		authScheme: 'split',
		kdfSalt: 'AAECAwQFBgcICQoLDA0ODw==',
		kdfParams: { kdf: 'scrypt', N: 32768 }
	});
	const params = await get('/auth/login-params?username=scrypt-account');
	assert.equal(params.body.data.kdfParams.kdf, 'scrypt');
	const { code, out } = await authKey('scrypt-account', 'whatever it is');
	assert.equal(code, 1);
	assert.match(out, /not Argon2id/);
});

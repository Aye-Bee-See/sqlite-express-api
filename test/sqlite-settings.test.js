import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// A database on disk, because that is where these settings matter: the
// in-memory database the other tests use has one connection and no journal.
const dir = mkdtempSync(join(tmpdir(), 'abc-sqlite-'));
process.env.DOTENV_CONFIG_PATH = '/dev/null';
process.env.JWT_SECRET = 'test-secret';
process.env.DB_STORAGE = join(dir, 'settings.sqlite');
process.env.DB_RESET = 'false';
process.env.DB_SEED = 'false';
process.env.DB_LOGGING = 'false';
process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_MODE = 'server';
process.env.ENCRYPTION_KEY = 'dGVzdC1rZXktdGVzdC1rZXktdGVzdC1rZXktdGVzdCE=';
process.env.UPLOAD_DIR = join(dir, 'uploads');

const db = await import('../database/sql-database.js');
const { BUSY_TIMEOUT_MS } = await import('../database/connection.js');
await db.ready;
after(async () => {
	await db.sequelize.close();
	rmSync(dir, { recursive: true, force: true });
});

test('a database on disk uses write-ahead logging, and foreign keys stay on', async () => {
	const [[journal]] = await db.sequelize.query('PRAGMA journal_mode');
	assert.equal(journal.journal_mode, 'wal');
	// Sequelize answers this one pragma with a flat array.
	const [keys] = await db.sequelize.query('PRAGMA foreign_keys');
	assert.equal(keys.foreign_keys, 1);
});

test('every connection waits for a lock, including the one a transaction gets', async () => {
	const [[plain]] = await db.sequelize.query('PRAGMA busy_timeout');
	assert.equal(plain.timeout, BUSY_TIMEOUT_MS);
	await db.sequelize.transaction(async (transaction) => {
		const [[inside]] = await db.sequelize.query('PRAGMA busy_timeout', { transaction });
		assert.equal(inside.timeout, BUSY_TIMEOUT_MS, 'a transaction has its own connection on disk');
	});
});

test('a read is not blocked while a transaction holds the write lock', async () => {
	const { Prison } = db;
	await db.sequelize.transaction(async (transaction) => {
		await Prison.create({ prisonName: 'Held in a transaction', address: {} }, { transaction });
		// Rollback-journal mode would make this wait for the commit; WAL lets it through,
		// and it must not see the uncommitted row.
		const started = Date.now();
		const seen = await Prison.count({ where: { prisonName: 'Held in a transaction' } });
		assert.equal(seen, 0);
		assert.ok(Date.now() - started < 1000, 'the read returned without waiting');
	});
	assert.equal(await Prison.count({ where: { prisonName: 'Held in a transaction' } }), 1);
});

test('a write that meets the lock waits its turn instead of failing', async () => {
	const { Prison } = db;
	let release;
	const held = new Promise((resolve) => (release = resolve));
	const holder = db.sequelize.transaction(async (transaction) => {
		await Prison.create({ prisonName: 'First writer', address: {} }, { transaction });
		await held;
	});
	// The second write arrives while the first still holds the lock.
	const second = Prison.create({ prisonName: 'Second writer', address: {} });
	setTimeout(release, 300);
	await Promise.all([holder, second]);
	assert.equal(await Prison.count({ where: { prisonName: ['First writer', 'Second writer'] } }), 2);
});

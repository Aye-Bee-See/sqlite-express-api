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
const { LOCK_RETRY } = await import('../database/connection.js');
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

test('waiting for a lock is done from JavaScript, never inside SQLite', async () => {
	// SQLite's busy timeout blocks one of Node's four database threads for as long as
	// it waits; enough waiters, and the transaction that holds the lock cannot run.
	const [[plain]] = await db.sequelize.query('PRAGMA busy_timeout');
	assert.equal(plain.timeout, 0);
	await db.sequelize.transaction(async (transaction) => {
		const [[inside]] = await db.sequelize.query('PRAGMA busy_timeout', { transaction });
		assert.equal(inside.timeout, 0, 'a transaction has its own connection on disk');
	});
	assert.deepEqual(db.sequelize.options.retry, LOCK_RETRY);
	assert.ok(LOCK_RETRY.match.some((pattern) => pattern.test('SQLITE_BUSY: database is locked')));
	// Long enough to outlast any transaction this API runs.
	let total = 0;
	for (let i = 0; i < LOCK_RETRY.max; i += 1) {
		total += LOCK_RETRY.backoffBase * LOCK_RETRY.backoffExponent ** i;
	}
	assert.ok(total > 5000 && total < 20000, 'waits about ten seconds in all: ' + Math.round(total));
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
	// Longer than Sequelize's default few retries of SQLITE_BUSY would cover (about
	// half a second in all): only LOCK_RETRY gets the second write through this.
	const HOLD_MS = 1500;
	let release;
	let locked;
	const held = new Promise((resolve) => (release = resolve));
	const holding = new Promise((resolve) => (locked = resolve));
	const holder = db.sequelize.transaction(async (transaction) => {
		await Prison.create({ prisonName: 'First writer', address: {} }, { transaction });
		locked();
		await held;
	});
	// Only once the first writer has written, and so holds the lock for certain: started
	// any earlier, the second write could win the race and prove nothing.
	await holding;
	const started = Date.now();
	const second = Prison.create({ prisonName: 'Second writer', address: {} });
	setTimeout(release, HOLD_MS);
	await Promise.all([holder, second]);
	// Without the retries it fails with SQLITE_BUSY; with them, it is still trying
	// when the lock is let go.
	assert.ok(Date.now() - started >= HOLD_MS - 50, 'the second write waited for the lock');
	assert.equal(await Prison.count({ where: { prisonName: ['First writer', 'Second writer'] } }), 2);
});

test('many writers at once all get through, and quickly', async () => {
	// What never finished before: more transactions waiting for the lock than Node
	// has database threads, each blocking one, starving the transaction that held it.
	const { Prison } = db;
	const started = Date.now();
	await Promise.all(
		Array.from({ length: 24 }, (_, i) =>
			db.sequelize.transaction(async (transaction) => {
				const prison = await Prison.create(
					{ prisonName: 'Crowd ' + i, address: {} },
					{ transaction }
				);
				await prison.update({ notes: 'second statement in the same transaction' }, { transaction });
			})
		)
	);
	assert.equal(
		await Prison.count({ where: { notes: 'second statement in the same transaction' } }),
		24
	);
	assert.ok(Date.now() - started < 5000, 'took ' + (Date.now() - started) + ' ms');
});

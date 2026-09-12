import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET = 'test-secret';
process.env.DB_STORAGE = ':memory:';
process.env.DB_RESET = 'false';
process.env.DB_SEED = 'false';
process.env.DB_LOGGING = 'false';
process.env.ADMIN_USERNAME = '';
process.env.ADMIN_PASSWORD = '';
process.env.ADMIN_EMAIL = '';
process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_MODE = 'server';
process.env.ENCRYPTION_KEY = 'dGVzdC1rZXktdGVzdC1rZXktdGVzdC1rZXktdGVzdCE=';

const { Sequelize } = await import('sequelize');
const db = await import('../database/sql-database.js');
const { createMigrator, runMigrations, INITIAL_MIGRATION } = await import('../database/migrate.js');

before(() => db.ready);
after(() => db.sequelize.close());

test('boot applies the migrations and records them in SequelizeMeta', async () => {
	const umzug = createMigrator(db.sequelize, { quiet: true });
	const executed = (await umzug.executed()).map((m) => m.name);
	assert.ok(executed.includes(INITIAL_MIGRATION));
	assert.deepEqual(await umzug.pending(), []);
	const tables = await db.sequelize.getQueryInterface().showAllTables();
	for (const t of [
		'User',
		'Prisons',
		'Prisoners',
		'Rules',
		'Chats',
		'Messages',
		'Chapters',
		'RulePassthrough'
	]) {
		assert.ok(tables.includes(t), 'missing table ' + t);
	}
});

test('the migrated schema matches the models (no drift)', async () => {
	const qi = db.sequelize.getQueryInterface();
	for (const model of Object.values(db.sequelize.models)) {
		const table = model.getTableName();
		const columns = await qi.describeTable(table);
		const attributes = Object.fromEntries(
			Object.entries(model.getAttributes()).filter(([, a]) => a.type.key !== 'VIRTUAL')
		);
		const expected = Object.values(attributes).map((a) => a.field);
		assert.deepEqual(
			Object.keys(columns).sort(),
			[...expected].sort(),
			table + ': column set differs between migration and model'
		);
		for (const attribute of Object.values(attributes)) {
			const column = columns[attribute.field];
			// SQLite reports INTEGER PRIMARY KEY columns as nullable; they are not.
			if (!attribute.primaryKey) {
				const modelAllowsNull = attribute.allowNull !== false;
				assert.equal(
					column.allowNull,
					modelAllowsNull,
					table + '.' + attribute.field + ': allowNull differs (model ' + modelAllowsNull + ')'
				);
			}
			assert.equal(
				Boolean(column.primaryKey),
				Boolean(attribute.primaryKey),
				table + '.' + attribute.field + ': primaryKey differs'
			);
		}
	}
});

test('a database built by sync() before migrations existed is adopted, not re-created', async () => {
	const legacy = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false });
	// Reproduce a sync()-era database: the initial schema with no migration ledger.
	await createMigrator(legacy, { quiet: true }).up({ to: INITIAL_MIGRATION });
	await legacy.query('DELETE FROM SequelizeMeta');
	await legacy.query(
		"INSERT INTO Prisons (prisonName, address, createdAt, updatedAt) VALUES ('Keep me', '{}', datetime('now'), datetime('now'))"
	);
	const later = (await createMigrator(legacy, { quiet: true }).pending())
		.map((m) => m.name)
		.filter((n) => n !== INITIAL_MIGRATION);

	const messages = [];
	const applied = await runMigrations(legacy, { log: (m) => messages.push(m) });
	assert.deepEqual(applied, later);
	assert.ok(messages.some((m) => m.includes('adopted')));
	const executed = (await createMigrator(legacy, { quiet: true }).executed()).map((m) => m.name);
	assert.equal(executed[0], INITIAL_MIGRATION);
	assert.deepEqual(executed.slice(1), later);
	const [rows] = await legacy.query('SELECT prisonName, recordStatus FROM Prisons');
	assert.equal(rows[0].prisonName, 'Keep me');
	assert.equal(rows[0].recordStatus, 'published');

	// Running again is a no-op.
	assert.deepEqual(await runMigrations(legacy, { quiet: true }), []);
	await legacy.close();
});

test('reset drops everything and replays the history', async () => {
	const fresh = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false });
	const history = (await createMigrator(fresh, { quiet: true }).pending()).map((m) => m.name);
	assert.equal(history[0], INITIAL_MIGRATION);
	assert.deepEqual(await runMigrations(fresh, { quiet: true }), history);
	await fresh.query(
		"INSERT INTO Rules (title, description, createdAt, updatedAt) VALUES ('t', 'd', datetime('now'), datetime('now'))"
	);
	assert.deepEqual(await runMigrations(fresh, { reset: true, quiet: true }), history);
	const [rows] = await fresh.query('SELECT COUNT(*) AS n FROM Rules');
	assert.equal(rows[0].n, 0);
	await fresh.close();
});

test('every migration can be reverted and re-applied', async () => {
	const fresh = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false });
	const umzug = createMigrator(fresh, { quiet: true });
	await umzug.up();
	await umzug.down({ to: 0 });
	assert.deepEqual(await umzug.executed(), []);
	const tables = await fresh.getQueryInterface().showAllTables();
	assert.ok(!tables.includes('User'));
	await umzug.up();
	assert.deepEqual(await umzug.pending(), []);
	await fresh.close();
});

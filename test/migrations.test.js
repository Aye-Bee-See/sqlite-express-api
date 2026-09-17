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
	for (const t of ['User', 'Prisons', 'Prisoners', 'Chats', 'Messages', 'Chapters']) {
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
		"INSERT INTO Prisons (prisonName, address, createdAt, updatedAt) VALUES ('t', '{}', datetime('now'), datetime('now'))"
	);
	assert.deepEqual(await runMigrations(fresh, { reset: true, quiet: true }), history);
	const [rows] = await fresh.query('SELECT COUNT(*) AS n FROM Prisons');
	assert.equal(rows[0].n, 0);
	await fresh.close();
});

test('the mail rule migration turns attached rule records into tags and limits', async () => {
	const old = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false });
	const MIGRATION = '2026.09.17T01.00.00.mail-rule-tags.js';
	const names = (await createMigrator(old, { quiet: true }).pending()).map((m) => m.name);
	await createMigrator(old, { quiet: true }).up({ to: names[names.indexOf(MIGRATION) - 1] });

	const now = "datetime('now'), datetime('now')";
	await old.query(
		"INSERT INTO Prisons (id, prisonName, address, notes, createdAt, updatedAt) VALUES (1, 'Converted', '{}', 'Slow mail', " +
			now +
			"), (2, 'No photos at all', '{}', NULL, " +
			now +
			"), (3, 'Untouched', '{}', NULL, " +
			now +
			')'
	);
	const rules = [
		[1, 'No polaroids'],
		[2, 'Page limit: 10'],
		[3, 'Page limit: 5'],
		[4, 'Photos: maximum 5'],
		[5, 'Spanish or English'],
		[6, 'English only'],
		[7, 'No pictures'],
		[8, 'Visitors must sign in']
	];
	for (const [id, title] of rules) {
		await old.query(
			'INSERT INTO Rules (id, title, description, createdAt, updatedAt) VALUES (:id, :title, :description, ' +
				now +
				')',
			{ replacements: { id, title, description: id === 8 ? 'At the front desk' : 'text' } }
		);
	}
	const attach = async (prison, rule) =>
		await old.query(
			'INSERT INTO RulePassthrough (prison, rule, createdAt, updatedAt) VALUES (:prison, :rule, ' +
				now +
				')',
			{ replacements: { prison, rule } }
		);
	for (const rule of [1, 2, 3, 4, 5, 6, 8]) {
		await attach(1, rule);
	}
	await attach(2, 7);
	await attach(2, 4);

	await runMigrations(old, { quiet: true });
	const [rows] = await old.query(
		'SELECT id, mailRules, pageLimit, photoLimit, mailLanguages, notes FROM Prisons ORDER BY id'
	);
	const [converted, noPhotos, untouched] = rows;
	assert.deepEqual(JSON.parse(converted.mailRules), ['no_polaroids']);
	assert.equal(converted.pageLimit, 5, 'the stricter of two limits');
	assert.equal(converted.photoLimit, 5);
	assert.deepEqual(JSON.parse(converted.mailLanguages).sort(), ['en', 'es']);
	assert.equal(
		converted.notes,
		'Slow mail\nMail rule (not converted to a tag): Visitors must sign in: At the front desk',
		'a hand-written rule keeps its words'
	);
	assert.deepEqual(JSON.parse(noPhotos.mailRules), ['no_photos']);
	assert.equal(noPhotos.photoLimit, null, 'no photos means no photo limit');
	assert.deepEqual(JSON.parse(untouched.mailRules), []);
	assert.equal(untouched.notes, null);
	const tables = await old.getQueryInterface().showAllTables();
	assert.ok(!tables.includes('Rules') && !tables.includes('RulePassthrough'));

	// Down brings the tables back with a rule per tag or limit in use.
	const migration = await import('../database/migrations/' + MIGRATION);
	await migration.down({ context: old.getQueryInterface() });
	const [restored] = await old.query(
		'SELECT r.title FROM RulePassthrough p JOIN Rules r ON r.id = p.rule WHERE p.prison = 1 ORDER BY r.title'
	);
	assert.deepEqual(
		restored.map((r) => r.title),
		['No polaroids', 'Page limit: 5', 'Photos: maximum 5', 'Spanish or English']
	);
	const [stillThere] = await old.query('SELECT COUNT(*) AS n FROM Prisons');
	assert.equal(stillThere[0].n, 3, 'dropping the columns kept the facilities');
	const columns = await old.getQueryInterface().describeTable('Prisons');
	assert.equal(columns.mailRules, undefined);
	await old.close();
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

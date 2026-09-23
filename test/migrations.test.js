import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

// Tests never read the developer's .env (it may hold real keys, such as a Firebase
// service account): point dotenv at nothing, then pin what the tests need.
process.env.DOTENV_CONFIG_PATH = '/dev/null';
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

	await createMigrator(old, { quiet: true }).up({ to: MIGRATION });
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

test('the session run migration keeps existing sessions and gives a new database none', async () => {
	const MIGRATION = '2026.09.17T02.00.00.session-runs.js';
	const upTo = async (db) => {
		const names = (await createMigrator(db, { quiet: true }).pending()).map((m) => m.name);
		await createMigrator(db, { quiet: true }).up({ to: names[names.indexOf(MIGRATION) - 1] });
	};

	const live = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false });
	await upTo(live);
	await live.query(
		"INSERT INTO User (username, password, email, role, createdAt, updatedAt) VALUES ('someone', 'x', 's@example.com', 'user', datetime('now'), datetime('now'))"
	);
	const before = Date.now();
	await runMigrations(live, { quiet: true });
	const [runs] = await live.query('SELECT startedAt, lastIssuedAt FROM SessionRuns');
	assert.equal(runs.length, 1, 'a database with accounts keeps its sessions across the upgrade');
	assert.equal(runs[0].startedAt, 0);
	assert.ok(runs[0].lastIssuedAt >= before && runs[0].lastIssuedAt <= Date.now());
	await live.close();

	const fresh = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false });
	await runMigrations(fresh, { quiet: true });
	const [none] = await fresh.query('SELECT COUNT(*) AS n FROM SessionRuns');
	assert.equal(none[0].n, 0, 'a new or reset database honours no earlier token');
	await fresh.close();
});

test('the master list migration turns stored tags into links and back', async () => {
	const old = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false });
	const MIGRATION = '2026.09.19T00.00.00.mail-rules-table.js';
	const names = (await createMigrator(old, { quiet: true }).pending()).map((m) => m.name);
	await createMigrator(old, { quiet: true }).up({ to: names[names.indexOf(MIGRATION) - 1] });
	const now = "datetime('now'), datetime('now')";
	await old.query(
		'INSERT INTO Prisons (id, prisonName, address, mailRules, notes, createdAt, updatedAt) VALUES ' +
			"(1, 'Tagged', '{}', '[\"no_polaroids\",\"plain_paper\"]', NULL, " +
			now +
			"), (2, 'Bare', '{}', '[]', NULL, " +
			now +
			"), (3, 'Hand edited', '{}', '[\"no_maps\",\"only_english\"]', 'Slow mail', " +
			now +
			')'
	);

	await createMigrator(old, { quiet: true }).up({ to: MIGRATION });
	const [rules] = await old.query('SELECT tag FROM MailRules');
	assert.equal(rules.length, 39, 'the list as it stood in code');
	const [links] = await old.query(
		'SELECT p.prison, r.tag FROM PrisonMailRules p JOIN MailRules r ON r.id = p.rule ORDER BY p.prison, r.tag'
	);
	assert.deepEqual(
		links.map((l) => l.prison + ':' + l.tag),
		['1:no_polaroids', '1:plain_paper', '3:no_maps']
	);
	const [[edited]] = await old.query('SELECT notes FROM Prisons WHERE id = 3');
	assert.equal(
		edited.notes,
		'Slow mail\nMail rule tags not in the master list: only_english',
		'a string that was never on the list is kept as words, not as a rule'
	);
	const columns = await old.getQueryInterface().describeTable('Prisons');
	assert.equal(columns.mailRules, undefined, 'the unchecked column is gone');
	const [[count]] = await old.query('SELECT COUNT(*) AS n FROM Prisons');
	assert.equal(count.n, 3, 'dropping it kept the facilities');

	const migration = await import('../database/migrations/' + MIGRATION);
	await migration.down({ context: old.getQueryInterface() });
	const [restored] = await old.query('SELECT id, mailRules FROM Prisons ORDER BY id');
	assert.deepEqual(
		restored.map((row) => JSON.parse(row.mailRules).sort()),
		[['no_polaroids', 'plain_paper'], [], ['no_maps']]
	);
	await old.close();
});

test('the indexes the hot queries depend on exist after all migrations', async () => {
	// SQLite's removeColumn and changeColumn rebuild a table and silently drop its
	// indexes (that is how Messages lost its only one). A later migration that
	// rebuilds one of these tables must put them back, and this is what notices.
	const expected = {
		Messages: [
			'messages_chat_created',
			'messages_user',
			'messages_relay_status',
			'messages_prisoner_user',
			'messages_status_changed',
			'messages_resend_of'
		],
		Chats: ['chats_user_prisoner', 'chats_prisoner'],
		MessageStatuses: ['message_statuses_message', 'message_statuses_to_status_created'],
		LetterKeys: ['letter_keys_reader'],
		User: ['user_chapter'],
		Prisoners: ['prisoners_prison'],
		ClaimTokens: ['claim_tokens_user'],
		Notifications: ['notifications_message', 'notifications_chat', 'notifications_submission'],
		Devices: ['devices_session'],
		PrisonRelay: ['prison_relay_chapter']
	};
	for (const [table, names] of Object.entries(expected)) {
		const [rows] = await db.sequelize.query("PRAGMA index_list('" + table + "')");
		const present = rows.map((row) => row.name);
		for (const name of names) {
			assert.ok(present.includes(name), table + ' is missing index ' + name);
		}
	}
	// And the planner uses them: the inbox's per-thread lookup is a search, not a scan.
	const [plan] = await db.sequelize.query(
		'EXPLAIN QUERY PLAN SELECT MAX(createdAt) FROM Messages WHERE chat = 1'
	);
	assert.match(
		plan.map((row) => row.detail).join(' '),
		/USING (COVERING )?INDEX messages_chat_created/
	);
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

test('the rotation migration versions existing group keys and their envelopes', async () => {
	const old = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false });
	const PREVIOUS = '2026.09.13T03.00.00.retention.js';
	await createMigrator(old, { quiet: true }).up({ to: PREVIOUS });
	// The envelope's letter is beside the point here.
	await old.query('PRAGMA foreign_keys = OFF');
	const now = "datetime('now'), datetime('now')";
	await old.query(
		"INSERT INTO Chapters (id, name, location, publicKey, createdAt, updatedAt) VALUES (1, 'Keyed', '{}', 'pk', " +
			now +
			"), (2, 'Keyless', '{}', NULL, " +
			now +
			')'
	);
	await old.query(
		"INSERT INTO LetterKeys (message, readerType, readerId, wrappedKey, createdAt, updatedAt) VALUES (1, 'chapter', 1, 'sealed', " +
			now +
			"), (1, 'user', 5, 'sealed', " +
			now +
			"), (1, 'chapter', 2, 'sealed to nothing', " +
			now +
			')'
	);
	await runMigrations(old, { quiet: true });
	const [chapters] = await old.query('SELECT id, keyVersion FROM Chapters ORDER BY id');
	assert.deepEqual(
		chapters.map((c) => c.keyVersion),
		[1, 0],
		'a group with a key is at version 1; one without is at 0'
	);
	const [envelopes] = await old.query('SELECT readerType, keyVersion FROM LetterKeys ORDER BY id');
	assert.deepEqual(
		envelopes.map((e) => e.keyVersion),
		[1, null, null],
		'only envelopes of a group that has a key carry a version'
	);
	await old.close();
});

test('no table has lost its delete rules or its AUTOINCREMENT to a rebuild', async () => {
	// Sequelize's removeColumn rebuilds a table without either; see the repair migration.
	const [tables] = await db.sequelize.query(
		"SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
	);
	// Join tables and tables keyed by something else never had an id of their own.
	const noOwnId = [
		'SequelizeMeta',
		'PrisonerSupport',
		'PrisonRelay',
		'PrisonMailRules',
		'RevokedTokens'
	];
	for (const { name, sql } of tables) {
		const references = (sql.match(/REFERENCES/g) || []).length;
		const rules = (sql.match(/ON DELETE/g) || []).length;
		assert.equal(rules, references, name + ': a REFERENCES clause has no ON DELETE rule');
		if (!noOwnId.includes(name)) {
			assert.match(sql, /AUTOINCREMENT/, name + ': ids of deleted rows would be reused');
		}
	}
});

test('the repair migration restores the rules and keeps every row, index, and child row', async () => {
	const MIGRATION = '2026.09.20T01.00.00.repair-rebuilt-tables.js';
	const live = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false });
	const names = (await createMigrator(live, { quiet: true }).pending()).map((m) => m.name);
	await createMigrator(live, { quiet: true }).up({ to: names[names.indexOf(MIGRATION) - 1] });
	// Damage the two tables as databases from before the helper learned better were
	// damaged: a bare Sequelize removeColumn, which rebuilds from describeTable().
	const qi = live.getQueryInterface();
	await live.query('PRAGMA foreign_keys = OFF');
	for (const table of ['Messages', 'Prisons']) {
		await live.query('ALTER TABLE `' + table + '` ADD COLUMN `scratch` INTEGER');
		await qi.removeColumn(table, 'scratch');
	}
	await live.query('DROP INDEX IF EXISTS `messages_relay_status`');
	await live.query('PRAGMA foreign_keys = ON');
	const [[damaged]] = await live.query("SELECT sql FROM sqlite_master WHERE name = 'Messages'");
	assert.doesNotMatch(damaged.sql, /ON DELETE|AUTOINCREMENT/, 'damaged as old databases are');

	const now = "'2026-01-01 00:00:00.000 +00:00'";
	await live.query(
		`INSERT INTO Chapters (name, location, createdAt, updatedAt) VALUES ('G', '{}', ${now}, ${now})`
	);
	await live.query(
		`INSERT INTO User (username, password, email, role, createdAt, updatedAt) VALUES ('w', 'x', 'w@example.com', 'user', ${now}, ${now})`
	);
	await live.query(
		`INSERT INTO Prisons (prisonName, address, verifiedBy, createdAt, updatedAt) VALUES ('P', '{}', 1, ${now}, ${now})`
	);
	await live.query(
		`INSERT INTO Prisoners (birthName, prison, createdAt, updatedAt) VALUES ('X', 1, ${now}, ${now})`
	);
	await live.query(
		`INSERT INTO Chats (user, prisoner, createdAt, updatedAt) VALUES (1, 1, ${now}, ${now})`
	);
	for (const id of [1, 2]) {
		await live.query(
			`INSERT INTO Messages (id, chat, sender, prisoner, user, status, relayChapter, createdAt, updatedAt) VALUES (${id}, 1, 'user', 1, 1, 'queued', 1, ${now}, ${now})`
		);
	}
	await live.query(
		`INSERT INTO MessageStatuses (message, toStatus, createdAt, updatedAt) VALUES (2, 'queued', ${now}, ${now})`
	);
	// A letter that was purged long ago is still named in the audit log.
	await live.query(
		`INSERT INTO AuditLogs (action, resource, targetId, createdAt) VALUES ('message.delete', 'message', 50, ${now})`
	);
	const [indexesBefore] = await live.query(
		"SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'Messages' AND sql IS NOT NULL ORDER BY name"
	);

	await runMigrations(live, { quiet: true });

	const count = async (table) => (await live.query('SELECT COUNT(*) AS n FROM ' + table))[0][0].n;
	assert.equal(await count('Messages'), 2);
	assert.equal(await count('MessageStatuses'), 1, 'rows of tables that point at Messages are kept');
	assert.equal(await count('Prisoners'), 1);
	const [indexesAfter] = await live.query(
		"SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'Messages' AND sql IS NOT NULL ORDER BY name"
	);
	assert.deepEqual(
		indexesAfter.map((i) => i.name).filter((n) => indexesBefore.some((b) => b.name === n)),
		indexesBefore.map((i) => i.name)
	);
	assert.deepEqual((await live.query('PRAGMA foreign_key_check'))[0], []);

	// The rules work again: a group can go, and what pointed at it is set to NULL.
	await live.query('DELETE FROM Chapters WHERE id = 1');
	assert.equal(
		(await live.query('SELECT relayChapter FROM Messages WHERE id = 1'))[0][0].relayChapter,
		null
	);
	assert.equal(
		(await live.query('SELECT verifiedBy FROM Prisons WHERE id = 1'))[0][0].verifiedBy,
		null
	);
	// Children still follow their letter, and its id is never given to another.
	await live.query('DELETE FROM Messages WHERE id = 2');
	assert.equal(await count('MessageStatuses'), 0);
	await live.query(
		`INSERT INTO Messages (chat, sender, prisoner, user, status, createdAt, updatedAt) VALUES (1, 'user', 1, 1, 'queued', ${now}, ${now})`
	);
	assert.equal(
		(await live.query('SELECT MAX(id) AS id FROM Messages'))[0][0].id,
		51,
		'above every id the database still remembers, not only the rows that are left'
	);
	await live.close();
});

test('rolling migrations back does not strip the tables again', async () => {
	const live = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false });
	await runMigrations(live, { quiet: true });
	const now = "'2026-01-01 00:00:00.000 +00:00'";
	await live.query(
		`INSERT INTO User (username, password, email, role, createdAt, updatedAt) VALUES ('w', 'x', 'w@example.com', 'user', ${now}, ${now})`
	);
	await live.query(
		`INSERT INTO Prisons (prisonName, address, createdAt, updatedAt) VALUES ('P', '{}', ${now}, ${now})`
	);
	await live.query(
		`INSERT INTO Prisoners (birthName, prison, createdAt, updatedAt) VALUES ('X', 1, ${now}, ${now})`
	);
	await live.query(
		`INSERT INTO Chats (user, prisoner, createdAt, updatedAt) VALUES (1, 1, ${now}, ${now})`
	);
	for (const id of [1, 2, 3]) {
		await live.query(
			`INSERT INTO Messages (id, chat, sender, prisoner, user, status, createdAt, updatedAt) VALUES (${id}, 1, 'user', 1, 1, 'queued', ${now}, ${now})`
		);
	}
	await live.query('DELETE FROM Messages WHERE id = 3');

	// Back past the migrations that drop columns from Messages and from Prisons.
	await createMigrator(live, { quiet: true }).down({ to: '2026.09.13T03.00.00.retention.js' });
	for (const table of ['Messages', 'Prisons', 'User', 'Chapters']) {
		const [[{ sql }]] = await live.query('SELECT sql FROM sqlite_master WHERE name = :table', {
			replacements: { table }
		});
		assert.match(sql, /AUTOINCREMENT/, table);
		assert.equal(
			(sql.match(/ON DELETE/g) || []).length,
			(sql.match(/REFERENCES/g) || []).length,
			table
		);
	}
	assert.equal((await live.query('SELECT COUNT(*) AS n FROM Messages'))[0][0].n, 2);
	// The counter came through the rebuilds: the deleted letter's id is not given out again.
	await live.query(
		`INSERT INTO Messages (chat, sender, prisoner, user, status, createdAt, updatedAt) VALUES (1, 'user', 1, 1, 'queued', ${now}, ${now})`
	);
	assert.equal((await live.query('SELECT MAX(id) AS id FROM Messages'))[0][0].id, 4);
	await live.close();
});

test('rolling back returned mail makes a returned letter mailed again, on the day it was mailed', async () => {
	const MIGRATION = '2026.09.20T02.00.00.returned-mail.js';
	const live = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false });
	await runMigrations(live, { quiet: true });
	const at = (day) => `'2026-01-${day} 00:00:00.000 +00:00'`;
	await live.query(
		`INSERT INTO User (id, username, password, email, role, createdAt, updatedAt) VALUES (1, 'w', 'x', 'w@example.com', 'user', ${at('01')}, ${at('01')}), (2, 'm', 'x', 'm@example.com', 'chapter', ${at('01')}, ${at('01')})`
	);
	await live.query(
		`INSERT INTO Prisons (prisonName, address, createdAt, updatedAt) VALUES ('P', '{}', ${at('01')}, ${at('01')})`
	);
	await live.query(
		`INSERT INTO Prisoners (birthName, prison, createdAt, updatedAt) VALUES ('X', 1, ${at('01')}, ${at('01')})`
	);
	await live.query(
		`INSERT INTO Chats (user, prisoner, createdAt, updatedAt) VALUES (1, 1, ${at('01')}, ${at('01')})`
	);
	await live.query(
		`INSERT INTO Messages (id, chat, sender, prisoner, user, status, returnReason, statusChangedAt, statusChangedBy, createdAt, updatedAt) VALUES (1, 1, 'user', 1, 1, 'returned', 'refused', ${at('20')}, NULL, ${at('02')}, ${at('20')})`
	);
	await live.query(
		`INSERT INTO MessageStatuses (message, fromStatus, toStatus, changedBy, reason, createdAt, updatedAt) VALUES (1, 'printed', 'mailed', 2, NULL, ${at('05')}, ${at('05')}), (1, 'mailed', 'returned', NULL, 'refused', ${at('20')}, ${at('20')})`
	);

	const names = (await createMigrator(live, { quiet: true }).executed()).map((m) => m.name);
	await createMigrator(live, { quiet: true }).down({ to: MIGRATION });
	assert.ok(names.includes(MIGRATION));
	const [[letter]] = await live.query(
		'SELECT status, statusChangedAt, statusChangedBy FROM Messages WHERE id = 1'
	);
	assert.equal(letter.status, 'mailed');
	assert.ok(
		String(letter.statusChangedAt).startsWith('2026-01-05'),
		'retention counts from the day it was mailed: ' + letter.statusChangedAt
	);
	assert.equal(letter.statusChangedBy, 2);
	const [history] = await live.query('SELECT toStatus FROM MessageStatuses WHERE message = 1');
	assert.deepEqual(
		history.map((row) => row.toStatus),
		['mailed']
	);
	await live.close();
});

test('the return-note migration copies the newest returned note onto each returned letter and nothing else', async () => {
	const MIGRATION = '2026.09.23T01.00.00.return-note.js';
	const old = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false });
	const names = (await createMigrator(old, { quiet: true }).pending()).map((m) => m.name);
	await createMigrator(old, { quiet: true }).up({ to: names[names.indexOf(MIGRATION) - 1] });
	const at = (day) => `'2026-01-${day} 00:00:00.000 +00:00'`;
	await old.query(
		`INSERT INTO User (id, username, password, email, role, createdAt, updatedAt) VALUES (1, 'w', 'x', 'w@example.com', 'user', ${at('01')}, ${at('01')})`
	);
	await old.query(
		`INSERT INTO Prisons (prisonName, address, createdAt, updatedAt) VALUES ('P', '{}', ${at('01')}, ${at('01')})`
	);
	await old.query(
		`INSERT INTO Prisoners (birthName, prison, createdAt, updatedAt) VALUES ('X', 1, ${at('01')}, ${at('01')})`
	);
	await old.query(
		`INSERT INTO Chats (user, prisoner, createdAt, updatedAt) VALUES (1, 1, ${at('01')}, ${at('01')})`
	);
	// 1: returned twice (resent by hand, came back again): the newest note wins.
	// 2: returned, with no note. 3: mailed, whose history has a note on another row.
	await old.query(
		`INSERT INTO Messages (id, chat, sender, prisoner, user, status, returnReason, createdAt, updatedAt) VALUES
			(1, 1, 'user', 1, 1, 'returned', 'refused', ${at('02')}, ${at('20')}),
			(2, 1, 'user', 1, 1, 'returned', 'transferred', ${at('02')}, ${at('21')}),
			(3, 1, 'user', 1, 1, 'mailed', NULL, ${at('02')}, ${at('05')})`
	);
	await old.query(
		`INSERT INTO MessageStatuses (id, message, fromStatus, toStatus, reason, note, createdAt, updatedAt) VALUES
			(1, 1, 'mailed', 'returned', 'refused', 'First time back', ${at('10')}, ${at('10')}),
			(2, 1, 'mailed', 'returned', 'refused', 'Stamped NOT HERE', ${at('20')}, ${at('20')}),
			(3, 2, 'mailed', 'returned', 'transferred', NULL, ${at('21')}, ${at('21')}),
			(4, 3, 'printed', 'mailed', NULL, 'Not a return', ${at('05')}, ${at('05')})`
	);
	await createMigrator(old, { quiet: true }).up({ to: MIGRATION });
	const [rows] = await old.query('SELECT id, returnNote FROM Messages ORDER BY id');
	assert.deepEqual(
		rows.map((r) => [r.id, r.returnNote]),
		[
			[1, 'Stamped NOT HERE'],
			[2, null],
			[3, null]
		]
	);
	await createMigrator(old, { quiet: true }).down({ to: MIGRATION });
	const [after] = await old.query('SELECT id, status, returnReason FROM Messages ORDER BY id');
	assert.deepEqual(
		after.map((r) => [r.id, r.status, r.returnReason]),
		[
			[1, 'returned', 'refused'],
			[2, 'returned', 'transferred'],
			[3, 'mailed', null]
		],
		'rolling back drops the column and keeps the rows'
	);
	await old.close();
});

test('the reply-reference migration gives every existing outgoing letter a number, mailed ones a year, and adds the two rules', async () => {
	const MIGRATION = '2026.09.24T01.00.00.pen-names-reply-reference.js';
	const old = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false });
	const names = (await createMigrator(old, { quiet: true }).pending()).map((m) => m.name);
	await createMigrator(old, { quiet: true }).up({ to: names[names.indexOf(MIGRATION) - 1] });
	const at = (day) => `'2026-01-${day} 00:00:00.000 +00:00'`;
	await old.query(
		`INSERT INTO User (id, username, password, email, role, createdAt, updatedAt) VALUES (1, 'w', 'x', 'w@example.com', 'user', ${at('01')}, ${at('01')})`
	);
	await old.query(
		`INSERT INTO Prisons (prisonName, address, createdAt, updatedAt) VALUES ('P', '{}', ${at('01')}, ${at('01')})`
	);
	await old.query(
		`INSERT INTO Prisoners (birthName, prison, createdAt, updatedAt) VALUES ('X', 1, ${at('01')}, ${at('01')})`
	);
	await old.query(
		`INSERT INTO Chapters (id, name, location, createdAt, updatedAt) VALUES (7, 'G', '{}', ${at('01')}, ${at('01')})`
	);
	await old.query(
		`INSERT INTO Chats (user, prisoner, createdAt, updatedAt) VALUES (1, 1, ${at('01')}, ${at('01')})`
	);
	// 1: queued. 2: mailed on the 10th. 3: a reply, which gets nothing.
	await old.query(
		`INSERT INTO Messages (id, chat, sender, prisoner, user, status, relayChapter, statusChangedAt, createdAt, updatedAt) VALUES
			(1, 1, 'user', 1, 1, 'queued', 7, NULL, ${at('02')}, ${at('02')}),
			(2, 1, 'user', 1, 1, 'mailed', 7, ${at('10')}, ${at('02')}, ${at('10')}),
			(3, 1, 'prisoner', 1, 1, 'received', NULL, NULL, ${at('12')}, ${at('12')})`
	);
	await createMigrator(old, { quiet: true }).up({ to: MIGRATION });
	const [letters] = await old.query('SELECT id, replyReference FROM Messages ORDER BY id');
	assert.match(letters[0].replyReference, /^[0-9]{9}$/);
	assert.match(letters[1].replyReference, /^[0-9]{9}$/);
	assert.notEqual(letters[0].replyReference, letters[1].replyReference);
	assert.equal(letters[2].replyReference, null, 'a reply carries no number');
	const [rows] = await old.query(
		'SELECT message, user, prisoner, chapter, mailedAt, expiresAt FROM ReplyReferences ORDER BY message'
	);
	assert.deepEqual(
		rows.map((r) => [
			r.message,
			r.user,
			r.prisoner,
			r.chapter,
			r.mailedAt === null,
			r.expiresAt === null
		]),
		[
			[1, 1, 1, 7, true, true],
			[2, 1, 1, 7, false, false]
		]
	);
	assert.ok(
		String(rows[1].mailedAt).startsWith('2026-01-10'),
		'the year counts from the day it was mailed'
	);
	const [rules] = await old.query(
		"SELECT tag, category FROM MailRules WHERE tag IN ('no_reference_numbers', 'reply_sheet_allowed') ORDER BY tag"
	);
	assert.deepEqual(
		rules.map((r) => [r.tag, r.category]),
		[
			['no_reference_numbers', 'addressing'],
			['reply_sheet_allowed', 'enclosures']
		]
	);
	await createMigrator(old, { quiet: true }).down({ to: MIGRATION });
	const [after] = await old.query('SELECT id, status FROM Messages ORDER BY id');
	assert.equal(after.length, 3, 'rolling back keeps the letters');
	await old.close();
});

test('the key cannot be changed while a database still has letters to convert with the old one', async () => {
	const live = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false });
	const names = (await createMigrator(live, { quiet: true }).pending()).map((m) => m.name);
	await createMigrator(live, { quiet: true }).up({
		to: names[names.indexOf('2026.09.12T02.00.00.encryption.js') - 1]
	});
	const now = "'2026-01-01 00:00:00.000 +00:00'";
	await live.query(
		`INSERT INTO User (username, password, email, role, createdAt, updatedAt) VALUES ('w', 'x', 'w@example.com', 'user', ${now}, ${now})`
	);
	await live.query(
		`INSERT INTO Prisons (prisonName, address, createdAt, updatedAt) VALUES ('P', '{}', ${now}, ${now})`
	);
	await live.query(
		`INSERT INTO Prisoners (birthName, prison, createdAt, updatedAt) VALUES ('X', 1, ${now}, ${now})`
	);
	await live.query(
		`INSERT INTO Chats (user, prisoner, createdAt, updatedAt) VALUES (1, 1, ${now}, ${now})`
	);
	await live.query(
		`INSERT INTO Messages (chat, sender, prisoner, user, messageText, status, createdAt, updatedAt) VALUES (1, 'user', 1, 1, 'From before encryption', 'queued', ${now}, ${now})`
	);

	// The migrations that read letters know one key and no labels.
	process.env.ENCRYPTION_KEY_PREVIOUS = 'b2xkLWtleS1vbGQta2V5LW9sZC1rZXktb2xkLWtleSE=';
	try {
		await assert.rejects(
			runMigrations(live, { quiet: true }),
			/start the API once so that it catches up/
		);
	} finally {
		delete process.env.ENCRYPTION_KEY_PREVIOUS;
	}
	// With the key it was written with, it catches up; a new, empty database never minds.
	await runMigrations(live, { quiet: true });
	assert.deepEqual(await createMigrator(live, { quiet: true }).pending(), []);
	// And the letter that was plain text came through every step readable. (It used to
	// fail here: the step that encrypts it writes today's cipher, and the next step
	// tried to read that as the old one.)
	const crypto = await import('../services/crypto.js');
	const [[envelope]] = await live.query(
		"SELECT wrappedKey, keyLabel FROM LetterKeys WHERE readerType = 'server'"
	);
	const [[stored]] = await live.query('SELECT ciphertext, nonce FROM Messages WHERE id = 1');
	const key = crypto.unwrapForServer(envelope.wrappedKey, envelope.keyLabel);
	assert.equal(
		crypto.decryptString(stored.ciphertext, stored.nonce, key),
		'From before encryption'
	);
	await live.close();
	process.env.ENCRYPTION_KEY_PREVIOUS = 'b2xkLWtleS1vbGQta2V5LW9sZC1rZXktb2xkLWtleSE=';
	try {
		const fresh = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false });
		await runMigrations(fresh, { quiet: true });
		await fresh.close();
	} finally {
		delete process.env.ENCRYPTION_KEY_PREVIOUS;
	}
});

test('what groups had typed becomes their starting figure, and small numbers stop being shown', async () => {
	const MIGRATION = '2026.09.21T00.00.00.group-statistics.js';
	const live = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false });
	const names = (await createMigrator(live, { quiet: true }).pending()).map((m) => m.name);
	await createMigrator(live, { quiet: true }).up({ to: names[names.indexOf(MIGRATION) - 1] });
	const now = "'2026-01-01 00:00:00.000 +00:00'";
	for (const [name, typed] of [
		['Big', "'120+'"],
		['Vague', "'about 300'"],
		['Small', "'12'"],
		['Silent', 'NULL']
	]) {
		await live.query(
			`INSERT INTO Chapters (name, location, lettersSent, createdAt, updatedAt) VALUES ('${name}', '{}', ${typed}, ${now}, ${now})`
		);
	}
	// "Silent" typed nothing and has mailed three letters here already.
	await live.query(
		`INSERT INTO User (username, password, email, role, createdAt, updatedAt) VALUES ('w', 'x', 'w@example.com', 'user', ${now}, ${now})`
	);
	await live.query(
		`INSERT INTO Prisons (prisonName, address, createdAt, updatedAt) VALUES ('P', '{}', ${now}, ${now})`
	);
	await live.query(
		`INSERT INTO Prisoners (birthName, prison, createdAt, updatedAt) VALUES ('X', 1, ${now}, ${now})`
	);
	await live.query(
		`INSERT INTO Chats (user, prisoner, createdAt, updatedAt) VALUES (1, 1, ${now}, ${now})`
	);
	for (const status of ['mailed', 'mailed', 'returned', 'queued']) {
		await live.query(
			`INSERT INTO Messages (chat, sender, prisoner, user, status, relayChapter, createdAt, updatedAt) VALUES (1, 'user', 1, 1, '${status}', 4, ${now}, ${now})`
		);
	}
	await runMigrations(live, { quiet: true });
	const [rows] = await live.query(
		'SELECT name, lettersSentBefore, lettersCounted, lettersSent FROM Chapters ORDER BY id'
	);
	assert.deepEqual(
		rows.map((r) => [r.name, r.lettersSentBefore, r.lettersCounted, r.lettersSent]),
		[
			['Big', 120, 0, '120'],
			['Vague', 0, 0, null],
			['Small', 12, 0, null],
			['Silent', 0, 3, null]
		]
	);
	await live.close();
});

test('chapters that already exist get a group-owner admin: their earliest key holder, else their earliest group admin', async () => {
	const MIGRATION = '2026.09.22T01.00.00.group-owner.js';
	const live = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false });
	const names = (await createMigrator(live, { quiet: true }).pending()).map((m) => m.name);
	await createMigrator(live, { quiet: true }).up({ to: names[names.indexOf(MIGRATION) - 1] });
	const now = "'2026-01-01 00:00:00.000 +00:00'";
	await live.query(
		`INSERT INTO Chapters (id, name, location, createdAt, updatedAt) VALUES (1, 'Keyed', '{}', ${now}, ${now}), (2, 'Unkeyed', '{}', ${now}, ${now}), (3, 'Empty', '{}', ${now}, ${now}), (4, 'Stale', '{}', ${now}, ${now})`
	);
	// Chapter 4: its earliest key row belongs to somebody who has since left (user 5,
	// now in chapter 1); the owner must be its remaining group admin, user 6.
	for (const [id, chapter] of [
		[1, 1],
		[2, 1],
		[3, 2],
		[4, 2],
		[5, 1],
		[6, 4]
	]) {
		await live.query(
			`INSERT INTO User (id, username, password, email, role, chapterId, createdAt, updatedAt) VALUES (${id}, 'u${id}', 'x', 'u${id}@example.com', 'chapter', ${chapter}, ${now}, ${now})`
		);
	}
	// In chapter 1 the second member holds the key and the first does not: the holder is the owner.
	await live.query(
		`INSERT INTO OrgMemberKeys (chapterId, userId, wrappedOrgPrivateKey, createdAt, updatedAt) VALUES (1, 2, 'sealed', ${now}, ${now}), (4, 5, 'stale', ${now}, ${now}), (4, 6, 'sealed', ${now}, ${now})`
	);
	await runMigrations(live, { quiet: true });
	const [rows] = await live.query('SELECT id, ownerId FROM Chapters ORDER BY id');
	assert.deepEqual(
		rows.map((r) => [r.id, r.ownerId]),
		[
			[1, 2],
			[2, 3],
			[3, null],
			[4, 6]
		]
	);
	await live.close();
});

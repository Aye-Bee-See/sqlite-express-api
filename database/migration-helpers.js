/**
 * Helpers for migration files. Kept apart from migrate.js: that module runs
 * the CLI with a top-level await, so a migration importing it would deadlock
 * on the circular import.
 */

const quote = (name) => '`' + String(name).replace(/`/g, '``') + '`';

/**
 * A table's CREATE TABLE text with AUTOINCREMENT and foreign-key rules put back
 * where a rebuild left `INTEGER PRIMARY KEY` and bare `REFERENCES`.
 * @param {string} sql
 * @param {{autoIncrement?: boolean, rules?: Record<string, {onDelete: string, onUpdate?: string}>}} wanted
 * @returns {string|null} null when nothing is missing
 */
export function repairedSql(sql, { autoIncrement = true, rules = {} } = {}) {
	let out = sql;
	if (autoIncrement) {
		out = out.replace(/(`id` INTEGER PRIMARY KEY)(?! AUTOINCREMENT)/, '$1 AUTOINCREMENT');
	}
	for (const [column, rule] of Object.entries(rules)) {
		const bare = new RegExp(
			'(`' + column + '` [^,]*?REFERENCES `\\w+` \\(`id`\\))(?! ON (?:DELETE|UPDATE))'
		);
		out = out.replace(
			bare,
			'$1 ON DELETE ' + rule.onDelete + ' ON UPDATE ' + (rule.onUpdate || 'CASCADE')
		);
	}
	return out === sql ? null : out;
}

/** What a rebuild can lose, read before it happens. */
async function snapshot(sequelize) {
	const [tables] = await sequelize.query(
		"SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
	);
	const [sequences] = await sequelize
		.query('SELECT name, seq FROM sqlite_sequence')
		.catch(() => [[]]); // the table appears with the first AUTOINCREMENT insert
	const state = new Map();
	for (const { name, sql } of tables) {
		// The table-valued form: Sequelize reshapes the results of a bare PRAGMA.
		const [keys] = await sequelize.query(
			'SELECT "from", on_delete, on_update FROM pragma_foreign_key_list(:name)',
			{ replacements: { name } }
		);
		const [indexes] = await sequelize.query(
			"SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = :name AND sql IS NOT NULL",
			{ replacements: { name } }
		);
		state.set(name, {
			autoIncrement: /AUTOINCREMENT/.test(sql),
			rules: Object.fromEntries(
				keys.map((key) => [key.from, { onDelete: key.on_delete, onUpdate: key.on_update }])
			),
			indexes,
			sequence: sequences.find((row) => row.name === name)?.seq ?? null
		});
	}
	return state;
}

/**
 * Rebuild one table from `sql`, keeping its rows and indexes. Foreign keys must
 * be off (dropping the old table would cascade through every table that points
 * at it). The AUTOINCREMENT counter never goes below `sequence`: ids that were
 * handed out and deleted since are not handed out again.
 */
export async function rebuildTable(sequelize, table, sql, { sequence = null } = {}) {
	const [indexes] = await sequelize.query(
		"SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = :table AND sql IS NOT NULL",
		{ replacements: { table } }
	);
	const spare = table + '_rebuilt';
	await sequelize.query('DROP TABLE IF EXISTS ' + quote(spare));
	await sequelize.query(
		sql.replace(/^CREATE TABLE (IF NOT EXISTS )?[`"][^`"]+[`"]/, 'CREATE TABLE ' + quote(spare))
	);
	// Same columns in the same order: the new table is made from the old one's own text.
	await sequelize.query('INSERT INTO ' + quote(spare) + ' SELECT * FROM ' + quote(table));
	await sequelize.query('DROP TABLE ' + quote(table));
	await sequelize.query('ALTER TABLE ' + quote(spare) + ' RENAME TO ' + quote(table));
	for (const index of indexes) {
		await sequelize.query(index.sql);
	}
	await raiseSequence(sequelize, table, sequence);
}

/** Make the next id of an AUTOINCREMENT table larger than `atLeast` (and than every row in it). */
export async function raiseSequence(sequelize, table, atLeast) {
	if (atLeast === null || atLeast === undefined) {
		return;
	}
	const [[row]] = await sequelize.query(
		'SELECT COALESCE(MAX(`id`), 0) AS top FROM ' + quote(table)
	);
	const seq = Math.max(Number(atLeast) || 0, Number(row.top) || 0);
	await sequelize.query('DELETE FROM sqlite_sequence WHERE name = :table', {
		replacements: { table }
	});
	await sequelize.query('INSERT INTO sqlite_sequence (name, seq) VALUES (:table, :seq)', {
		replacements: { table, seq }
	});
}

/** Put back whatever `fn` cost the tables it rebuilt: rules, AUTOINCREMENT, counters, indexes. */
async function restore(sequelize, before) {
	for (const [table, was] of before) {
		const [[now]] = await sequelize.query(
			"SELECT sql FROM sqlite_master WHERE type = 'table' AND name = :table",
			{ replacements: { table } }
		);
		if (!now) {
			continue; // dropped on purpose
		}
		const fixed = repairedSql(now.sql, { autoIncrement: was.autoIncrement, rules: was.rules });
		if (fixed) {
			await rebuildTable(sequelize, table, fixed, { sequence: was.sequence });
		}
		const [present] = await sequelize.query(
			"SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = :table",
			{ replacements: { table } }
		);
		for (const index of was.indexes) {
			if (present.some((row) => row.name === index.name)) {
				continue;
			}
			// An index on the column that was just removed has nothing to come back to.
			await sequelize.query(index.sql).catch(() => {});
		}
	}
}

/**
 * Run a schema change that rebuilds a table (Sequelize's removeColumn and
 * changeColumn on SQLite: copy, drop, rename), and leave the table as whole as
 * it was.
 *
 * Two things go wrong otherwise. With foreign keys on, dropping the old table
 * fires ON DELETE CASCADE on every table that references it and silently
 * empties them. And Sequelize rebuilds from describeTable(), which knows nothing
 * of ON DELETE / ON UPDATE rules, AUTOINCREMENT, or indexes, so all three are
 * gone afterwards. This turns foreign keys off, notes what every table has,
 * runs `fn`, and puts back what is missing. Wrap every column removal, in `up`
 * and in `down`.
 * @param {import('sequelize').QueryInterface} queryInterface
 * @param {() => Promise<void>} fn
 */
export async function withForeignKeysOff(queryInterface, fn) {
	const { sequelize } = queryInterface;
	await sequelize.query('PRAGMA foreign_keys = OFF');
	try {
		const before = await snapshot(sequelize);
		await fn();
		await restore(sequelize, before);
	} finally {
		await sequelize.query('PRAGMA foreign_keys = ON');
	}
}

/**
 * Drop a column without rebuilding the table: the first choice. SQLite refuses
 * a column that is a foreign key, indexed, unique, or part of a key; drop the
 * index first, or fall back to queryInterface.removeColumn inside
 * withForeignKeysOff(), never outside it.
 * @param {import('sequelize').QueryInterface} queryInterface
 * @param {string} table
 * @param {string} column
 */
export async function dropColumn(queryInterface, table, column) {
	await queryInterface.sequelize.query(
		'ALTER TABLE ' + quote(table) + ' DROP COLUMN ' + quote(column)
	);
}

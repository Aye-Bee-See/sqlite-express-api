/**
 * Put back what table rebuilds took away from `Messages` and `Prisons`.
 *
 * Sequelize removes a column on SQLite by rebuilding the table from what
 * describeTable() reports, and that report has no ON DELETE / ON UPDATE rules
 * and no AUTOINCREMENT. Every earlier migration that dropped a column from
 * these two tables therefore left them with bare `REFERENCES` clauses and a
 * plain `INTEGER PRIMARY KEY`:
 *
 * - Deleting a group that relays letters, or an account that once moved a
 *   letter along, failed on the foreign key instead of setting the column to
 *   NULL as the models say. The same for a group that verified a facility.
 * - Without AUTOINCREMENT, SQLite gives the id of the newest row, once it is
 *   deleted, to the next row. An Idempotency-Key, a notification, or an audit
 *   entry that named the old letter would then name a different one.
 *
 * No rows were lost: those migrations ran with foreign keys off. This one
 * rebuilds the two tables from their own CREATE TABLE text with the rules put
 * back, keeps every row and index, and checks the foreign keys before it
 * commits. New migrations drop columns with dropColumn() (migration-helpers.js),
 * which does not rebuild anything.
 */

const REPAIRS = {
	Messages: {
		chat: 'RESTRICT',
		prisoner: 'RESTRICT',
		user: 'RESTRICT',
		relayChapter: 'SET NULL',
		statusChangedBy: 'SET NULL'
	},
	Prisons: { verifiedBy: 'SET NULL' }
};

/** The CREATE TABLE text with AUTOINCREMENT and the delete rules restored; null when nothing is missing. */
export function repairedSql(sql, rules) {
	let out = sql.replace(/(`id` INTEGER PRIMARY KEY)(?! AUTOINCREMENT)/, '$1 AUTOINCREMENT');
	for (const [column, onDelete] of Object.entries(rules)) {
		const bare = new RegExp('(`' + column + '` [^,]*?REFERENCES `\\w+` \\(`id`\\))(?! ON DELETE)');
		out = out.replace(bare, '$1 ON DELETE ' + onDelete + ' ON UPDATE CASCADE');
	}
	return out === sql ? null : out;
}

async function repair(sequelize, table, rules) {
	const [[found]] = await sequelize.query(
		"SELECT sql FROM sqlite_master WHERE type = 'table' AND name = :table",
		{ replacements: { table } }
	);
	const fixed = found ? repairedSql(found.sql, rules) : null;
	if (!fixed) {
		return;
	}
	const [indexes] = await sequelize.query(
		"SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = :table AND sql IS NOT NULL",
		{ replacements: { table } }
	);
	const spare = table + '_repaired';
	await sequelize.query('DROP TABLE IF EXISTS `' + spare + '`');
	await sequelize.query(
		fixed.replace('CREATE TABLE `' + table + '`', 'CREATE TABLE `' + spare + '`')
	);
	// Same columns in the same order: the new table was made from the old one's own text.
	await sequelize.query('INSERT INTO `' + spare + '` SELECT * FROM `' + table + '`');
	await sequelize.query('DROP TABLE `' + table + '`');
	await sequelize.query('ALTER TABLE `' + spare + '` RENAME TO `' + table + '`');
	for (const index of indexes) {
		await sequelize.query(index.sql);
	}
}

export async function up({ context: queryInterface }) {
	const { sequelize } = queryInterface;
	// Off, or dropping the old table would run ON DELETE CASCADE through every
	// table that points at it. The setting cannot change inside a transaction.
	await sequelize.query('PRAGMA foreign_keys = OFF');
	try {
		await sequelize.query('BEGIN');
		try {
			// Rows that pointed at nothing before are not this migration's to judge (and
			// must not stop a server from starting); it only must not add any.
			const [before] = await sequelize.query('PRAGMA foreign_key_check');
			for (const [table, rules] of Object.entries(REPAIRS)) {
				await repair(sequelize, table, rules);
			}
			const [after] = await sequelize.query('PRAGMA foreign_key_check');
			if (after.length > before.length) {
				throw new Error(
					'Rebuilding left ' +
						(after.length - before.length) +
						' more row(s) pointing at nothing; nothing was changed.'
				);
			}
			await sequelize.query('COMMIT');
		} catch (err) {
			await sequelize.query('ROLLBACK');
			throw err;
		}
	} finally {
		await sequelize.query('PRAGMA foreign_keys = ON');
	}
}

/** A repair is not undone: the damaged shape is nothing to go back to. */
export async function down() {}

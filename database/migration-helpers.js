/**
 * Helpers for migration files. Kept apart from migrate.js: that module runs
 * the CLI with a top-level await, so a migration importing it would deadlock
 * on the circular import.
 */

/**
 * Run a schema change with SQLite foreign-key enforcement off.
 *
 * Sequelize implements removeColumn / changeColumn on SQLite by rebuilding
 * the table (copy, drop, rename). With foreign keys on, dropping the old
 * table fires ON DELETE CASCADE on every table that references it and
 * silently empties them. Wrap any column removal on a referenced table.
 * @param {import('sequelize').QueryInterface} queryInterface
 * @param {() => Promise<void>} fn
 */
export async function withForeignKeysOff(queryInterface, fn) {
	const { sequelize } = queryInterface;
	await sequelize.query('PRAGMA foreign_keys = OFF');
	try {
		await fn();
	} finally {
		await sequelize.query('PRAGMA foreign_keys = ON');
	}
}

/**
 * Drop a column without rebuilding the table. Use this, never
 * queryInterface.removeColumn or changeColumn: Sequelize rebuilds the table
 * from describeTable(), which knows nothing of ON DELETE rules, AUTOINCREMENT,
 * or indexes, and all three are gone afterwards (see the repair-rebuilt-tables
 * migration). SQLite refuses to drop a column that is indexed, unique, or part
 * of a key; remove the index first.
 * @param {import('sequelize').QueryInterface} queryInterface
 * @param {string} table
 * @param {string} column
 */
export async function dropColumn(queryInterface, table, column) {
	const quote = (name) => '`' + String(name).replace(/`/g, '``') + '`';
	await queryInterface.sequelize.query(
		'ALTER TABLE ' + quote(table) + ' DROP COLUMN ' + quote(column)
	);
}

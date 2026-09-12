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

import { repairedSql, rebuildTable, raiseSequence } from '../migration-helpers.js';

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
 * commits. It is for databases that were damaged before withForeignKeysOff()
 * learned to restore what a rebuild costs; on a new database it finds nothing
 * to do.
 */

const REPAIRS = {
	Messages: {
		rules: {
			chat: { onDelete: 'RESTRICT' },
			prisoner: { onDelete: 'RESTRICT' },
			user: { onDelete: 'RESTRICT' },
			relayChapter: { onDelete: 'SET NULL' },
			statusChangedBy: { onDelete: 'SET NULL' }
		},
		// Where an id of this table may still be written down after its row is gone.
		// The new counter starts above all of them: a database whose newest letters
		// (or all of them) were deleted must not hand their ids out again.
		remembered: [
			"SELECT MAX(`resourceId`) AS top FROM `IdempotencyKeys` WHERE `scope` = 'message'",
			'SELECT MAX(`message`) AS top FROM `Notifications`',
			"SELECT MAX(`targetId`) AS top FROM `AuditLogs` WHERE `resource` = 'message'"
		]
	},
	Prisons: {
		rules: { verifiedBy: { onDelete: 'SET NULL' } },
		remembered: [
			"SELECT MAX(`targetId`) AS top FROM `AuditLogs` WHERE `resource` = 'prison'",
			"SELECT MAX(`targetId`) AS top FROM `Submissions` WHERE `resource` = 'prison'"
		]
	}
};

async function highWaterMark(sequelize, queries) {
	let top = 0;
	for (const sql of queries) {
		const [[row]] = await sequelize.query(sql);
		top = Math.max(top, Number(row.top) || 0);
	}
	return top;
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
			for (const [table, { rules, remembered }] of Object.entries(REPAIRS)) {
				const [[found]] = await sequelize.query(
					"SELECT sql FROM sqlite_master WHERE type = 'table' AND name = :table",
					{ replacements: { table } }
				);
				const fixed = found ? repairedSql(found.sql, { rules }) : null;
				if (fixed) {
					await rebuildTable(sequelize, table, fixed);
				}
				if (found) {
					await raiseSequence(sequelize, table, await highWaterMark(sequelize, remembered));
				}
			}
			// Two names for one index. `messages_relay_chapter_status` (letter-lifecycle)
			// was lost to a rebuild on every database that existed then;
			// `messages_relay_status` (hot-path-indexes) is the same columns and is the one
			// every database has. A new database, where rebuilds now keep indexes, would
			// carry both.
			await sequelize.query('DROP INDEX IF EXISTS `messages_relay_chapter_status`');
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

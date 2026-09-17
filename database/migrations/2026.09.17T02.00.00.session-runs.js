import { DataTypes } from 'sequelize';

/**
 * SessionRuns: the spans of time in which this database issued tokens. A
 * token whose `issued` time falls in none of them was issued for another
 * database (before a reset, or in a timeline a restore discarded) and is
 * refused.
 *
 * A database that already has accounts gets one run covering everything up
 * to now, so deploying this does not sign everybody out. A new or reset
 * database has no accounts when migrations run and gets none, which is the
 * point: no earlier token is valid for it.
 */

export async function up({ context: queryInterface }) {
	await queryInterface.createTable('SessionRuns', {
		id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
		startedAt: { type: DataTypes.BIGINT, allowNull: false },
		lastIssuedAt: { type: DataTypes.BIGINT, allowNull: false }
	});
	const [[{ n }]] = await queryInterface.sequelize.query('SELECT COUNT(*) AS n FROM `User`');
	if (n > 0) {
		await queryInterface.bulkInsert('SessionRuns', [{ startedAt: 0, lastIssuedAt: Date.now() }]);
	}
}

export async function down({ context: queryInterface }) {
	await queryInterface.dropTable('SessionRuns');
}

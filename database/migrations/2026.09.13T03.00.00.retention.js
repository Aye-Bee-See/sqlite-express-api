import { DataTypes } from 'sequelize';

/**
 * Retention: how long a writer's letters and replies stay after mailing
 * (User.retentionDays; null means the site default, 0 means forever), and a
 * per-letter pin (Messages.keep) that exempts one letter from the purge.
 */

export async function up({ context: queryInterface }) {
	await queryInterface.addColumn('User', 'retentionDays', { type: DataTypes.INTEGER });
	await queryInterface.addColumn('Messages', 'keep', {
		type: DataTypes.BOOLEAN,
		allowNull: false,
		defaultValue: false
	});
}

export async function down({ context: queryInterface }) {
	const { withForeignKeysOff } = await import('../migration-helpers.js');
	await withForeignKeysOff(queryInterface, async () => {
		await queryInterface.removeColumn('Messages', 'keep');
		await queryInterface.removeColumn('User', 'retentionDays');
	});
}

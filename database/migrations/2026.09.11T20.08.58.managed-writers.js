import { DataTypes } from 'sequelize';
import { withForeignKeysOff } from '../migration-helpers.js';

/**
 * Managed writers: accounts a support group creates for people who write
 * through it, which the writer can later claim with a one-time token.
 *
 * User gains custody and claim bookkeeping plus an internal note; a new
 * ClaimTokens table holds token hashes. Key material for the encryption
 * design is added by a later migration on the same rows.
 */

function ref(table, onDelete) {
	return { references: { model: table, key: 'id' }, onDelete, onUpdate: 'CASCADE' };
}

const USER_COLUMNS = {
	managedBy: { type: DataTypes.INTEGER, ...ref('Chapters', 'SET NULL') },
	claimedAt: { type: DataTypes.DATE },
	claimedFrom: { type: DataTypes.INTEGER, ...ref('Chapters', 'SET NULL') },
	anonymousForChapter: { type: DataTypes.INTEGER, ...ref('Chapters', 'CASCADE') },
	managerNote: { type: DataTypes.TEXT }
};

export async function up({ context: queryInterface }) {
	for (const [name, definition] of Object.entries(USER_COLUMNS)) {
		await queryInterface.addColumn('User', name, definition);
	}
	await queryInterface.addIndex('User', ['anonymousForChapter'], {
		unique: true,
		name: 'user_anonymous_for_chapter_unique'
	});
	await queryInterface.addIndex('User', ['managedBy'], { name: 'user_managed_by' });

	await queryInterface.createTable('ClaimTokens', {
		id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
		userId: { type: DataTypes.INTEGER, allowNull: false, ...ref('User', 'CASCADE') },
		tokenHash: { type: DataTypes.STRING, allowNull: false, unique: true },
		expiresAt: { type: DataTypes.DATE, allowNull: false },
		usedAt: { type: DataTypes.DATE },
		createdBy: { type: DataTypes.INTEGER, ...ref('User', 'SET NULL') },
		createdAt: { type: DataTypes.DATE, allowNull: false },
		updatedAt: { type: DataTypes.DATE, allowNull: false }
	});
}

export async function down({ context: queryInterface }) {
	await queryInterface.dropTable('ClaimTokens');
	await queryInterface.removeIndex('User', 'user_managed_by');
	await queryInterface.removeIndex('User', 'user_anonymous_for_chapter_unique');
	// removeColumn rebuilds the table: see withForeignKeysOff.
	await withForeignKeysOff(queryInterface, async () => {
		for (const name of Object.keys(USER_COLUMNS).reverse()) {
			await queryInterface.removeColumn('User', name);
		}
	});
}

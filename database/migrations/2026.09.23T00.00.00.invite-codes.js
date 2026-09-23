import { DataTypes } from 'sequelize';
import { withForeignKeysOff } from '../migration-helpers.js';

/**
 * Invite codes: how writers join. A chapter issues a batch of single-use codes
 * (slips at the door of a letter night); a newcomer registers with one and the
 * account is theirs from the first minute. The account remembers the chapter
 * that sponsored it, and nothing else: the code row never learns who used it.
 * Decided on 22 September 2026.
 */
export async function up({ context: queryInterface }) {
	await queryInterface.createTable('InviteCodes', {
		id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
		chapterId: {
			type: DataTypes.INTEGER,
			allowNull: false,
			references: { model: 'Chapters', key: 'id' },
			onDelete: 'CASCADE',
			onUpdate: 'CASCADE'
		},
		/** Codes issued together share a batch id, so a chapter can cancel or count them as one. */
		batch: { type: DataTypes.STRING, allowNull: false },
		label: { type: DataTypes.STRING },
		tokenHash: { type: DataTypes.STRING, allowNull: false, unique: true },
		expiresAt: { type: DataTypes.DATE, allowNull: false },
		usedAt: { type: DataTypes.DATE },
		cancelledAt: { type: DataTypes.DATE },
		createdBy: {
			type: DataTypes.INTEGER,
			references: { model: 'User', key: 'id' },
			onDelete: 'SET NULL',
			onUpdate: 'CASCADE'
		},
		createdAt: { type: DataTypes.DATE, allowNull: false },
		updatedAt: { type: DataTypes.DATE, allowNull: false }
	});
	await queryInterface.addIndex('InviteCodes', ['chapterId', 'batch'], {
		name: 'invite_codes_chapter_batch'
	});
	await queryInterface.addColumn('User', 'sponsoredBy', {
		type: DataTypes.INTEGER,
		references: { model: 'Chapters', key: 'id' },
		onDelete: 'SET NULL',
		onUpdate: 'CASCADE'
	});
	await queryInterface.addIndex('User', ['sponsoredBy'], { name: 'user_sponsored_by' });
}

export async function down({ context: queryInterface }) {
	await queryInterface.removeIndex('User', 'user_sponsored_by');
	await withForeignKeysOff(queryInterface, async () => {
		await queryInterface.removeColumn('User', 'sponsoredBy');
	});
	await queryInterface.dropTable('InviteCodes');
}

import { DataTypes } from 'sequelize';

/**
 * A group may block a writer from sending letters through it (decided 30
 * September 2026). One row per group and writer while the block stands;
 * lifting it deletes the row, and the audit log keeps both events.
 */
export async function up({ context: queryInterface }) {
	const ref = (table, onDelete) => ({
		references: { model: table, key: 'id' },
		onDelete,
		onUpdate: 'CASCADE'
	});
	await queryInterface.createTable('GroupBlocks', {
		id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
		chapterId: { type: DataTypes.INTEGER, allowNull: false, ...ref('Chapters', 'CASCADE') },
		userId: { type: DataTypes.INTEGER, allowNull: false, ...ref('User', 'CASCADE') },
		reason: { type: DataTypes.STRING, allowNull: false },
		blockedBy: { type: DataTypes.INTEGER, ...ref('User', 'SET NULL') },
		createdAt: { type: DataTypes.DATE, allowNull: false },
		updatedAt: { type: DataTypes.DATE, allowNull: false }
	});
	await queryInterface.addIndex('GroupBlocks', ['chapterId', 'userId'], {
		name: 'group_blocks_chapter_user',
		unique: true
	});
}

export async function down({ context: queryInterface }) {
	await queryInterface.dropTable('GroupBlocks');
}

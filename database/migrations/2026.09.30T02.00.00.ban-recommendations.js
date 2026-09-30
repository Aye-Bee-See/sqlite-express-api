import { DataTypes } from 'sequelize';

/**
 * A group admin may recommend that a writer be blocked site-wide, with a
 * reason; the recommendation waits in the moderation queue and a superadmin
 * decides (decided 30 September 2026). A site-wide block is the existing ban.
 */
export async function up({ context: queryInterface }) {
	const ref = (table, onDelete) => ({
		references: { model: table, key: 'id' },
		onDelete,
		onUpdate: 'CASCADE'
	});
	await queryInterface.createTable('BanRecommendations', {
		id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
		userId: { type: DataTypes.INTEGER, allowNull: false, ...ref('User', 'CASCADE') },
		chapterId: { type: DataTypes.INTEGER, ...ref('Chapters', 'SET NULL') },
		recommendedBy: { type: DataTypes.INTEGER, ...ref('User', 'SET NULL') },
		reason: { type: DataTypes.STRING, allowNull: false },
		status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'pending' },
		decidedBy: { type: DataTypes.INTEGER, ...ref('User', 'SET NULL') },
		decidedAt: { type: DataTypes.DATE },
		decisionNote: { type: DataTypes.STRING },
		createdAt: { type: DataTypes.DATE, allowNull: false },
		updatedAt: { type: DataTypes.DATE, allowNull: false }
	});
	await queryInterface.addIndex('BanRecommendations', ['status'], {
		name: 'ban_recommendations_status'
	});
	await queryInterface.addIndex('BanRecommendations', ['userId'], {
		name: 'ban_recommendations_user'
	});
}

export async function down({ context: queryInterface }) {
	await queryInterface.dropTable('BanRecommendations');
}

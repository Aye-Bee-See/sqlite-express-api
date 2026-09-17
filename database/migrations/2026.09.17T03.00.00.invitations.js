import { DataTypes } from 'sequelize';

/**
 * Invitations: how a new group joins the network (an active group vouches
 * for it) and how a group adds its own members. Only the token's hash is
 * stored; the token itself is shown once to the inviter and handed over
 * off the platform.
 */

function ref(table, onDelete) {
	return { references: { model: table, key: 'id' }, onDelete, onUpdate: 'CASCADE' };
}

export async function up({ context: queryInterface }) {
	await queryInterface.createTable('Invitations', {
		id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
		kind: { type: DataTypes.STRING, allowNull: false },
		chapterId: { type: DataTypes.INTEGER, ...ref('Chapters', 'CASCADE') },
		inviteeName: { type: DataTypes.STRING, allowNull: false },
		inviteeEmail: { type: DataTypes.STRING },
		note: { type: DataTypes.TEXT },
		tokenHash: { type: DataTypes.STRING, allowNull: false, unique: true },
		expiresAt: { type: DataTypes.DATE, allowNull: false },
		status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'pending' },
		invitedBy: { type: DataTypes.INTEGER, ...ref('User', 'SET NULL') },
		acceptedAt: { type: DataTypes.DATE },
		acceptedUser: { type: DataTypes.INTEGER, ...ref('User', 'SET NULL') },
		createdChapter: { type: DataTypes.INTEGER, ...ref('Chapters', 'SET NULL') },
		createdAt: { type: DataTypes.DATE, allowNull: false },
		updatedAt: { type: DataTypes.DATE, allowNull: false }
	});
	await queryInterface.addIndex('Invitations', ['chapterId', 'status'], {
		name: 'invitations_chapter_status'
	});
}

export async function down({ context: queryInterface }) {
	await queryInterface.dropTable('Invitations');
}

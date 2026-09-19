import { DataTypes } from 'sequelize';

/**
 * Push notifications, content-free. Devices holds each signed-in device's
 * push token. Notifications is the feed the apps read after a push wakes
 * them: the push itself says nothing, so what happened has to be fetched
 * over the app's own connection.
 */

function ref(table, onDelete) {
	return { references: { model: table, key: 'id' }, onDelete, onUpdate: 'CASCADE' };
}

export async function up({ context: queryInterface }) {
	await queryInterface.createTable('Devices', {
		id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
		userId: { type: DataTypes.INTEGER, allowNull: false, ...ref('User', 'CASCADE') },
		provider: { type: DataTypes.STRING, allowNull: false },
		platform: { type: DataTypes.STRING, allowNull: false },
		token: { type: DataTypes.TEXT, allowNull: false, unique: true },
		label: { type: DataTypes.STRING },
		muted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
		sessionId: { type: DataTypes.STRING },
		lastSeenAt: { type: DataTypes.DATE },
		createdAt: { type: DataTypes.DATE, allowNull: false },
		updatedAt: { type: DataTypes.DATE, allowNull: false }
	});
	await queryInterface.addIndex('Devices', ['userId'], { name: 'devices_user' });

	await queryInterface.createTable('Notifications', {
		id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
		userId: { type: DataTypes.INTEGER, allowNull: false, ...ref('User', 'CASCADE') },
		event: { type: DataTypes.STRING, allowNull: false },
		// A notification about a letter goes when the letter goes (retention, deletion).
		chat: { type: DataTypes.INTEGER, ...ref('Chats', 'CASCADE') },
		message: { type: DataTypes.INTEGER, ...ref('Messages', 'CASCADE') },
		submission: { type: DataTypes.INTEGER, ...ref('Submissions', 'CASCADE') },
		detail: { type: DataTypes.JSON },
		readAt: { type: DataTypes.DATE },
		createdAt: { type: DataTypes.DATE, allowNull: false },
		updatedAt: { type: DataTypes.DATE, allowNull: false }
	});
	await queryInterface.addIndex('Notifications', ['userId', 'id'], { name: 'notifications_user' });
}

export async function down({ context: queryInterface }) {
	await queryInterface.dropTable('Notifications');
	await queryInterface.dropTable('Devices');
}

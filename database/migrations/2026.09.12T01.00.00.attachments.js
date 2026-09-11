import { DataTypes } from 'sequelize';

/**
 * Attachments: files (scans of replies, enclosures) that belong to a
 * message. The bytes live on disk under UPLOAD_DIR; the row carries the
 * stored name, the original name and type, and who uploaded it.
 */

function ref(table, onDelete) {
	return { references: { model: table, key: 'id' }, onDelete, onUpdate: 'CASCADE' };
}

export async function up({ context: queryInterface }) {
	await queryInterface.createTable('Attachments', {
		id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
		message: { type: DataTypes.INTEGER, allowNull: false, ...ref('Messages', 'CASCADE') },
		storedName: { type: DataTypes.STRING, allowNull: false, unique: true },
		originalName: { type: DataTypes.STRING },
		mimeType: { type: DataTypes.STRING, allowNull: false },
		size: { type: DataTypes.INTEGER, allowNull: false },
		uploadedBy: { type: DataTypes.INTEGER, ...ref('User', 'SET NULL') },
		createdAt: { type: DataTypes.DATE, allowNull: false },
		updatedAt: { type: DataTypes.DATE, allowNull: false }
	});
	await queryInterface.addIndex('Attachments', ['message'], { name: 'attachments_message' });
}

export async function down({ context: queryInterface }) {
	await queryInterface.dropTable('Attachments');
}

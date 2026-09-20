import { DataTypes } from 'sequelize';
import { withForeignKeysOff } from '../migration-helpers.js';

/**
 * Letter lifecycle: every message gets a status (queued, printed, mailed for
 * outgoing letters; received for prisoner replies), the relay group that
 * prints and mails it, a note for that group, and who last changed the
 * status. A MessageStatuses table keeps the history.
 */

function ref(table, onDelete) {
	return { references: { model: table, key: 'id' }, onDelete, onUpdate: 'CASCADE' };
}

const MESSAGE_COLUMNS = {
	status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'queued' },
	relayChapter: { type: DataTypes.INTEGER, ...ref('Chapters', 'SET NULL') },
	relayNote: { type: DataTypes.TEXT },
	statusChangedAt: { type: DataTypes.DATE },
	statusChangedBy: { type: DataTypes.INTEGER, ...ref('User', 'SET NULL') }
};

export async function up({ context: queryInterface }) {
	for (const [name, definition] of Object.entries(MESSAGE_COLUMNS)) {
		await queryInterface.addColumn('Messages', name, definition);
	}
	// Existing rows: replies are received, everything else starts queued.
	await queryInterface.sequelize.query(
		"UPDATE `Messages` SET `status` = 'received' WHERE `sender` = 'prisoner'"
	);
	await queryInterface.addIndex('Messages', ['relayChapter', 'status'], {
		name: 'messages_relay_chapter_status'
	});

	await queryInterface.createTable('MessageStatuses', {
		id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
		message: { type: DataTypes.INTEGER, allowNull: false, ...ref('Messages', 'CASCADE') },
		fromStatus: { type: DataTypes.STRING },
		toStatus: { type: DataTypes.STRING, allowNull: false },
		changedBy: { type: DataTypes.INTEGER, ...ref('User', 'SET NULL') },
		createdAt: { type: DataTypes.DATE, allowNull: false },
		updatedAt: { type: DataTypes.DATE, allowNull: false }
	});
}

export async function down({ context: queryInterface }) {
	await queryInterface.dropTable('MessageStatuses');
	await queryInterface.removeIndex('Messages', 'messages_relay_chapter_status');
	// removeColumn rebuilds the table: see withForeignKeysOff.
	await withForeignKeysOff(queryInterface, async () => {
		for (const name of Object.keys(MESSAGE_COLUMNS).reverse()) {
			await queryInterface.removeColumn('Messages', name);
		}
	});
}

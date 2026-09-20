import { DataTypes } from 'sequelize';
import { dropColumn, withForeignKeysOff } from '../migration-helpers.js';

/**
 * Returned mail. A mailed letter that comes back becomes `returned` (a value
 * of the existing status columns, which are free text checked by the models),
 * and says why: `reason` and an optional short `note` on the history row,
 * `returnReason` on the letter itself so that lists can show it. `resendOf`
 * links a new letter to the returned one it replaces.
 */

export async function up({ context: queryInterface }) {
	await queryInterface.addColumn('MessageStatuses', 'reason', { type: DataTypes.STRING });
	await queryInterface.addColumn('MessageStatuses', 'note', { type: DataTypes.STRING });
	await queryInterface.addColumn('Messages', 'returnReason', { type: DataTypes.STRING });
	await queryInterface.addColumn('Messages', 'resendOf', {
		type: DataTypes.INTEGER,
		references: { model: 'Messages', key: 'id' },
		onDelete: 'SET NULL',
		onUpdate: 'CASCADE'
	});
	// "Which prisoners had mail come back lately" reads the history by status and date.
	await queryInterface.addIndex('MessageStatuses', ['toStatus', 'createdAt'], {
		name: 'message_statuses_to_status_created'
	});
}

export async function down({ context: queryInterface }) {
	await queryInterface.removeIndex('MessageStatuses', 'message_statuses_to_status_created');
	// A returned letter has no earlier shape to go back to; mailed is what it was before.
	await queryInterface.sequelize.query(
		"UPDATE `Messages` SET `status` = 'mailed' WHERE `status` = 'returned'"
	);
	await queryInterface.sequelize.query(
		"DELETE FROM `MessageStatuses` WHERE `toStatus` = 'returned'"
	);
	// resendOf is a foreign key, which SQLite will not drop in place: a guarded rebuild.
	await withForeignKeysOff(queryInterface, async () => {
		await queryInterface.removeColumn('Messages', 'resendOf');
	});
	await dropColumn(queryInterface, 'Messages', 'returnReason');
	await dropColumn(queryInterface, 'MessageStatuses', 'note');
	await dropColumn(queryInterface, 'MessageStatuses', 'reason');
}

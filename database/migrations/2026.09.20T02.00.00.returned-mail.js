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
	// resent_as reads by it, and so does every delete of a letter: SET NULL makes
	// SQLite look for the rows that point at the one going (retention deletes many).
	await queryInterface.addIndex('Messages', ['resendOf'], { name: 'messages_resend_of' });
	// "Which prisoners had mail come back lately" reads the history by status and date.
	await queryInterface.addIndex('MessageStatuses', ['toStatus', 'createdAt'], {
		name: 'message_statuses_to_status_created'
	});
}

export async function down({ context: queryInterface }) {
	await queryInterface.removeIndex('MessageStatuses', 'message_statuses_to_status_created');
	await queryInterface.removeIndex('Messages', 'messages_resend_of');
	// A returned letter goes back to what it was before: mailed, on the day and by the
	// account that mailed it. (statusChangedAt is what retention counts from; left at
	// the day of the return it would say the letter was mailed then.)
	const lastMailed = (column) =>
		'COALESCE((SELECT `s`.`' +
		column +
		"` FROM `MessageStatuses` AS `s` WHERE `s`.`message` = `Messages`.`id` AND `s`.`toStatus` = 'mailed' ORDER BY `s`.`id` DESC LIMIT 1), ";
	await queryInterface.sequelize.query(
		"UPDATE `Messages` SET `status` = 'mailed', " +
			'`statusChangedAt` = ' +
			lastMailed('createdAt') +
			'`statusChangedAt`), ' +
			'`statusChangedBy` = ' +
			lastMailed('changedBy') +
			'NULL) ' +
			"WHERE `status` = 'returned'"
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

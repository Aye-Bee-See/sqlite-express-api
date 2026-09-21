import { DataTypes } from 'sequelize';
import { dropColumn } from '../migration-helpers.js';

/**
 * A group's public numbers are counted, not typed.
 *
 * - `lettersCounted`: letters this group has marked mailed here. Only ever goes up
 *   (retention deletes old letters, so this cannot be a COUNT of rows).
 * - `lettersSentBefore`: what the group mailed before it used the site; theirs to set.
 * - `lettersSent` (the column clients already read) becomes the sum of the two, as
 *   text, and is NULL below 20: a small group is not put on show as "4 letters".
 *
 * What a group had typed becomes its `lettersSentBefore`. A group that typed nothing
 * starts from the letters it has already mailed here.
 */

export const PUBLIC_FROM = 20;

export async function up({ context: queryInterface }) {
	const { sequelize } = queryInterface;
	for (const column of ['lettersCounted', 'lettersSentBefore']) {
		await queryInterface.addColumn('Chapters', column, {
			type: DataTypes.INTEGER,
			allowNull: false,
			defaultValue: 0
		});
	}
	// CAST reads the number a text begins with ("120+" is 120, "about 300" is 0).
	await sequelize.query(
		'UPDATE `Chapters` SET `lettersSentBefore` = MAX(CAST(COALESCE(`lettersSent`, 0) AS INTEGER), 0)'
	);
	await sequelize.query(
		"UPDATE `Chapters` SET `lettersCounted` = (SELECT COUNT(*) FROM `Messages` WHERE `Messages`.`relayChapter` = `Chapters`.`id` AND `Messages`.`status` IN ('mailed', 'returned')) WHERE `lettersSentBefore` = 0"
	);
	await sequelize.query(
		'UPDATE `Chapters` SET `lettersSent` = CASE WHEN `lettersSentBefore` + `lettersCounted` >= ' +
			PUBLIC_FROM +
			' THEN CAST(`lettersSentBefore` + `lettersCounted` AS TEXT) ELSE NULL END'
	);
}

export async function down({ context: queryInterface }) {
	// The typed column gets the whole figure back, shown or not.
	await queryInterface.sequelize.query(
		'UPDATE `Chapters` SET `lettersSent` = CAST(`lettersSentBefore` + `lettersCounted` AS TEXT) WHERE `lettersSentBefore` + `lettersCounted` > 0'
	);
	await dropColumn(queryInterface, 'Chapters', 'lettersSentBefore');
	await dropColumn(queryInterface, 'Chapters', 'lettersCounted');
}

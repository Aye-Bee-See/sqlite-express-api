import { DataTypes } from 'sequelize';
import { dropColumn } from '../migration-helpers.js';

/**
 * A `facility_rule` decline kept only the rule's tag, and the writer's client
 * looked the wording up in GET /prison/mail-rules. That list leaves out retired
 * rules for writers, a rule no facility carries can be deleted, and a renamed
 * rule changed what an old decline said (#183). The letter now keeps the rule's
 * label as it read when the group declined it.
 *
 * Letters already declined take the label their rule has now, retired or not;
 * a letter whose rule is gone keeps null, because that wording is gone too.
 */
export async function up({ context: queryInterface }) {
	await queryInterface.addColumn('Messages', 'declineRuleLabel', { type: DataTypes.STRING });
	await queryInterface.sequelize.query(
		'UPDATE `Messages` SET `declineRuleLabel` = ' +
			'(SELECT `label` FROM `MailRules` WHERE `MailRules`.`tag` = `Messages`.`declineRule`) ' +
			'WHERE `declineRule` IS NOT NULL'
	);
}

export async function down({ context: queryInterface }) {
	await dropColumn(queryInterface, 'Messages', 'declineRuleLabel');
}

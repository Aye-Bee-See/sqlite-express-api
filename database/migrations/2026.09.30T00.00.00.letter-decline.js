import { DataTypes } from 'sequelize';
import { dropColumn } from '../migration-helpers.js';

/**
 * A group may decline to mail a letter it relays, with a reason (decided 30
 * September 2026). The reason sits on the letter, like `returnReason`, so a
 * list can show it; the history row keeps it too, with the rule when the
 * reason is a facility's mail rule.
 */
export async function up({ context: queryInterface }) {
	await queryInterface.addColumn('Messages', 'declineReason', { type: DataTypes.STRING });
	await queryInterface.addColumn('Messages', 'declineRule', { type: DataTypes.STRING });
	await queryInterface.addColumn('Messages', 'declineNote', { type: DataTypes.STRING });
	await queryInterface.addColumn('MessageStatuses', 'rule', { type: DataTypes.STRING });
}

export async function down({ context: queryInterface }) {
	await dropColumn(queryInterface, 'MessageStatuses', 'rule');
	await dropColumn(queryInterface, 'Messages', 'declineNote');
	await dropColumn(queryInterface, 'Messages', 'declineRule');
	await dropColumn(queryInterface, 'Messages', 'declineReason');
}

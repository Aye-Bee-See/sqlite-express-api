import { DataTypes } from 'sequelize';
import { dropColumn } from '../migration-helpers.js';

/**
 * The note that came with a return ("Stamped NOT HERE") lived only on the
 * history row, so a client wanting to show it beside a returned letter read the
 * history of every one. It now sits on the letter too, set with the status.
 */
export async function up({ context: queryInterface }) {
	await queryInterface.addColumn('Messages', 'returnNote', { type: DataTypes.STRING });
	await queryInterface.sequelize.query(
		`UPDATE Messages SET returnNote = (
			SELECT note FROM MessageStatuses s
			WHERE s.message = Messages.id AND s.toStatus = 'returned'
			ORDER BY s.id DESC LIMIT 1
		) WHERE status = 'returned'`
	);
}

export async function down({ context: queryInterface }) {
	await dropColumn(queryInterface, 'Messages', 'returnNote');
}

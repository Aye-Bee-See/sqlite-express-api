import { DataTypes } from 'sequelize';
import { dropColumn } from '../migration-helpers.js';

/**
 * Paper letters: a letter written by hand and handed to the group to mail. It
 * has no body to print, so it starts as `printed` and goes out with the
 * night's batch; the record exists so a reply can find its thread.
 * Decided on 22 September 2026.
 */
export async function up({ context: queryInterface }) {
	await queryInterface.addColumn('Messages', 'paper', {
		type: DataTypes.BOOLEAN,
		allowNull: false,
		defaultValue: false
	});
}

export async function down({ context: queryInterface }) {
	await dropColumn(queryInterface, 'Messages', 'paper');
}

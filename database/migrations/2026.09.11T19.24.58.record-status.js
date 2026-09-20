import { DataTypes } from 'sequelize';
import { withForeignKeysOff } from '../migration-helpers.js';

/**
 * Add recordStatus (draft | pending | published) to the three directory
 * tables that the public site lists. Existing rows become published, which
 * matches how they were visible before this column existed.
 */
const TABLES = ['Prisons', 'Prisoners', 'Chapters'];

export async function up({ context: queryInterface }) {
	for (const table of TABLES) {
		await queryInterface.addColumn(table, 'recordStatus', {
			type: DataTypes.STRING,
			allowNull: false,
			defaultValue: 'published'
		});
	}
}

export async function down({ context: queryInterface }) {
	// removeColumn rebuilds the table: see withForeignKeysOff.
	await withForeignKeysOff(queryInterface, async () => {
		for (const table of TABLES) {
			await queryInterface.removeColumn(table, 'recordStatus');
		}
	});
}

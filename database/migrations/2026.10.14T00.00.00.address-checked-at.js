import { DataTypes } from 'sequelize';
import { dropColumn } from '../migration-helpers.js';

/**
 * A prisoner's address is "in doubt" when a letter came back transferred,
 * released, or undeliverable and nobody has looked at the address since. That
 * was measured against `updatedAt`, so any change to the record, a photo
 * included, cleared the doubt (#216). Only an edit of the address itself
 * counts now (decided 14 October 2026): the facility (`prison`) and the inmate
 * number (`inmateID`), which together are where a letter is sent.
 *
 * Existing records start with the time they were last edited, so no record's
 * doubt changes on the day this runs.
 */
export async function up({ context: queryInterface }) {
	await queryInterface.addColumn('Prisoners', 'addressCheckedAt', { type: DataTypes.DATE });
	await queryInterface.sequelize.query('UPDATE `Prisoners` SET `addressCheckedAt` = `updatedAt`');
}

export async function down({ context: queryInterface }) {
	await dropColumn(queryInterface, 'Prisoners', 'addressCheckedAt');
}

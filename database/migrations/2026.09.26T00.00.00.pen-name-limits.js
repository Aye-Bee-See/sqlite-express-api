import { DataTypes } from 'sequelize';
import { dropColumn } from '../migration-helpers.js';

/**
 * When each pen name became the account's current one (decided 25 September
 * 2026). A name once used is never given to anyone else, so an account that
 * renames itself without limit empties a namespace everybody shares. The
 * limits are a cooldown between changes and a cap on brand-new names per
 * year, and both are measured from this column: `createdAt` says when a name
 * was first taken, `claimedAt` when it last became current, which differ for
 * an account that goes back to a name it used before.
 */
export async function up({ context: queryInterface }) {
	await queryInterface.addColumn('PenNames', 'claimedAt', { type: DataTypes.DATE });
	// Existing names became current when they were made: nothing has gone back yet.
	await queryInterface.sequelize.query(
		'UPDATE PenNames SET claimedAt = createdAt WHERE claimedAt IS NULL'
	);
}

export async function down({ context: queryInterface }) {
	await dropColumn(queryInterface, 'PenNames', 'claimedAt');
}

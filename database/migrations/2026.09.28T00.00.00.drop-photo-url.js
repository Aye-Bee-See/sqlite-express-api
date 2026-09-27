import { DataTypes } from 'sequelize';
import { dropColumn } from '../migration-helpers.js';

/**
 * Photos are hosted here, so the link to a photo hosted elsewhere goes
 * (decided 28 September 2026: no client was ever built to load one, and a
 * third-party image would tell that host who is looking at which prisoner).
 *
 * Nothing is lost: no seed set `photoUrl`, and no record on the test server
 * carried one. A record's photo is `photoFile` and the `photo` field over it.
 */
export async function up({ context: queryInterface }) {
	await dropColumn(queryInterface, 'Prisoners', 'photoUrl');
}

export async function down({ context: queryInterface }) {
	await queryInterface.addColumn('Prisoners', 'photoUrl', { type: DataTypes.STRING });
}

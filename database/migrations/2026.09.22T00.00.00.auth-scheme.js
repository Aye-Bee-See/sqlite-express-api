import { DataTypes } from 'sequelize';
import { dropColumn } from '../migration-helpers.js';

/**
 * How an account proves who it is: `plain` (the password is sent) or `split`
 * (the device sends a key derived from the password, and the password never
 * leaves it). Every account that exists is plain; clients move accounts over
 * as they set keys up. See services/auth-scheme.js.
 */
export async function up({ context: queryInterface }) {
	await queryInterface.addColumn('User', 'authScheme', {
		type: DataTypes.STRING,
		allowNull: false,
		defaultValue: 'plain'
	});
}

export async function down({ context: queryInterface }) {
	await dropColumn(queryInterface, 'User', 'authScheme');
}

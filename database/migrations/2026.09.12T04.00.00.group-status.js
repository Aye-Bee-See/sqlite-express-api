import { DataTypes } from 'sequelize';

/**
 * Group network fields: what a group does in the mail flow (networkRole) and
 * whether it is an approved member of the network (accountStatus). Groups
 * that already exist are treated as approved.
 */

export async function up({ context: queryInterface }) {
	await queryInterface.addColumn('Chapters', 'networkRole', {
		type: DataTypes.STRING,
		allowNull: false,
		defaultValue: 'collecting'
	});
	await queryInterface.addColumn('Chapters', 'accountStatus', {
		type: DataTypes.STRING,
		allowNull: false,
		defaultValue: 'pending'
	});
	await queryInterface.sequelize.query("UPDATE `Chapters` SET `accountStatus` = 'active'");
}

export async function down({ context: queryInterface }) {
	await queryInterface.removeColumn('Chapters', 'accountStatus');
	await queryInterface.removeColumn('Chapters', 'networkRole');
}

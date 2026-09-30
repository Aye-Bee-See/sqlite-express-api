import { DataTypes } from 'sequelize';
import { dropColumn } from '../migration-helpers.js';

/**
 * A superadmin may make two-factor sign-in required: for all superadmins, for
 * the group admins of every group, or for chosen groups (decided 30 September
 * 2026). All of it starts off. Site-wide switches live in SiteSettings, one row
 * per setting; the per-group one on the group.
 */
export async function up({ context: queryInterface }) {
	await queryInterface.createTable('SiteSettings', {
		key: { type: DataTypes.STRING, primaryKey: true },
		value: { type: DataTypes.JSON, allowNull: false },
		updatedBy: {
			type: DataTypes.INTEGER,
			references: { model: 'User', key: 'id' },
			onDelete: 'SET NULL',
			onUpdate: 'CASCADE'
		},
		createdAt: { type: DataTypes.DATE, allowNull: false },
		updatedAt: { type: DataTypes.DATE, allowNull: false }
	});
	await queryInterface.addColumn('Chapters', 'requireTwoFactor', {
		type: DataTypes.BOOLEAN,
		allowNull: false,
		defaultValue: false
	});
}

export async function down({ context: queryInterface }) {
	await dropColumn(queryInterface, 'Chapters', 'requireTwoFactor');
	await queryInterface.dropTable('SiteSettings');
}

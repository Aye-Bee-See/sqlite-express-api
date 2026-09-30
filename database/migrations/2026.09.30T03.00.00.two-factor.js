import { DataTypes } from 'sequelize';
import { dropColumn } from '../migration-helpers.js';

/**
 * Two-factor sign-in (decided 30 September 2026): an authenticator-app secret
 * per account, the secret waiting to be confirmed while one is being set up,
 * the last code's time step (so a code works once), and one-time recovery codes,
 * kept only as hashes.
 */
export async function up({ context: queryInterface }) {
	await queryInterface.addColumn('User', 'totpSecret', { type: DataTypes.STRING });
	await queryInterface.addColumn('User', 'totpPendingSecret', { type: DataTypes.STRING });
	await queryInterface.addColumn('User', 'totpEnabledAt', { type: DataTypes.DATE });
	await queryInterface.addColumn('User', 'totpLastStep', { type: DataTypes.INTEGER });
	await queryInterface.createTable('TwoFactorRecoveryCodes', {
		id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
		userId: {
			type: DataTypes.INTEGER,
			allowNull: false,
			references: { model: 'User', key: 'id' },
			onDelete: 'CASCADE',
			onUpdate: 'CASCADE'
		},
		codeHash: { type: DataTypes.STRING, allowNull: false, unique: true },
		createdAt: { type: DataTypes.DATE, allowNull: false },
		updatedAt: { type: DataTypes.DATE, allowNull: false }
	});
	await queryInterface.addIndex('TwoFactorRecoveryCodes', ['userId'], {
		name: 'two_factor_recovery_codes_user'
	});
}

export async function down({ context: queryInterface }) {
	await queryInterface.dropTable('TwoFactorRecoveryCodes');
	await dropColumn(queryInterface, 'User', 'totpLastStep');
	await dropColumn(queryInterface, 'User', 'totpEnabledAt');
	await dropColumn(queryInterface, 'User', 'totpPendingSecret');
	await dropColumn(queryInterface, 'User', 'totpSecret');
}

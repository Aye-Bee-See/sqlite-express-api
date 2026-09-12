import { DataTypes } from 'sequelize';

/**
 * Sessions: tokens carry an id (jti) so a single one can be revoked at
 * logout, and accounts carry sessionsRevokedAt so every token issued
 * before that instant is refused ("log out everywhere", admin revocation,
 * password change, recovery). Revoked ids are kept only until the token
 * would have expired anyway.
 */

function ref(table, onDelete) {
	return { references: { model: table, key: 'id' }, onDelete, onUpdate: 'CASCADE' };
}

export async function up({ context: queryInterface }) {
	await queryInterface.addColumn('User', 'sessionsRevokedAt', { type: DataTypes.DATE });
	await queryInterface.createTable('RevokedTokens', {
		jti: { type: DataTypes.STRING, primaryKey: true },
		userId: { type: DataTypes.INTEGER, ...ref('User', 'SET NULL') },
		expiresAt: { type: DataTypes.DATE, allowNull: false },
		createdAt: { type: DataTypes.DATE, allowNull: false }
	});
	await queryInterface.addIndex('RevokedTokens', ['expiresAt'], {
		name: 'revoked_tokens_expires_at'
	});
}

export async function down({ context: queryInterface }) {
	await queryInterface.dropTable('RevokedTokens');
	// Column removal rebuilds the table; keep the rows that reference it.
	const { withForeignKeysOff } = await import('../migration-helpers.js');
	await withForeignKeysOff(queryInterface, async () => {
		await queryInterface.removeColumn('User', 'sessionsRevokedAt');
	});
}

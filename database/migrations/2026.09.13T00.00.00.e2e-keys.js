import { DataTypes } from 'sequelize';

/**
 * Key material for end-to-end mode. Accounts get an X25519 public key and
 * their private key wrapped two ways (password-derived key, recovery-code
 * derived key); managed writers also carry a copy wrapped to their group.
 * Groups get a public key, with the group private key wrapped once per
 * member in OrgMemberKeys. Claim tokens carry the writer's private key
 * wrapped with the token secret. All of it is opaque to the server.
 */

function ref(table, onDelete) {
	return { references: { model: table, key: 'id' }, onDelete, onUpdate: 'CASCADE' };
}

const USER_COLUMNS = {
	publicKey: { type: DataTypes.STRING },
	wrappedPrivateKey: { type: DataTypes.TEXT },
	kdfSalt: { type: DataTypes.STRING },
	kdfParams: { type: DataTypes.JSON },
	recoveryWrappedPrivateKey: { type: DataTypes.TEXT },
	recoverySalt: { type: DataTypes.STRING },
	recoveryKdfParams: { type: DataTypes.JSON },
	orgWrappedPrivateKey: { type: DataTypes.TEXT },
	recoveryChallengeHash: { type: DataTypes.STRING },
	recoveryChallengeExpiresAt: { type: DataTypes.DATE }
};

const CLAIM_COLUMNS = {
	claimWrappedPrivateKey: { type: DataTypes.TEXT },
	claimSalt: { type: DataTypes.STRING },
	claimKdfParams: { type: DataTypes.JSON }
};

export async function up({ context: queryInterface }) {
	for (const [name, definition] of Object.entries(USER_COLUMNS)) {
		await queryInterface.addColumn('User', name, definition);
	}
	await queryInterface.addColumn('Chapters', 'publicKey', { type: DataTypes.STRING });
	for (const [name, definition] of Object.entries(CLAIM_COLUMNS)) {
		await queryInterface.addColumn('ClaimTokens', name, definition);
	}
	await queryInterface.createTable('OrgMemberKeys', {
		id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
		chapterId: { type: DataTypes.INTEGER, allowNull: false, ...ref('Chapters', 'CASCADE') },
		userId: { type: DataTypes.INTEGER, allowNull: false, ...ref('User', 'CASCADE') },
		wrappedOrgPrivateKey: { type: DataTypes.TEXT, allowNull: false },
		addedBy: { type: DataTypes.INTEGER, ...ref('User', 'SET NULL') },
		createdAt: { type: DataTypes.DATE, allowNull: false },
		updatedAt: { type: DataTypes.DATE, allowNull: false }
	});
	await queryInterface.addIndex('OrgMemberKeys', ['chapterId', 'userId'], {
		unique: true,
		name: 'org_member_keys_unique'
	});
}

export async function down({ context: queryInterface }) {
	await queryInterface.dropTable('OrgMemberKeys');
	for (const name of Object.keys(CLAIM_COLUMNS).reverse()) {
		await queryInterface.removeColumn('ClaimTokens', name);
	}
	await queryInterface.removeColumn('Chapters', 'publicKey');
	for (const name of Object.keys(USER_COLUMNS).reverse()) {
		await queryInterface.removeColumn('User', name);
	}
}

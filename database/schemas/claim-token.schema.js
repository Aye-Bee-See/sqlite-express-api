import { DataTypes } from 'sequelize';

/**
 * One-time tokens that let a managed writer claim their account. Only the
 * SHA-256 hash of the token is stored; the plaintext is shown once to the
 * group that generated it.
 */
const claimTokenSchema = {
	userId: {
		type: DataTypes.INTEGER,
		allowNull: false
	},
	tokenHash: {
		type: DataTypes.STRING,
		allowNull: false,
		unique: true
	},
	expiresAt: {
		type: DataTypes.DATE,
		allowNull: false
	},
	usedAt: {
		type: DataTypes.DATE
	},
	createdBy: {
		type: DataTypes.INTEGER
	},
	/** e2e mode: the writer's private key wrapped with a key derived from the token. */
	claimWrappedPrivateKey: {
		type: DataTypes.TEXT
	},
	claimSalt: {
		type: DataTypes.STRING
	},
	claimKdfParams: {
		type: DataTypes.JSON
	}
};

export default claimTokenSchema;

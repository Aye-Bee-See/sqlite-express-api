import { DataTypes } from 'sequelize';

/** One unused two-factor recovery code, as a hash of its normalised form. */
const twoFactorRecoveryCodeSchema = {
	userId: {
		type: DataTypes.INTEGER,
		allowNull: false
	},
	codeHash: {
		type: DataTypes.STRING,
		allowNull: false,
		unique: true
	}
};

export default twoFactorRecoveryCodeSchema;

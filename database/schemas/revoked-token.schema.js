import { DataTypes } from 'sequelize';

/** A token id that was logged out before it expired. */
const revokedTokenSchema = {
	jti: {
		type: DataTypes.STRING,
		primaryKey: true
	},
	userId: {
		type: DataTypes.INTEGER
	},
	expiresAt: {
		type: DataTypes.DATE,
		allowNull: false
	}
};

export default revokedTokenSchema;

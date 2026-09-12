import { DataTypes } from 'sequelize';

/** The group's private key, sealed to one member's public key. */
const orgMemberKeySchema = {
	chapterId: {
		type: DataTypes.INTEGER,
		allowNull: false
	},
	userId: {
		type: DataTypes.INTEGER,
		allowNull: false
	},
	wrappedOrgPrivateKey: {
		type: DataTypes.TEXT,
		allowNull: false
	},
	addedBy: {
		type: DataTypes.INTEGER
	}
};

export default orgMemberKeySchema;

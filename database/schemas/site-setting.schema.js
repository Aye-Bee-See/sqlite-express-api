import { DataTypes } from 'sequelize';

/** One site-wide setting a superadmin changes at run time, by name. */
const siteSettingSchema = {
	key: {
		type: DataTypes.STRING,
		primaryKey: true
	},
	value: {
		type: DataTypes.JSON,
		allowNull: false
	},
	updatedBy: {
		type: DataTypes.INTEGER
	}
};

export default siteSettingSchema;

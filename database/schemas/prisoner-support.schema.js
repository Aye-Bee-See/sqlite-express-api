import { DataTypes } from 'sequelize';

/** Link table: which support groups back a prisoner, and in what capacity. */
const prisonerSupportSchema = {
	prisoner: {
		type: DataTypes.INTEGER,
		allowNull: false,
		primaryKey: true
	},
	chapter: {
		type: DataTypes.INTEGER,
		allowNull: false,
		primaryKey: true
	},
	description: {
		type: DataTypes.TEXT
	}
};

export default prisonerSupportSchema;

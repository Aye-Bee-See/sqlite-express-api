import { DataTypes } from 'sequelize';

const chatSchema = {
	user: {
		type: DataTypes.INTEGER,
		allowNull: false,
		model: 'User'
	},
	prisoner: {
		type: DataTypes.INTEGER,
		allowNull: false,
		model: 'Prisoner'
	},
	// Add the id field to the schema
	id: {
		type: DataTypes.INTEGER,
		primaryKey: true,
		autoIncrement: true
	}
};

export default chatSchema;

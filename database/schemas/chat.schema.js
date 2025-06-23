import { DataTypes } from 'sequelize';

const chatSchema = {
	user: {
		type: DataTypes.INTEGER,
		allowNull: false,
		references: {
			model: 'User',
			key: 'id'
		}
	},
	prisoner: {
		type: DataTypes.INTEGER,
		allowNull: false,
		references: {
			model: 'Prisoners',
			key: 'id'
		}
	},
	// Add the id field to the schema
	id: {
		type: DataTypes.INTEGER,
		primaryKey: true,
		autoIncrement: true
	}
};

export default chatSchema;

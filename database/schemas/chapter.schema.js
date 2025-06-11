import { DataTypes } from 'sequelize';

const chapterSchema = {
	name: {
		type: DataTypes.STRING,
		allowNull: false
	},
	location: {
		type: DataTypes.JSON,
		allowNull: false
	},
	prisoners: {
		type: DataTypes.JSON
	},
	lettersSent: {
		type: DataTypes.STRING
	},
	averageTimeDays: {
		type: DataTypes.INTEGER
	}
};

export default chapterSchema;

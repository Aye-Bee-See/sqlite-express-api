import { DataTypes } from 'sequelize';
import { recordStatusAttribute } from '#db/record-status.js';

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
	},
	recordStatus: {
		type: DataTypes.STRING,
		...recordStatusAttribute
	}
};

export default chapterSchema;

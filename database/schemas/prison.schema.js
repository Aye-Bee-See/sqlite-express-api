import { DataTypes } from 'sequelize';
import { recordStatusAttribute } from '#db/record-status.js';

const prisonSchema = {
	prisonName: {
		type: DataTypes.STRING,
		allowNull: false
	},
	address: {
		type: DataTypes.JSON,
		allowNull: false
	},
	recordStatus: {
		type: DataTypes.STRING,
		...recordStatusAttribute
	}
};

export default prisonSchema;

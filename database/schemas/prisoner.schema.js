import { DataTypes } from 'sequelize';
import { recordStatusAttribute } from '#db/record-status.js';

const prisonerSchema = {
	birthName: {
		type: DataTypes.STRING
	},
	chosenName: {
		type: DataTypes.STRING
	},
	prison: {
		type: DataTypes.INTEGER
	},
	inmateID: {
		type: DataTypes.STRING
	},
	releaseDate: {
		type: DataTypes.DATE
	},
	bio: {
		type: DataTypes.STRING
	},
	status: {
		type: DataTypes.STRING,
		validate: {
			isIn: {
				args: [['pretrial', 'incarcerated', 'free']],
				msg: 'Status must be pretrial, incarcerated, or free.'
			}
		}
	},
	recordStatus: {
		type: DataTypes.STRING,
		...recordStatusAttribute
	}
};
export default prisonerSchema;

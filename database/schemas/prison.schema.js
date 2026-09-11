import { DataTypes } from 'sequelize';
import { recordStatusAttribute } from '#db/record-status.js';
import { ROUTING_METHODS } from '#db/validators.js';

const prisonSchema = {
	prisonName: {
		type: DataTypes.STRING,
		allowNull: false
	},
	address: {
		type: DataTypes.JSON,
		allowNull: false
	},
	country: {
		type: DataTypes.STRING
	},
	routing: {
		type: DataTypes.STRING,
		validate: {
			isIn: {
				args: [ROUTING_METHODS],
				msg: 'Routing must be one of ' + ROUTING_METHODS.join(', ') + '.'
			}
		}
	},
	scanService: {
		type: DataTypes.TEXT
	},
	notes: {
		type: DataTypes.TEXT
	},
	verifiedBy: {
		type: DataTypes.INTEGER
	},
	verifiedAt: {
		type: DataTypes.DATE
	},
	verificationNotes: {
		type: DataTypes.TEXT
	},
	recordStatus: {
		type: DataTypes.STRING,
		...recordStatusAttribute
	}
};

export default prisonSchema;

import { DataTypes } from 'sequelize';
import { LETTER_STATUSES } from '#db/letter-status.js';

/** One row per status change of a message; the first row is its creation. */
const messageStatusSchema = {
	message: {
		type: DataTypes.INTEGER,
		allowNull: false
	},
	fromStatus: {
		type: DataTypes.STRING
	},
	toStatus: {
		type: DataTypes.STRING,
		allowNull: false,
		validate: {
			isIn: {
				args: [LETTER_STATUSES],
				msg: 'Status must be one of ' + LETTER_STATUSES.join(', ') + '.'
			}
		}
	},
	changedBy: {
		type: DataTypes.INTEGER
	}
};

export default messageStatusSchema;

import { DataTypes } from 'sequelize';
import { LETTER_STATUSES, RETURN_REASONS } from '#db/letter-status.js';

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
	},
	/** For a move to `returned`: why it came back. */
	reason: {
		type: DataTypes.STRING,
		validate: {
			isIn: {
				args: [RETURN_REASONS],
				msg: 'reason must be one of ' + RETURN_REASONS.join(', ') + '.'
			}
		}
	},
	/**
	 * For a move to `returned`: a few words from whoever handled it ("stamped
	 * REFUSED, no explanation"). Not encrypted in any mode, and the writer reads
	 * it: nothing about what the letter said belongs here.
	 */
	note: {
		type: DataTypes.STRING,
		validate: { len: { args: [0, 200], msg: 'note can be at most 200 characters.' } }
	}
};

export default messageStatusSchema;

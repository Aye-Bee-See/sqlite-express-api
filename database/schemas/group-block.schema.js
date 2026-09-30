import { DataTypes } from 'sequelize';

/** A writer a group will not mail letters for, and why. */
const groupBlockSchema = {
	chapterId: {
		type: DataTypes.INTEGER,
		allowNull: false
	},
	userId: {
		type: DataTypes.INTEGER,
		allowNull: false
	},
	/** Told to the writer, and to the group's other admins: at most 500 characters. */
	reason: {
		type: DataTypes.STRING,
		allowNull: false,
		validate: {
			len: { args: [1, 500], msg: 'reason must be 1 to 500 characters.' }
		}
	},
	blockedBy: {
		type: DataTypes.INTEGER
	}
};

export default groupBlockSchema;

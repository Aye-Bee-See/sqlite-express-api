import { DataTypes } from 'sequelize';

/** One single-use code a chapter issued; it never records who used it. */
const inviteCodeSchema = {
	chapterId: { type: DataTypes.INTEGER, allowNull: false },
	batch: { type: DataTypes.STRING, allowNull: false },
	label: {
		type: DataTypes.STRING,
		validate: { len: { args: [0, 80], msg: 'label can be at most 80 characters.' } }
	},
	tokenHash: { type: DataTypes.STRING, allowNull: false, unique: true },
	expiresAt: { type: DataTypes.DATE, allowNull: false },
	usedAt: { type: DataTypes.DATE },
	cancelledAt: { type: DataTypes.DATE },
	createdBy: { type: DataTypes.INTEGER }
};

export default inviteCodeSchema;

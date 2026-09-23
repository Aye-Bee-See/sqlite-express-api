import { DataTypes } from 'sequelize';

/** One name an account has signed letters with; the current one has no retiredAt. */
const penNameSchema = {
	userId: { type: DataTypes.INTEGER, allowNull: false },
	name: { type: DataTypes.STRING, allowNull: false },
	nameKey: { type: DataTypes.STRING, allowNull: false, unique: true },
	retiredAt: { type: DataTypes.DATE }
};

export default penNameSchema;

import { DataTypes } from 'sequelize';

/** One item of the front-page news feed. */
const newsItemSchema = {
	guid: { type: DataTypes.STRING, allowNull: false, unique: true },
	title: { type: DataTypes.STRING, allowNull: false },
	url: { type: DataTypes.STRING, allowNull: false },
	date: { type: DataTypes.DATE },
	summary: { type: DataTypes.TEXT },
	fetchedAt: { type: DataTypes.DATE, allowNull: false }
};

export default newsItemSchema;

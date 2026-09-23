import { DataTypes } from 'sequelize';

/** The ids behind a reply reference, kept for a while after the letter itself is gone. */
const replyReferenceSchema = {
	reference: { type: DataTypes.STRING, allowNull: false, unique: true },
	message: { type: DataTypes.INTEGER },
	user: { type: DataTypes.INTEGER, allowNull: false },
	prisoner: { type: DataTypes.INTEGER, allowNull: false },
	chapter: { type: DataTypes.INTEGER },
	mailedAt: { type: DataTypes.DATE },
	expiresAt: { type: DataTypes.DATE }
};

export default replyReferenceSchema;

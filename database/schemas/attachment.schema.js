import { DataTypes } from 'sequelize';

const attachmentSchema = {
	message: {
		type: DataTypes.INTEGER,
		allowNull: false
	},
	/** File name under UPLOAD_DIR; never exposed to clients. */
	storedName: {
		type: DataTypes.STRING,
		allowNull: false,
		unique: true
	},
	originalName: {
		type: DataTypes.STRING
	},
	mimeType: {
		type: DataTypes.STRING,
		allowNull: false
	},
	size: {
		type: DataTypes.INTEGER,
		allowNull: false
	},
	uploadedBy: {
		type: DataTypes.INTEGER
	},
	/** Nonce for the file's encryption with the letter's content key. */
	nonce: {
		type: DataTypes.STRING
	}
};

export default attachmentSchema;

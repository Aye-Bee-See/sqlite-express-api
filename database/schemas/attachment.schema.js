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
	}
};

export default attachmentSchema;

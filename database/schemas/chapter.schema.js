import { DataTypes } from 'sequelize';
import { recordStatusAttribute } from '#db/record-status.js';
import { CHAPTER_SERVICES, SOCIAL_LINK_KEYS, arrayFrom, objectOfStrings } from '#db/validators.js';

const chapterSchema = {
	name: {
		type: DataTypes.STRING,
		allowNull: false
	},
	location: {
		type: DataTypes.JSON,
		allowNull: false
	},
	subregion: {
		type: DataTypes.STRING
	},
	country: {
		type: DataTypes.STRING
	},
	about: {
		type: DataTypes.TEXT
	},
	website: {
		type: DataTypes.STRING,
		validate: { isUrl: { msg: 'Website must be a valid URL.' } }
	},
	email: {
		type: DataTypes.STRING,
		validate: { isEmail: { msg: 'Email must be in traditional email format. E.g. x@y.z' } }
	},
	socialLinks: {
		type: DataTypes.JSON,
		validate: objectOfStrings('Social links', SOCIAL_LINK_KEYS)
	},
	services: {
		type: DataTypes.JSON,
		validate: arrayFrom('Services', CHAPTER_SERVICES)
	},
	announcement: {
		type: DataTypes.TEXT
	},
	vouchedBy: {
		type: DataTypes.INTEGER
	},
	/** @deprecated superseded by the PrisonerSupport relation; kept for compatibility */
	prisoners: {
		type: DataTypes.JSON
	},
	lettersSent: {
		type: DataTypes.STRING
	},
	averageTimeDays: {
		type: DataTypes.INTEGER
	},
	recordStatus: {
		type: DataTypes.STRING,
		...recordStatusAttribute
	}
};

export default chapterSchema;

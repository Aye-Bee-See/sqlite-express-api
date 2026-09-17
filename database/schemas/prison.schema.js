import { DataTypes } from 'sequelize';
import { recordStatusAttribute } from '#db/record-status.js';
import { ROUTING_METHODS } from '#db/validators.js';
import { limitValidator, mailLanguagesValidator, mailRulesValidator } from '#db/mail-rules.js';

const prisonSchema = {
	prisonName: {
		type: DataTypes.STRING,
		allowNull: false
	},
	address: {
		type: DataTypes.JSON,
		allowNull: false
	},
	country: {
		type: DataTypes.STRING
	},
	routing: {
		type: DataTypes.STRING,
		validate: {
			isIn: {
				args: [ROUTING_METHODS],
				msg: 'Routing must be one of ' + ROUTING_METHODS.join(', ') + '.'
			}
		}
	},
	scanService: {
		type: DataTypes.TEXT
	},
	/** Mail rule tags from the vocabulary in database/mail-rules.js. */
	mailRules: {
		type: DataTypes.JSON,
		allowNull: false,
		defaultValue: [],
		validate: mailRulesValidator
	},
	/** Most single-sided pages a letter may have; null for no limit. */
	pageLimit: {
		type: DataTypes.INTEGER,
		validate: limitValidator('pageLimit')
	},
	/** Most loose photographs per envelope; null for no stated limit. */
	photoLimit: {
		type: DataTypes.INTEGER,
		validate: limitValidator('photoLimit')
	},
	/** ISO 639-1 codes mail must be written in; null or empty for no restriction. */
	mailLanguages: {
		type: DataTypes.JSON,
		validate: mailLanguagesValidator
	},
	notes: {
		type: DataTypes.TEXT
	},
	verifiedBy: {
		type: DataTypes.INTEGER
	},
	verifiedAt: {
		type: DataTypes.DATE
	},
	verificationNotes: {
		type: DataTypes.TEXT
	},
	recordStatus: {
		type: DataTypes.STRING,
		...recordStatusAttribute
	}
};

export default prisonSchema;

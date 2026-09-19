import { DataTypes } from 'sequelize';
import { recordStatusAttribute } from '#db/record-status.js';
import { ROUTING_METHODS } from '#db/validators.js';
import { limitValidator, mailLanguagesValidator } from '#db/mail-rules.js';

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
	/**
	 * The tags of the facility's rules, in master-list order. Not a column:
	 * the rules are rows of MailRules linked through PrisonMailRules, loaded
	 * as `mail_rule_details`. Setting it (a write, or a proposal being
	 * checked) holds the tags until Prison.updatePrison stores the links.
	 */
	mailRules: {
		type: DataTypes.VIRTUAL,
		get() {
			const pending = this.getDataValue('mailRules');
			if (pending !== undefined) {
				return pending;
			}
			const details = this.mail_rule_details;
			if (!details) {
				return undefined;
			}
			const MailRule = this.sequelize.models.MailRule;
			return [...details].sort(MailRule.inListOrder).map((rule) => rule.tag);
		},
		validate: {
			async isFromMasterList(tags) {
				if (tags === undefined || tags === null) {
					return;
				}
				const Prison = this.sequelize.models.Prison;
				const held = this.id ? await Prison.ruleIdsOf(this.id) : [];
				await this.sequelize.models.MailRule.resolve(tags, held);
			}
		}
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
	/** ISO 639-1 tags mail must be written in; null or empty for no restriction. */
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

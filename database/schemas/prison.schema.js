import { DataTypes } from 'sequelize';
import { recordStatusAttribute } from '#db/record-status.js';
import { ROUTING_METHODS } from '#db/validators.js';
import { limitValidator, mailLanguagesValidator } from '#db/mail-rules.js';

const prisonSchema = {
	prisonName: {
		type: DataTypes.STRING,
		allowNull: false
	},
	/**
	 * Free-form JSON: `street`, `city`, `postalCode` for search and display, and
	 * optionally `lines`, the exact lines to print on an envelope in the order the
	 * facility (or its support group) says to write them, which differs by country.
	 */
	address: {
		type: DataTypes.JSON,
		allowNull: false,
		validate: {
			isAddress(value) {
				if (typeof value !== 'object' || value === null || Array.isArray(value)) {
					throw new Error('address must be an object.');
				}
				if (value.lines !== undefined) {
					const ok =
						Array.isArray(value.lines) &&
						value.lines.length >= 1 &&
						value.lines.length <= 8 &&
						value.lines.every((line) => typeof line === 'string' && line.trim() !== '');
					if (!ok) {
						throw new Error('address.lines must be 1 to 8 non-empty strings, the lines to print.');
					}
				}
			}
		}
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

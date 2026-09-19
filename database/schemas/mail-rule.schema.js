import { DataTypes } from 'sequelize';
import { MAIL_RULE_CATEGORIES } from '#db/mail-rules.js';

/** lower_snake_case, starting with a letter: `no_polaroids`, `page_2_only`. */
export const MAIL_RULE_TAG = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

/**
 * One entry of the master list of mail rules. Facilities link to entries;
 * they never carry rule text of their own. `tag` is what clients key
 * translations and icons on, so it never changes once created.
 */
const mailRuleSchema = {
	tag: {
		type: DataTypes.STRING,
		allowNull: false,
		unique: true,
		validate: {
			is: {
				args: MAIL_RULE_TAG,
				msg: 'tag must be lower_snake_case letters and digits, starting with a letter.'
			},
			len: { args: [3, 40], msg: 'tag must be 3 to 40 characters.' }
		}
	},
	category: {
		type: DataTypes.STRING,
		allowNull: false,
		validate: {
			isIn: {
				args: [MAIL_RULE_CATEGORIES],
				msg: 'category must be one of ' + MAIL_RULE_CATEGORIES.join(', ') + '.'
			}
		}
	},
	/** Default English wording; clients may replace it with their own, keyed on `tag`. */
	label: {
		type: DataTypes.STRING,
		allowNull: false,
		validate: {
			len: { args: [3, 80], msg: 'label must be 3 to 80 characters.' }
		}
	},
	description: {
		type: DataTypes.TEXT
	},
	/** Set when the rule is withdrawn from use: facilities that have it keep it, nobody can add it. */
	retiredAt: {
		type: DataTypes.DATE
	},
	createdBy: {
		type: DataTypes.INTEGER
	}
};

export default mailRuleSchema;

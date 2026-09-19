/**
 * What the code knows about mail rules. The master list itself is data: the
 * MailRules table, which admins extend (database/models/mail-rule.model.js).
 * A facility links to entries of that list and has three typed limits
 * beside them (pageLimit, photoLimit, mailLanguages).
 *
 * Here: the categories a rule may belong to and the order pages show them
 * in, the pairs of rules that contradict each other, the description of the
 * typed limits for clients, and the validators for those limits.
 */

/** Display groups, in the order a facility page lists them. */
export const MAIL_RULE_CATEGORIES = [
	'addressing',
	'paper_and_ink',
	'content',
	'photos',
	'enclosures',
	'publications',
	'senders',
	'handling'
];

/** Pairs of rule tags that cannot both hold for one facility. */
export const MAIL_RULE_CONFLICTS = [['typed_letters_allowed', 'handwritten_only']];

/** The typed limits that sit beside the tags, described for clients. */
export const MAIL_RULE_PARAMETERS = {
	pageLimit: {
		type: 'integer',
		minimum: 1,
		label: 'Page limit',
		description: 'Letters over this many single-sided pages are returned. Null means no limit.'
	},
	photoLimit: {
		type: 'integer',
		minimum: 1,
		label: 'Photo limit',
		description:
			'The most loose photographs one envelope may hold. Null means no stated limit; a facility that takes none has the no_photos tag instead.'
	},
	mailLanguages: {
		type: 'array',
		items: 'ISO 639-1 language tag, lower case',
		label: 'Accepted languages',
		description:
			'Mail must be written in one of these languages. Null or empty means no restriction.'
	}
};

/** Sequelize validator for Prison.mailLanguages. */
export const mailLanguagesValidator = {
	isLanguageList(value) {
		if (value === null || value === undefined) {
			return;
		}
		const ok =
			Array.isArray(value) &&
			value.every((tag) => typeof tag === 'string' && /^[a-z]{2}$/.test(tag));
		if (!ok) {
			throw new Error(
				'mailLanguages must be an array of two-letter ISO 639-1 tags in lower case, for example ["en", "es"].'
			);
		}
		if (new Set(value).size !== value.length) {
			throw new Error('mailLanguages lists a language more than once.');
		}
	}
};

/** A whole number of at least `minimum`, or null. */
export function limitValidator(field, minimum = 1) {
	return {
		isLimit(value) {
			if (value === null || value === undefined) {
				return;
			}
			if (!Number.isInteger(value) || value < minimum) {
				throw new Error(field + ' must be a whole number of at least ' + minimum + ', or null.');
			}
		}
	};
}

/**
 * Shared value lists and Sequelize validators for the directory fields.
 */

/** How mail reaches a facility. */
export const ROUTING_METHODS = ['direct', 'scan_only', 'direct_and_scan', 'relay_only'];

/** What a support group offers; stored on Chapter.services as an array. */
export const CHAPTER_SERVICES = [
	'letter_collection',
	'letter_writing_nights',
	'domestic_mailing',
	'international_mailing',
	'international_relay',
	'translation_assistance',
	'legal_support',
	'book_programs'
];

/**
 * A group's part in the mail flow: `collecting` groups gather letters and
 * forward them to relay partners; `relay` groups print and mail; `both` do
 * both.
 */
export const NETWORK_ROLES = ['collecting', 'relay', 'both'];

/** Network membership of a group; only `active` groups may act. */
export const ACCOUNT_STATUSES = ['pending', 'active', 'suspended'];

/** Keys accepted in Chapter.socialLinks. */
export const SOCIAL_LINK_KEYS = ['instagram', 'mastodon', 'bluesky', 'x', 'youtube'];

/**
 * Validator: a JSON column must hold an array of non-empty strings.
 * @param {string} label used in the error message
 */
export function arrayOfStrings(label) {
	return {
		isArrayOfStrings(value) {
			if (value === null || value === undefined) {
				return;
			}
			if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || v.trim() === '')) {
				throw new Error(label + ' must be an array of non-empty strings.');
			}
		}
	};
}

/**
 * Validator: a JSON column must hold an array whose members are all in `allowed`.
 * @param {string} label
 * @param {string[]} allowed
 */
export function arrayFrom(label, allowed) {
	return {
		isArrayFromList(value) {
			if (value === null || value === undefined) {
				return;
			}
			if (!Array.isArray(value) || value.some((v) => !allowed.includes(v))) {
				throw new Error(label + ' must be an array of: ' + allowed.join(', ') + '.');
			}
		}
	};
}

/**
 * Validator: a JSON column must hold an object whose keys are in `allowedKeys`
 * and whose values are strings (empty strings are allowed and mean "unset").
 * @param {string} label
 * @param {string[]} allowedKeys
 */
export function objectOfStrings(label, allowedKeys) {
	return {
		isObjectOfStrings(value) {
			if (value === null || value === undefined) {
				return;
			}
			const isObject = typeof value === 'object' && !Array.isArray(value);
			const ok =
				isObject &&
				Object.entries(value).every(
					([k, v]) => allowedKeys.includes(k) && (typeof v === 'string' || v === null)
				);
			if (!ok) {
				throw new Error(
					label + ' must be an object with string values for: ' + allowedKeys.join(', ') + '.'
				);
			}
		}
	};
}

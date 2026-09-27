/**
 * Stable codes for refusals, so that clients can word them in their own
 * languages (README, "Error codes").
 *
 * The API answers in English and always will: `errors` keeps the sentence a
 * person can read, and `problems` says the same thing in a form a client can
 * translate — a field, a code, and the numbers to interpolate. Clients own
 * their strings; nothing here is ever translated on the server, because three
 * clients in three languages would otherwise wait on a deploy for every
 * wording fix.
 *
 * **A code is a contract.** Once a client ships a translation keyed on one,
 * renaming it breaks that build. Codes are therefore coarse: "a length is out
 * of range" rather than "a pen name is too long", with the field and the limits
 * beside it, so a client writes one sentence per code and gets sensible text
 * for a field nobody thought about. `docs/ERRORS.md` is generated from this
 * file, and a test fails on a code the catalogue has never heard of.
 *
 * `params` carries limits and names only, never what the caller sent: a
 * password or a letter's text must not come back in an error body and land in
 * somebody's logs. A limit that does not apply is left out rather than sent as
 * null, and `allowed` holds the API's own values (`collecting`, `incarcerated`)
 * rather than English words, because clients label those themselves.
 */

/**
 * @typedef {object} CodeEntry
 * @property {string} meaning what went wrong, for the catalogue
 * @property {string[]} params which params come with it, in order
 */

/** Every code the API may answer with. @type {Record<string, CodeEntry>} */
export const CODES = {
	validation_failed: {
		meaning:
			'Something about the request is wrong and has no more specific code yet. Show the sentence from `errors`.',
		params: []
	},
	required: {
		meaning: 'A field the request cannot do without is missing or empty.',
		params: []
	},
	length_out_of_range: {
		meaning: 'Text is shorter or longer than the field allows.',
		params: ['min', 'max']
	},
	out_of_range: {
		meaning: 'A number is outside the range the field allows.',
		params: ['min', 'max']
	},
	not_a_number: {
		meaning: 'A number was expected.',
		params: []
	},
	not_a_date: {
		meaning: 'A date was expected, in ISO-8601.',
		params: []
	},
	not_a_url: {
		meaning: 'A URL was expected.',
		params: []
	},
	not_an_email: {
		meaning: 'An email address was expected.',
		params: []
	},
	not_allowed_value: {
		meaning: 'The value is not one of the ones this field takes.',
		params: ['allowed']
	},
	not_unique: {
		meaning: 'Something with this value already exists, and the field has to be unique.',
		params: ['fields']
	},
	wrong_type: {
		meaning: 'The value is of the wrong kind altogether (text where a list belongs, and so on).',
		params: ['expected']
	},
	reserved_value: {
		meaning:
			'The value is one the API keeps for itself (a username shape the groups use, a placeholder email address).',
		params: []
	},
	not_eligible: {
		meaning:
			'The record named exists, but cannot be used for this: a letter that was not returned, an account that cannot be claimed.',
		params: []
	},
	not_settable_here: {
		meaning:
			"The field is real but not this endpoint's to write; the message says where it belongs.",
		params: []
	},
	already_set: {
		meaning: 'The field can be set once and already has a value.',
		params: []
	},
	wrong_encryption_mode: {
		meaning:
			'The request is in the wrong shape for the mode the server runs in: plaintext to an end-to-end server, or ciphertext to one holding the keys. `GET /health` says which mode it is. A client bug, not something the person can fix.',
		params: []
	},
	not_an_auth_key: {
		meaning:
			'A split account sends a derived auth key where a password would go, and this is not one. A client bug, never something the person can fix: do not show it under the password box.',
		params: []
	},
	unknown_reference: {
		meaning: 'The request names a record that does not exist.',
		params: []
	}
};

/** Sequelize's validator names, mapped to codes. */
const VALIDATOR_CODES = {
	notNull: 'required',
	is_null: 'required',
	notEmpty: 'required',
	len: 'length_out_of_range',
	min: 'out_of_range',
	max: 'out_of_range',
	isInt: 'not_a_number',
	isFloat: 'not_a_number',
	isNumeric: 'not_a_number',
	isDate: 'not_a_date',
	isUrl: 'not_a_url',
	isEmail: 'not_an_email',
	isIn: 'not_allowed_value',
	not_unique: 'not_unique'
};

/** Is this a code the catalogue knows? */
export function isKnownCode(code) {
	return Object.hasOwn(CODES, code);
}

/**
 * The code for a Sequelize validation item. Anything the map has never heard
 * of — every custom validator in `database/validators.js`, for instance — is
 * `validation_failed`, whose sentence in `errors` is the one to show.
 */
export function codeForValidator(item) {
	if (!item) {
		return 'validation_failed';
	}
	if (item.type === 'notNull Violation') {
		return 'required';
	}
	if (item.type === 'unique violation') {
		return 'not_unique';
	}
	const named = VALIDATOR_CODES[item.validatorKey] ?? VALIDATOR_CODES[item.validatorName];
	return named ?? 'validation_failed';
}

/**
 * The params of a Sequelize validation item: the limits it was checked
 * against, never the value it was given.
 * @returns {object|undefined}
 */
export function paramsForValidator(item) {
	const code = codeForValidator(item);
	// validatorArgs is [[3, 40]] for len and [3, 40] for min/max, depending on
	// how the schema wrote it; only numbers are passed on.
	const flat = (Array.isArray(item?.validatorArgs) ? item.validatorArgs : []).flat();
	const numbers = flat.filter((value) => typeof value === 'number');
	if ((code === 'length_out_of_range' || code === 'out_of_range') && numbers.length > 0) {
		// A limit that does not apply is left out rather than sent as null.
		return numbers.length > 1 ? { min: numbers[0], max: numbers[1] } : { max: numbers[0] };
	}
	if (code === 'not_allowed_value') {
		const allowed = flat.filter((value) => typeof value === 'string');
		return allowed.length > 0 ? { allowed } : undefined;
	}
	return undefined;
}

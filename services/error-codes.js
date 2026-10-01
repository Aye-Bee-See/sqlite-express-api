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
	if (code === 'not_unique' && item?.path) {
		// Which field clashed, as the catalogue promises. A composite unique index
		// would give several items, one per column, and each says its own.
		return { fields: [item.path] };
	}
	if (code === 'not_allowed_value') {
		const allowed = flat.filter((value) => typeof value === 'string');
		return allowed.length > 0 ? { allowed } : undefined;
	}
	return undefined;
}

/**
 * The refusals that are not about a field: a 403, 404, 409, 410 or 422 where
 * the request was well formed and the answer is still no.
 *
 * These have carried `name` (`InviteCodeError`) and often `condition` (`used`)
 * for a while, and both clients word them from that pair today. `code` is the
 * same thing as one key, in the same namespace as the codes above, composed by
 * one rule:
 *
 *     code = family + ('.' + condition, when the refusal has one)
 *
 * where `family` is the error's name in snake_case with `Error` dropped:
 * `InviteCodeError` + `used` is `invite_code.used`, `NotFoundError` alone is
 * `not_found`, `AccountDeleteError` + `group_owner` is
 * `account_delete.group_owner`. A client may match the whole code or just the
 * family before the dot, which is why the family is the stable part: a refusal
 * may grow a finer `condition` later, and an older build that matched the
 * family keeps working.
 *
 * **`name` and `condition` are still sent, and will be.** `code` is an
 * addition, not a replacement, and neither will be removed in the release that
 * introduces it (asked for by both clients, 27 September 2026).
 */
export const REFUSAL_FAMILIES = {
	account_delete: 'An account cannot be deleted yet; the condition says what stands in the way.',
	auth_scheme: "A sign-in scheme that cannot be used here, or a split account's fields missing.",
	authentication: 'Not signed in, or a token that is no longer good.',
	authorization: 'Signed in, and not allowed to do this.',
	ban_recommendation: 'A recommendation to ban that is already waiting, or already decided.',
	claim: 'A managed writer that cannot be claimed.',
	claim_token: 'A claim code that is unknown, expired, or already used.',
	duplicate_rule: 'A mail rule that already exists, or reads like one that does.',
	encryption_key: 'A letter the server can no longer open with the key it has.',
	encryption_mode: 'The request does not match the mode the server runs in.',
	envelope: 'A letter key sealed to the wrong reader, or one that is missing.',
	group_block: 'The group that would mail this letter has blocked its writer.',
	http: 'A refusal with no finer family of its own.',
	idempotency: 'An Idempotency-Key that is in flight, reused, or whose letter is gone.',
	invitation: 'An invitation that is unknown, expired, revoked, or already accepted.',
	invite_code: 'An invite code that is unknown, expired, cancelled, or used.',
	invite_quota: "A group's unused invite codes are at their limit.",
	key_change: 'A key that may not be set or replaced in the way asked.',
	key_version: 'Sealed to a group key that is no longer current; re-seal and send again.',
	letter_held: 'A letter held because the person was moved or freed.',
	letter_status: 'A status move that is not allowed, or that somebody else made first.',
	not_found: 'No such record, or none this caller may see.',
	reference:
		'A record this request points at does not exist, or one it would remove is still pointed at by something else. SQLite does not say which column or which direction, so the message says both.',
	owner: "Only a group's owner-admin may do this.",
	pen_name_limit: 'A pen name change refused by the cooldown or the yearly count.',
	rate_limit: 'Too many requests; Retry-After says when to come back.',
	request_body:
		'The body could not be read at all: not JSON, too large, or in an encoding the server does not take.',
	recovery: 'A recovery code or challenge that does not fit.',
	reply_reference: 'A reply reference that fails its checksum or is unknown.',
	rotation_incomplete: 'A group key rotation that did not carry everything it must.',
	rule_in_use: 'A mail rule a facility still carries; retire it instead.',
	rule_tag: 'A mail rule tag that cannot change, or is not the shape of one.',
	submission_changed: 'The proposal was revised while it was being reviewed.',
	submission_state: 'A proposal that is not in a state this decision fits.',
	two_factor_required:
		'This account must use two-factor sign-in and has not set it up: only setting it up, and signing out, work until it has.',
	two_factor:
		'Two-factor sign-in is not in the state the request needs: on already, not on, or changed meanwhile.',
	validation: 'Input that fails a rule; these also carry `problems` (above).'
};

/**
 * A message safe and useful to send to a client. SQLite's own words for a
 * foreign-key violation ("SQLITE_CONSTRAINT: FOREIGN KEY constraint failed")
 * tell a client nothing and leak the storage engine, so they are replaced.
 */
export function clientMessageFor(err) {
	if (err && err.name === 'SequelizeForeignKeyConstraintError') {
		return 'A record this request points at does not exist, or one it would remove is still in use.';
	}
	return err && err.message;
}

/** The family of an error name: `InviteCodeError` is `invite_code`. */
export function familyOf(name) {
	return String(name ?? 'Error')
		.replace(/Error$/, '')
		.replace(/([a-z0-9])([A-Z])/g, '$1_$2')
		.toLowerCase();
}

/**
 * Sequelize's own error names, mapped to families, for the ones that reach a
 * client as a refusal rather than as a validation failure. A foreign-key
 * violation is the case: it means either an id that names nothing or a record
 * something else still points at, and on SQLite there is no way to tell which.
 */
const SEQUELIZE_FAMILIES = {
	SequelizeForeignKeyConstraintError: 'reference'
};

/**
 * What Express's body parser says went wrong (`err.type`), as a condition of
 * `request_body`. Before these had a family they answered `code: "http"` and
 * logged an unknown family on every malformed request.
 */
const BODY_PARSER_CONDITIONS = {
	'entity.parse.failed': 'not_json',
	'entity.too.large': 'too_large',
	'encoding.unsupported': 'unsupported_encoding',
	'charset.unsupported': 'unsupported_charset',
	'entity.verify.failed': 'unreadable',
	'request.aborted': 'unreadable',
	'request.size.invalid': 'unreadable',
	'stream.encoding.set': 'unreadable',
	'stream.not.readable': 'unreadable',
	'parameters.too.many': 'too_many_parameters'
};

/**
 * The condition a refusal is sent with, for a body the parser could not read,
 * or null when it is not one.
 */
export function bodyParserCondition(err) {
	return (
		(err &&
			Object.hasOwn(BODY_PARSER_CONDITIONS, String(err.type)) &&
			BODY_PARSER_CONDITIONS[err.type]) ||
		null
	);
}

/** Is this a family the catalogue knows? */
export function isKnownFamily(family) {
	return Object.hasOwn(REFUSAL_FAMILIES, family);
}

/**
 * The `code` for a refusal that is not about a field.
 * @param {{name?: string, condition?: string, type?: string}} err
 * @returns {string}
 */
export function codeForRefusal(err) {
	const family = bodyParserCondition(err)
		? 'request_body'
		: (SEQUELIZE_FAMILIES[err && err.name] ?? familyOf(err && err.name));
	const known = isKnownFamily(family) ? family : 'http';
	if (!isKnownFamily(family)) {
		// A new error name would ship a code nobody can look up; the test that reads
		// the source catches it, and this keeps the answer honest in the meantime.
		console.error('[errors] unknown refusal family "' + family + '"; add it to error-codes.js');
	}
	const condition =
		bodyParserCondition(err) ?? (err && typeof err.condition === 'string' ? err.condition : null);
	return condition && condition !== 'par' ? known + '.' + condition : known;
}

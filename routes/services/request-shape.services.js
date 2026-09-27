import ValidationError from '#services/ValidationError.js';

/**
 * Names that carry one record's id, in a query string or a JSON body.
 * (`ids` and other lists have their own names and their own checks.)
 */
const ID_FIELDS = [
	'id',
	'user',
	'prisoner',
	'prison',
	'chat',
	'message',
	'chapter',
	'chapterId',
	'relayChapter',
	'managedBy',
	'target',
	'rule',
	'submission'
];

const isList = (value) => value !== null && typeof value === 'object';

/**
 * One id is one value. `?id=1&id=2`, or `{ "id": [1, 2] }`, would reach
 * Sequelize as `WHERE id IN (1, 2)`: an update or a delete of many rows
 * behind a permission check that looked at one, with an audit entry that
 * names none.
 */
export function singleIds(req, res, next) {
	const errors = [];
	for (const source of [req.query, req.body]) {
		if (!source || typeof source !== 'object') {
			continue;
		}
		for (const field of ID_FIELDS) {
			if (Object.hasOwn(source, field) && isList(source[field])) {
				if (!errors.some((e) => e.field === field)) {
					errors.push({
						message: field + ' must be a single value.',
						field,
						code: 'wrong_type',
						params: { expected: 'a single value' }
					});
				}
			}
		}
	}
	return errors.length > 0 ? next(new ValidationError(errors)) : next();
}

/**
 * Middleware: these fields, where given, are text. A per-username limit counts
 * a username that is text; one sent as a list (`?username=a&username=a`, or
 * `["a"]`) was not counted, and the lookup still found the account with
 * `IN ('a')`, so recovery could be guessed without limit. An object reached the
 * database as an operator and answered 500. Put this before the limiter.
 * @param {'query'|'body'} source
 * @param {...string} fields
 */
export function textFields(source, ...fields) {
	return function requireText(req, res, next) {
		const values = req[source] || {};
		const wrong = fields.filter(
			(field) => Object.hasOwn(values, field) && typeof values[field] !== 'string'
		);
		if (wrong.length === 0) {
			return next();
		}
		return next(
			new ValidationError(
				wrong.map((field) => ({
					message: field + ' must be text.',
					field,
					code: 'wrong_type',
					params: { expected: 'text' }
				}))
			)
		);
	};
}

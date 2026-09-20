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
				errors.push(field + ' must be a single value.');
			}
		}
	}
	return errors.length > 0 ? next(new ValidationError([...new Set(errors)])) : next();
}

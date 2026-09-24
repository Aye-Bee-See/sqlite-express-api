import { Op, fn, col } from 'sequelize';
import AuthzService from '#rtServices/authz.services.js';
import ValidationError from '#services/ValidationError.js';
import { RECORD_STATUSES } from '#db/record-status.js';

/**
 * Sort orders every directory list understands, in addition to whatever a
 * resource adds (usually `name`).
 */
export const SORT_BY_CREATED = {
	newest: [
		['createdAt', 'DESC'],
		['id', 'DESC']
	],
	oldest: [
		['createdAt', 'ASC'],
		['id', 'ASC']
	]
};

/**
 * Turn a list request into model read options for the public directory
 * controllers (prison, prisoner, rule, chapter).
 *
 * Query parameters handled here:
 * - recordStatus: staff only; anonymous and user-role callers always get
 *   published records and the parameter is ignored for them.
 * - q: case-insensitive substring match across `searchFields`.
 * - sort: one of the keys in `sorts`; default is ascending id.
 * - any key of `filters`: an exact-match column filter, optionally limited
 *   to an allowed list of values (`allowed`), converted (`transform`), or
 *   turned into an arbitrary where fragment (`build`).
 *
 * @param {object} req
 * @param {{searchFields?: string[], sorts?: object, filters?: object}} [config]
 * @returns {{publishedOnly: boolean, where: object, order: Array}}
 * @throws {ValidationError} listing every bad parameter at once
 */
/**
 * The distinct values of a few columns, with how many records carry each, for
 * the filter chips on a list page. Only records the caller could list are
 * counted; nulls are left out.
 * @param {import('sequelize').ModelStatic} model
 * @param {string[]} fields
 * @param {object} where visibility, as readOptions builds it
 * @returns {Promise<Record<string, {value: string, count: number}[]>>}
 */
export async function filterValues(model, fields, where) {
	const out = {};
	for (const field of fields) {
		const rows = await model.findAll({
			attributes: [field, [fn('COUNT', col('id')), 'count']],
			where: { ...where, [field]: { [Op.ne]: null } },
			group: [field],
			raw: true
		});
		out[field] = rows
			.map((row) => ({ value: row[field], count: Number(row.count) }))
			.sort((a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value)));
	}
	return out;
}

export function readOptions(req, { searchFields = [], sorts = {}, filters = {} } = {}) {
	const publishedOnly = AuthzService.publishedOnly(req);
	const { recordStatus, q, sort } = req.query;
	const where = {};
	const errors = [];

	if (!publishedOnly && recordStatus !== undefined && recordStatus !== '') {
		if (RECORD_STATUSES.includes(recordStatus)) {
			where.recordStatus = recordStatus;
		} else {
			errors.push('recordStatus must be one of ' + RECORD_STATUSES.join(', ') + '.');
		}
	}

	const term = typeof q === 'string' ? q.trim() : '';
	if (term && searchFields.length > 0) {
		where[Op.or] = searchFields.map((field) => ({ [field]: { [Op.like]: '%' + term + '%' } }));
	}

	const fragments = [];
	for (const [param, spec] of Object.entries(filters)) {
		const value = req.query[param];
		if (value === undefined || value === '') {
			continue;
		}
		if (spec.allowed && !spec.allowed.includes(value)) {
			errors.push(param + ' must be one of ' + spec.allowed.join(', ') + '.');
		} else if (spec.build) {
			// Built fragments may use Op.or themselves; keep them apart from the
			// q search (which owns the top-level Op.or) by AND-ing them.
			// A builder may refuse a value it cannot use; report it with the rest.
			try {
				fragments.push(spec.build(value));
			} catch (err) {
				if (!(err instanceof ValidationError)) {
					throw err;
				}
				errors.push(err.message);
			}
		} else {
			where[spec.column || param] = spec.transform ? spec.transform(value) : value;
		}
	}

	if (fragments.length > 0) {
		where[Op.and] = fragments;
	}

	let order = [['id', 'ASC']];
	if (sort !== undefined && sort !== '') {
		if (typeof sort === 'string' && Object.hasOwn(sorts, sort)) {
			order = sorts[sort];
		} else {
			errors.push('sort must be one of ' + Object.keys(sorts).join(', ') + '.');
		}
	}

	if (errors.length > 0) {
		throw new ValidationError(errors);
	}
	return { publishedOnly, where, order };
}

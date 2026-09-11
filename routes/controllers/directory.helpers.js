import AuthzService from '#rtServices/authz.services.js';
import ValidationError from '#services/ValidationError.js';
import { RECORD_STATUSES } from '#db/record-status.js';

/**
 * Shared read options for the public directory controllers (prison,
 * prisoner, rule, chapter).
 *
 * - Anonymous callers and the user role only ever see published records.
 * - Staff (admin, chapter) see everything and may filter with
 *   ?recordStatus=draft|pending|published.
 *
 * @param {object} req
 * @returns {{publishedOnly: boolean, where: object}}
 * @throws {ValidationError} for an unknown recordStatus value
 */
export function readOptions(req) {
	const publishedOnly = AuthzService.publishedOnly(req);
	const { recordStatus } = req.query;
	if (publishedOnly || recordStatus === undefined || recordStatus === '') {
		return { publishedOnly, where: {} };
	}
	if (!RECORD_STATUSES.includes(recordStatus)) {
		throw new ValidationError('recordStatus must be one of ' + RECORD_STATUSES.join(', ') + '.');
	}
	return { publishedOnly, where: { recordStatus } };
}

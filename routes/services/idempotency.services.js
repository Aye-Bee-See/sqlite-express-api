import { createHash } from 'node:crypto';
import IdempotencyKey from '#models/idempotency-key.model.js';
import { IDEMPOTENCY_KEY } from '#schemas/idempotency-key.schema.js';
import ValidationError from '#services/ValidationError.js';
import { HttpError } from '#services/HttpError.js';

/**
 * `Idempotency-Key` on a write: send the same key with a retry and get what
 * the first attempt made, not a second one. For a letter that is the
 * difference between one envelope in a prisoner's hands and two.
 *
 * The key belongs to the caller and to one kind of write. The server keeps
 * a pointer to what was created, never a copy of the request or response,
 * so no letter text ends up in this table. A key is remembered only for an
 * attempt that made something: a refused or failed attempt frees it, and
 * the client may correct the request and send it again under the same key.
 */

function fingerprintOf(parts) {
	return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

/**
 * @param {object} req
 * @param {object} res gets `Retry-After` when the first attempt is still running
 * @param {'message'|'attachment'} scope
 * @param {Array} parts what must be the same on a retry (ids and the like; hashed, not stored)
 * @returns {Promise<null | {replay: number|null} | {complete: Function, release: Function}>}
 *   null: no key was sent. `replay`: the id of what the first attempt made.
 *   Otherwise the caller goes ahead and reports back with complete(id) or release().
 * @throws {ValidationError} malformed key; {HttpError} 409 in flight, 422 reused for something else
 */
export async function begin(req, res, scope, parts) {
	const key = req.get('Idempotency-Key');
	if (key === undefined) {
		return null;
	}
	if (!IDEMPOTENCY_KEY.test(key)) {
		throw new ValidationError(
			'Idempotency-Key must be 8 to 128 printable characters without spaces; a UUID is ideal.'
		);
	}
	const fingerprint = fingerprintOf(parts);
	const { row, claimed } = await IdempotencyKey.claim({
		userId: req.user.id,
		scope,
		key,
		fingerprint
	});
	if (claimed) {
		return {
			complete: (resourceId) => IdempotencyKey.complete(row.id, resourceId),
			release: () => IdempotencyKey.release(row.id)
		};
	}
	if (row.fingerprint !== fingerprint) {
		throw new HttpError(
			422,
			'This Idempotency-Key was already used for a different request. Use a new key for each new letter.',
			'IdempotencyError'
		);
	}
	if (row.state !== 'done') {
		res.set('Retry-After', '1');
		throw new HttpError(
			409,
			'The first request with this Idempotency-Key is still being processed; try again shortly.',
			'IdempotencyError'
		);
	}
	return { replay: row.resourceId };
}

/** Mark a response as a repeat, so a client (and its logs) can tell. */
export function markReplayed(res) {
	res.set('Idempotent-Replayed', 'true');
}

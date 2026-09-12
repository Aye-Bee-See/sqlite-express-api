import AuditLog from '#models/audit-log.model.js';

/**
 * Record a staff or moderation action from a request context. Never throws:
 * the action it describes has already been committed.
 * @param {object|null} req the request (its user becomes the actor), or null for system/public actions
 * @param {string} action dotted verb, e.g. 'prisoner.update'
 * @param {string} resource
 * @param {number|string|null} targetId
 * @param {object|null} [details]
 */
export async function audit(req, action, resource, targetId, details = null) {
	try {
		return await AuditLog.record({
			actor: req && req.user ? req.user.id : null,
			action,
			resource,
			targetId,
			details
		});
	} catch (err) {
		// The domain write has already happened. Reporting a failure now would
		// mislead the client into retrying (and duplicating) it; log loudly
		// instead so the gap is visible to operators.
		console.error('[audit] failed to record ' + action + ' on ' + resource + ' ' + targetId, err);
		return null;
	}
}

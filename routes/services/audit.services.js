import AuditLog from '#models/audit-log.model.js';

/**
 * Record a staff or moderation action from a request context.
 * @param {object|null} req the request (its user becomes the actor), or null for system/public actions
 * @param {string} action dotted verb, e.g. 'prisoner.update'
 * @param {string} resource
 * @param {number|string|null} targetId
 * @param {object|null} [details]
 */
export async function audit(req, action, resource, targetId, details = null) {
	return await AuditLog.record({
		actor: req && req.user ? req.user.id : null,
		action,
		resource,
		targetId,
		details
	});
}

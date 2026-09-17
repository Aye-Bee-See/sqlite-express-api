import { HttpError } from '#services/HttpError.js';
import { rateLimits } from '#constants';

/**
 * Small in-memory rate limiter for the unauthenticated endpoints (login,
 * claim check, recovery). One API process, one table: enough for a single
 * server, and a restart simply forgets the counts. Every number comes from
 * the environment (see constants.js and .env.example); RATE_LIMIT_ENABLED=false
 * turns the whole thing off.
 *
 * A limited request gets 429 with a Retry-After header and the usual
 * error shape ({ success: false, name: 'RateLimitError', info, status }).
 */

const buckets = new Map(); // key -> { count, resetAt }
const MAX_KEYS = 50_000;

function take(key, windowMs, now) {
	let bucket = buckets.get(key);
	if (!bucket || bucket.resetAt <= now) {
		bucket = { count: 0, resetAt: now + windowMs };
		buckets.set(key, bucket);
	}
	return bucket;
}

/** Forget expired buckets; also a hard cap so a flood of keys cannot grow the table forever. */
export function sweep(now = Date.now()) {
	for (const [key, bucket] of buckets) {
		if (bucket.resetAt <= now) {
			buckets.delete(key);
		}
	}
	if (buckets.size > MAX_KEYS) {
		buckets.clear();
	}
}

setInterval(() => sweep(), 60 * 1000).unref();

/** Test hook: start from a clean table. */
export function reset() {
	buckets.clear();
}

function refuse(res, next, bucket, now, what) {
	const seconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
	res.set('Retry-After', String(seconds));
	return next(
		new HttpError(
			429,
			'Too many ' + what + '. Try again in ' + Math.ceil(seconds / 60) + ' minute(s).',
			'RateLimitError'
		)
	);
}

const clientIp = (req) => req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';

/**
 * Build a limiter middleware.
 * @param {object} options
 * @param {string} options.name bucket namespace, e.g. 'login'
 * @param {string} options.what words for the message, e.g. 'sign-in attempts'
 * @param {number} options.windowMs
 * @param {number|null} [options.perIp] requests per window per client address
 * @param {number|null} [options.perSubject] requests per window per subject (username, token, ...)
 * @param {(req: object) => string|undefined} [options.subject] extracts the subject
 * @param {boolean} [options.failuresOnly] count a subject's request only when the response is 4xx
 */
export function limit({
	name,
	what,
	windowMs,
	perIp = null,
	perSubject = null,
	subject,
	failuresOnly = false
}) {
	return function rateLimiter(req, res, next) {
		if (!rateLimits.enabled) {
			return next();
		}
		const now = Date.now();
		if (perIp) {
			const bucket = take(name + ':ip:' + clientIp(req), windowMs, now);
			if (bucket.count >= perIp) {
				return refuse(res, next, bucket, now, what);
			}
			bucket.count += 1;
		}
		const who = subject ? subject(req) : undefined;
		if (perSubject && typeof who === 'string' && who !== '') {
			const bucket = take(name + ':subject:' + who.trim().toLowerCase(), windowMs, now);
			if (bucket.count >= perSubject) {
				return refuse(res, next, bucket, now, what);
			}
			if (failuresOnly) {
				res.on('finish', () => {
					if (res.statusCode >= 400 && res.statusCode < 500) {
						bucket.count += 1;
					}
				});
			} else {
				bucket.count += 1;
			}
		}
		return next();
	};
}

const minutes = (n) => n * 60 * 1000;

/** The limiters the routes use, built from configuration. */
export const limiters = {
	login: limit({
		name: 'login',
		what: 'sign-in attempts',
		windowMs: minutes(rateLimits.loginWindowMinutes),
		perIp: rateLimits.loginPerIp,
		perSubject: rateLimits.loginFailuresPerUser,
		subject: (req) => req.body && req.body.username,
		failuresOnly: true
	}),
	claimCheck: limit({
		name: 'claim',
		what: 'claim token checks',
		windowMs: minutes(rateLimits.claimWindowMinutes),
		perIp: rateLimits.claimPerIp
	}),
	recoverStart: limit({
		name: 'recover-start',
		what: 'recovery requests',
		windowMs: minutes(rateLimits.recoverWindowMinutes),
		perIp: rateLimits.recoverStartPerIp,
		perSubject: rateLimits.recoverStartPerUser,
		subject: (req) => req.query && req.query.username
	}),
	recoverFinish: limit({
		name: 'recover-finish',
		what: 'recovery attempts',
		windowMs: minutes(rateLimits.recoverWindowMinutes),
		perSubject: rateLimits.recoverFinishPerUser,
		subject: (req) => req.body && req.body.username
	})
};

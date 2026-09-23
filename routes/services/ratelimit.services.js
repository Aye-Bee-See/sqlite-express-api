import { HttpError } from '#services/HttpError.js';
import { rateLimits } from '#constants';
import ValidationError from '#services/ValidationError.js';

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
const MAX_SUBJECT_LENGTH = 128;

function take(key, windowMs, now) {
	let bucket = buckets.get(key);
	if (!bucket || bucket.resetAt <= now) {
		bucket = { count: 0, resetAt: now + windowMs };
		buckets.delete(key);
		buckets.set(key, bucket);
		if (buckets.size > MAX_KEYS) {
			// Full: the oldest bucket makes room. Never the whole table, or a flood
			// of made-up usernames would wipe the counts that protect real ones.
			buckets.delete(buckets.keys().next().value);
		}
	}
	return bucket;
}

/** Forget expired buckets. (The hard cap on the table's size is kept in take().) */
export function sweep(now = Date.now()) {
	for (const [key, bucket] of buckets) {
		if (bucket.resetAt <= now) {
			buckets.delete(key);
		}
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
 * @param {boolean} [options.failuresOnly] a subject's request stops counting once it is answered with anything but a 4xx
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
			const key = name + ':subject:' + who.trim().toLowerCase().slice(0, MAX_SUBJECT_LENGTH);
			const bucket = take(key, windowMs, now);
			if (bucket.count >= perSubject) {
				return refuse(res, next, bucket, now, what);
			}
			// Counted now, so a burst of parallel guesses cannot all slip under
			// the limit before the first one is answered; given back on success.
			bucket.count += 1;
			if (failuresOnly) {
				res.on('finish', () => {
					if (res.statusCode < 400 || res.statusCode >= 500) {
						bucket.count = Math.max(0, bucket.count - 1);
					}
				});
			}
		}
		return next();
	};
}

/**
 * Credentials travel in the JSON body as strings, and nowhere else. passport-local
 * also reads the query string, where a password ends up in access logs and
 * where the per-username limit (which reads the body) never sees it.
 */
export function bodyCredentialsOnly(req, res, next) {
	const query = req.query || {};
	if (query.username !== undefined || query.password !== undefined) {
		return next(
			new ValidationError('Send username and password in the JSON body, never in the URL.')
		);
	}
	// A missing field is passport's to refuse (400 AuthenticationError); a number
	// or an object would reach bcrypt and come back as a 500 for real accounts only.
	const given = [req.body?.username, req.body?.password].filter((v) => v !== undefined);
	if (given.some((v) => typeof v !== 'string')) {
		return next(new ValidationError('username and password must be text.'));
	}
	return next();
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
	// Deleting your own account asks for the password again; a stolen token must
	// not turn that into a place to guess it. Counted like failed sign-ins.
	deleteAccount: limit({
		name: 'delete-account',
		what: 'attempts to delete this account',
		windowMs: minutes(rateLimits.loginWindowMinutes),
		perSubject: rateLimits.loginFailuresPerUser,
		// Only where a password is asked for: an admin or a group deleting somebody
		// else is not guessing anything, and must not use up this budget.
		subject: (req) =>
			req.user && req.body && String(req.body.id) === String(req.user.id)
				? 'user-' + req.user.id
				: undefined,
		failuresOnly: true
	}),
	// The salt before sign-in: public, so it shares the sign-in address limit.
	loginParams: limit({
		name: 'login-params',
		what: 'sign-in parameter requests',
		windowMs: minutes(rateLimits.loginWindowMinutes),
		perIp: rateLimits.loginPerIp
	}),
	claimCheck: limit({
		name: 'claim',
		what: 'claim token checks',
		windowMs: minutes(rateLimits.claimWindowMinutes),
		perIp: rateLimits.claimPerIp
	}),
	inviteCheck: limit({
		name: 'invite',
		what: 'invitation token checks',
		windowMs: minutes(rateLimits.inviteWindowMinutes),
		perIp: rateLimits.invitePerIp
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
		perIp: rateLimits.recoverFinishPerIp,
		perSubject: rateLimits.recoverFinishPerUser,
		subject: (req) => req.body && req.body.username
	})
};

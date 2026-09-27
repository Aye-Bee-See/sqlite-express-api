import { HttpError } from '#services/HttpError.js';
import AuthzService from '#rtServices/authz.services.js';
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

/** Signed-in writes are counted per account, whoever and wherever they are. */
const perAccount = (req) => (req.user ? 'user-' + req.user.id : undefined);

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
 * @param {(req: object) => boolean} [options.exempt] requests this says true for are not counted at all
 */
export function limit({
	name,
	what,
	windowMs,
	perIp = null,
	perSubject = null,
	subject,
	failuresOnly = false,
	exempt = null
}) {
	return function rateLimiter(req, res, next) {
		if (!rateLimits.enabled || (exempt && exempt(req))) {
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
			new ValidationError({
				message: 'Send username and password in the JSON body, never in the URL.',
				code: 'not_settable_here'
			})
		);
	}
	// A missing field is passport's to refuse (400 AuthenticationError); a number
	// or an object would reach bcrypt and come back as a 500 for real accounts only.
	const given = [req.body?.username, req.body?.password].filter((v) => v !== undefined);
	if (given.some((v) => typeof v !== 'string')) {
		return next(
			new ValidationError({
				message: 'username and password must be text.',
				code: 'wrong_type',
				params: { expected: 'text' }
			})
		);
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
	// A reply reference opens a thread; a staff account guessing numbers is fishing.
	referenceLookup: limit({
		name: 'referenceLookup',
		what: 'reply reference lookups',
		windowMs: minutes(60),
		perSubject: rateLimits.referencePerUser,
		subject: (req) => (req.user ? String(req.user.id) : undefined)
	}),
	// The pen-name form asks as the person types: per address, generous.
	penNameCheck: limit({
		name: 'penNameCheck',
		what: 'pen name checks',
		windowMs: minutes(15),
		perIp: rateLimits.penNameCheckPerIp
	}),
	// Invite codes are tried against the server and nothing else: limited like claim checks.
	join: limit({
		name: 'join',
		what: 'invite code checks',
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
	}),

	/*
	 * Writes by a signed-in account (see rateLimits in constants.js). Everything
	 * that writes a row nobody else asked for is counted per account, staff
	 * included: the account whose token is worth stealing is the staff one, and
	 * a limit that exempts them protects nothing. Directory writes by an admin
	 * (facilities, prisoners) are not here: that is seeding work, done rarely
	 * and by hand, and a group's directory edits are proposals, which are.
	 */
	sendLetter: limit({
		name: 'letters',
		what: 'letters and replies',
		windowMs: minutes(rateLimits.writeWindowMinutes),
		perSubject: rateLimits.lettersPerUser,
		subject: perAccount
	}),
	// Each one can be 20 MiB on disk, so these are counted more tightly.
	attachment: limit({
		name: 'attachments',
		what: 'attachments',
		windowMs: minutes(rateLimits.writeWindowMinutes),
		perSubject: rateLimits.attachmentsPerUser,
		subject: perAccount
	}),
	// A group filling in the envelopes of letters written before its writers had
	// keys works through a long list in one sitting: generous, but not endless.
	envelope: limit({
		name: 'envelopes',
		what: 'envelopes',
		windowMs: minutes(rateLimits.writeWindowMinutes),
		perSubject: rateLimits.envelopesPerUser,
		subject: perAccount
	}),
	// Proposed directory edits: a queue a person reads, so cheap to write and
	// expensive to review.
	submission: limit({
		name: 'submissions',
		what: 'proposed changes',
		windowMs: minutes(rateLimits.writeWindowMinutes),
		perSubject: rateLimits.submissionsPerUser,
		subject: perAccount
	}),
	createWriter: limit({
		name: 'writers',
		what: 'writer accounts',
		windowMs: minutes(rateLimits.writeWindowMinutes),
		perSubject: rateLimits.writersPerUser,
		subject: perAccount
	}),
	// Directory photos: each one is a file on disk, served to anybody.
	photo: limit({
		name: 'photos',
		what: 'photo uploads',
		windowMs: minutes(rateLimits.writeWindowMinutes),
		perSubject: rateLimits.photosPerUser,
		subject: perAccount
	}),
	// Issuing invitations and batches of invite codes: both hand out credentials.
	issueInvites: limit({
		name: 'invites-issued',
		what: 'invitations',
		windowMs: minutes(rateLimits.writeWindowMinutes),
		perSubject: rateLimits.invitesPerUser,
		subject: perAccount
	}),
	// A rotation may carry every envelope a group holds (ROTATION_MAX_BYTES, 32 MB).
	rotation: limit({
		name: 'rotations',
		what: 'group key rotations',
		windowMs: minutes(rateLimits.writeWindowMinutes),
		perSubject: rateLimits.rotationsPerUser,
		subject: perAccount
	}),
	registerDevice: limit({
		name: 'devices',
		what: 'device registrations',
		windowMs: minutes(rateLimits.writeWindowMinutes),
		perSubject: rateLimits.devicesPerUser,
		subject: perAccount
	}),
	// Registration is public wherever OPEN_REGISTRATION is on, so it is counted
	// per address. An admin creating accounts is doing administration and is not
	// limited here; any other token is. This once exempted every signed-in
	// request, so one ordinary account could make accounts without end.
	register: limit({
		name: 'register',
		what: 'sign-ups',
		windowMs: minutes(rateLimits.writeWindowMinutes),
		perIp: rateLimits.registerPerIp,
		exempt: (req) => AuthzService.isAdmin(req)
	})
};

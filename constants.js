import 'dotenv/config';

const {
	JWT_SECRET,
	PORT,
	ADMIN_USERNAME,
	ADMIN_PASSWORD,
	ADMIN_EMAIL,
	CORS_ORIGIN,
	DB_RESET,
	DB_SEED,
	DB_LOGGING,
	DB_STORAGE,
	UPLOAD_DIR,
	UPLOAD_MAX_BYTES,
	ENCRYPTION_MODE,
	ENCRYPTION_KEY,
	RETENTION_DEFAULT_DAYS,
	RETENTION_MAX_DAYS,
	TRUST_PROXY
} = process.env;

/**
 * Read a boolean-ish environment variable. Accepts true/false, 1/0, yes/no
 * in any case; anything else (including unset) yields the default.
 * @param {string|undefined} value
 * @param {boolean} fallback
 * @returns {boolean}
 */
function envBool(value, fallback) {
	if (value === undefined || value === '') {
		return fallback;
	}
	const normalized = String(value).trim().toLowerCase();
	if (['true', '1', 'yes', 'on'].includes(normalized)) {
		return true;
	}
	if (['false', '0', 'no', 'off'].includes(normalized)) {
		return false;
	}
	return fallback;
}

/** Allowed CORS origins, comma-separated in CORS_ORIGIN. */
const corsOrigins = (CORS_ORIGIN || 'http://localhost:3001')
	.split(',')
	.map((origin) => origin.trim())
	.filter((origin) => origin.length > 0);

export {
	JWT_SECRET as secretOrKey,
	PORT as sysPort,
	ADMIN_USERNAME as adminUsername,
	ADMIN_PASSWORD as adminPassword,
	ADMIN_EMAIL as adminEmail,
	corsOrigins
};

export const dbReset = envBool(DB_RESET, false);
export const dbSeed = envBool(DB_SEED, true);
export const dbLogging = envBool(DB_LOGGING, false);
/** True under `node --test`; boot-time chatter is suppressed. */
export const quietBoot = process.env.NODE_ENV === 'test';
/** SQLite file path, or ':memory:' for a throwaway in-process database (tests). */
export const dbStorage = DB_STORAGE || 'database.sqlite';
/** Directory that holds uploaded attachments (created on first upload). */
export const uploadDir = UPLOAD_DIR || 'uploads';
/** Largest accepted upload, in bytes. Default 20 MiB. */
/**
 * How letters are encrypted. `server`: the API encrypts letter bodies, relay
 * notes, and attachments with per-letter content keys wrapped by
 * ENCRYPTION_KEY, and decrypts them for authorised readers (the API can read
 * letters). `e2e`: reserved for the browser-side design, where the server
 * only ever holds ciphertext and envelopes wrapped to readers' public keys.
 */
export const ENCRYPTION_MODES = ['server', 'e2e'];
export const encryptionMode = ENCRYPTION_MODE || 'server';
/** Base64 of 32 random bytes; required in `server` mode. `npm run keygen` makes one. */
export const encryptionKey = ENCRYPTION_KEY || '';
/**
 * Retention: days a writer's letters and replies stay after mailing when
 * the writer has not chosen a window (0 = forever), and an optional cap on
 * what a writer may choose (unset = no cap).
 */
function envDays(value, fallback, { min = 0 } = {}) {
	if (value === undefined || value === '') {
		return fallback;
	}
	const n = Number(value);
	return Number.isInteger(n) && n >= min ? n : fallback;
}
export const retentionDefaultDays = envDays(RETENTION_DEFAULT_DAYS, 90);
// A cap of 0 would read as "forever" (the sentinel), so the cap starts at 1 day.
export const retentionMaxDays = envDays(RETENTION_MAX_DAYS, null, { min: 1 });
export const uploadMaxBytes =
	UPLOAD_MAX_BYTES && Number(UPLOAD_MAX_BYTES) > 0 ? Number(UPLOAD_MAX_BYTES) : 20 * 1024 * 1024;

/**
 * Rate limits on the unauthenticated endpoints. Every value is a positive
 * whole number read from the environment, falling back to the default;
 * RATE_LIMIT_ENABLED=false switches limiting off (the test suite does).
 */
function envCount(name, fallback) {
	const n = Number(process.env[name]);
	return Number.isInteger(n) && n > 0 ? n : fallback;
}
export const rateLimits = {
	enabled: envBool(process.env.RATE_LIMIT_ENABLED, true),
	// Sign-in: failed attempts per username, and all attempts per address, per window.
	loginFailuresPerUser: envCount('RATE_LIMIT_LOGIN_FAILURES_PER_USER', 10),
	loginPerIp: envCount('RATE_LIMIT_LOGIN_PER_IP', 60),
	loginWindowMinutes: envCount('RATE_LIMIT_LOGIN_WINDOW_MINUTES', 15),
	// Claim token checks per address per window.
	claimPerIp: envCount('RATE_LIMIT_CLAIM_PER_IP', 20),
	claimWindowMinutes: envCount('RATE_LIMIT_CLAIM_WINDOW_MINUTES', 60),
	// Recovery: starts per username and per address, finishes per username, per window.
	recoverStartPerUser: envCount('RATE_LIMIT_RECOVER_START_PER_USER', 5),
	recoverStartPerIp: envCount('RATE_LIMIT_RECOVER_START_PER_IP', 30),
	recoverFinishPerUser: envCount('RATE_LIMIT_RECOVER_FINISH_PER_USER', 5),
	recoverWindowMinutes: envCount('RATE_LIMIT_RECOVER_WINDOW_MINUTES', 60)
};

/**
 * Express "trust proxy" setting, so req.ip is the client and not the
 * reverse proxy. Unset: direct connections. Examples: 1 (one proxy hop),
 * "loopback", or a subnet.
 */
export const trustProxy =
	TRUST_PROXY === undefined || TRUST_PROXY === ''
		? false
		: /^\d+$/.test(TRUST_PROXY)
			? Number(TRUST_PROXY)
			: (envBool(TRUST_PROXY, null) ?? TRUST_PROXY);

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
	UPLOAD_MAX_BYTES
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
/** Largest accepted upload, in bytes. Default 10 MiB. */
export const uploadMaxBytes =
	UPLOAD_MAX_BYTES && Number(UPLOAD_MAX_BYTES) > 0 ? Number(UPLOAD_MAX_BYTES) : 10 * 1024 * 1024;

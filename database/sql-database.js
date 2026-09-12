import { sequelize, Sequelize } from './connection.js';
import * as Models from '#models/all.model.js';
import { dbReset, dbSeed, quietBoot } from '#constants';

import { runMigrations } from './migrate.js';
import { createSeeds } from './seeds/all.seeds.js';
import { ensureAdmin } from './bootstrap-admin.js';
import * as crypto from '#services/crypto.js';

/**
 * Model initialisation and boot-time database setup.
 *
 * The schema is owned by the migrations in database/migrations/; models
 * describe the same columns for the ORM. The test suite checks the two agree.
 *
 * Environment (see .env.example):
 * - DB_RESET=true   drop every table and replay all migrations (data is lost)
 * - DB_SEED=false   skip loading the seed files (default: seed empty tables)
 * - DB_LOGGING=true print every SQL statement (default: quiet)
 * - DB_STORAGE=path SQLite file to use; ':memory:' for tests (default: database.sqlite)
 */

export { sequelize };

export const Chat = Models.Chat.init(sequelize, Sequelize);
export const Message = Models.Message.init(sequelize, Sequelize);
export const Prison = Models.Prison.init(sequelize, Sequelize);
export const Prisoner = Models.Prisoner.init(sequelize, Sequelize);
export const Rule = Models.Rule.init(sequelize, Sequelize);
export const User = Models.User.init(sequelize, Sequelize);
export const Chapter = Models.Chapter.init(sequelize, Sequelize);
export const PrisonerSupport = Models.PrisonerSupport.init(sequelize, Sequelize);
export const ClaimToken = Models.ClaimToken.init(sequelize, Sequelize);
export const MessageStatus = Models.MessageStatus.init(sequelize, Sequelize);
export const Attachment = Models.Attachment.init(sequelize, Sequelize);
export const LetterKey = Models.LetterKey.init(sequelize, Sequelize);
export const Submission = Models.Submission.init(sequelize, Sequelize);
export const AuditLog = Models.AuditLog.init(sequelize, Sequelize);
export const OrgMemberKey = Models.OrgMemberKey.init(sequelize, Sequelize);
export const RevokedToken = Models.RevokedToken.init(sequelize, Sequelize);

Prisoner.associate(Models);
Prison.associate(Models);
Message.associate(Models);
User.associate(Models);
Chat.associate(Models);
Rule.associate(Models);
Chapter.associate(Models);
ClaimToken.associate(Models);
MessageStatus.associate(Models);
Attachment.associate(Models);
LetterKey.associate(Models);
Submission.associate(Models);
AuditLog.associate(Models);
OrgMemberKey.associate(Models);
RevokedToken.associate(Models);

/** How often expired revocations are cleared while the server runs. */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

const log = quietBoot ? () => {} : console.log;
const warn = quietBoot ? () => {} : console.warn;

/**
 * Migrate (dropping everything first when DB_RESET is set), load seed data
 * unless DB_SEED is false, then make sure an admin account exists.
 * Resolves once the database is ready to serve requests.
 */
export const ready = (async () => {
	await crypto.ready;
	crypto.assertConfigured();
	if (dbReset) {
		warn('DB_RESET is set: dropping every table and replaying all migrations.');
	}
	await runMigrations(sequelize, { reset: dbReset, log });
	if (dbSeed) {
		await createSeeds();
	} else {
		log('DB_SEED is false: skipping seed data.');
	}
	await ensureAdmin();
	await RevokedToken.sweep();
	// Expired logout entries are also swept on every logout; this covers a
	// server that runs for days without one. unref() keeps it from holding
	// the process open (tests, one-off scripts).
	setInterval(
		() => RevokedToken.sweep().catch((err) => console.error('[sessions] sweep failed', err)),
		SWEEP_INTERVAL_MS
	).unref();
	if (crypto.isE2E()) {
		const leftover = await LetterKey.count({ where: { readerType: 'server' } });
		if (leftover > 0) {
			warn(
				'ENCRYPTION_MODE=e2e but ' +
					leftover +
					' letter(s) still carry a server envelope; run `npm run encryption:rewrap` once readers have keys.'
			);
		}
	}
	log('Database ready.');
})().catch((err) => {
	console.error('Database setup failed:', err);
});

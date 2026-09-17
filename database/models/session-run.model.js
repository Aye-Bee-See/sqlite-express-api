import { Model, Op } from 'sequelize';
import Schemas from '#schemas/all.schema.js';

/** Tokens live a week (auth.services.js); a run older than that covers nothing still valid. */
export const TOKEN_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The database's own record of when it issued tokens. A token is honoured
 * only if its `issued` time falls inside a run this database remembers.
 *
 * That is what ties a token to a database rather than only to JWT_SECRET.
 * A token from before a reset, or for a database that was since replaced,
 * finds no run at all. After a restore from backup, a token issued between
 * the backup and the restore falls after the last run the backup knows and
 * before the first token of the new run, so it is refused too, while
 * tokens from before the backup (whose accounts the backup does contain)
 * keep working. Without this, such a token would be accepted for whichever
 * account now holds its user id.
 *
 * A run starts with the first token a process issues, not at boot, so
 * scripts that only open the database (retention, rewrap) leave no trace.
 */
export default class SessionRun extends Model {
	static init(sequelize) {
		return super.init(Schemas.sessionRun, {
			sequelize,
			modelName: 'SessionRun',
			tableName: 'SessionRuns',
			timestamps: false
		});
	}

	static associate() {}

	/** This process's run, once it has issued a token: { id, startedAt, lastIssuedAt }. */
	static #current = null;
	/** Runs read from the database, refreshed when a token matches none of them. */
	static #known = null;
	/** Issues are recorded one after another, so two first logins make one run. */
	static #recording = Promise.resolve();

	/**
	 * Remember that a token was issued at `issued`. Awaited before the token
	 * is handed out: a token the database has no record of would be refused
	 * after the next restart.
	 * @param {number} issued milliseconds, the token's `issued` claim
	 */
	static recordIssue(issued) {
		const work = async () => {
			if (!SessionRun.#current) {
				const row = await this.create({ startedAt: issued, lastIssuedAt: issued });
				SessionRun.#current = { id: row.id, startedAt: issued, lastIssuedAt: issued };
				return;
			}
			if (issued <= SessionRun.#current.lastIssuedAt) {
				return;
			}
			SessionRun.#current.lastIssuedAt = issued;
			await this.update(
				{ lastIssuedAt: issued },
				{ where: { id: SessionRun.#current.id, lastIssuedAt: { [Op.lt]: issued } } }
			);
		};
		const run = SessionRun.#recording.then(work, work);
		SessionRun.#recording = run.catch(() => {});
		return run;
	}

	static #within(run, issued) {
		return Number(run.startedAt) <= issued && issued <= Number(run.lastIssuedAt);
	}

	/**
	 * Did this database issue tokens at that time?
	 * @param {number} issued milliseconds
	 */
	static async covers(issued) {
		if (SessionRun.#current && SessionRun.#within(SessionRun.#current, issued)) {
			return true;
		}
		if (SessionRun.#known && SessionRun.#known.some((run) => SessionRun.#within(run, issued))) {
			return true;
		}
		// Not in memory: ask the database before refusing. It is the authority
		// (another process may have issued the token), and refusals are rare.
		SessionRun.#known = await this.findAll({ raw: true });
		return SessionRun.#known.some((run) => SessionRun.#within(run, issued));
	}

	/** Drop runs too old to cover a token that has not expired by itself. */
	static async sweep(now = Date.now()) {
		const where = { lastIssuedAt: { [Op.lt]: now - TOKEN_LIFETIME_MS } };
		if (SessionRun.#current) {
			where.id = { [Op.ne]: SessionRun.#current.id };
		}
		const removed = await this.destroy({ where });
		SessionRun.#known = null;
		return removed;
	}

	/** Forget what this process holds in memory, as a restart would. For tests. */
	static forget() {
		SessionRun.#current = null;
		SessionRun.#known = null;
	}
}

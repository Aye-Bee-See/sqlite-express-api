import { ExtractJwt, Strategy as JwtStrategy } from 'passport-jwt';
import { Strategy as LocalStrategy } from 'passport-local';
import jwt from 'jsonwebtoken';
import { User, RevokedToken, SessionRun } from '#db/sql-database.js';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcrypt';
import passport from 'passport';
import { secretOrKey } from '#constants';
import AuthzService from '#rtServices/authz.services.js';
import { HttpError } from '#services/HttpError.js';
import { requirementFor } from '#services/two-factor-policy.js';
import { twoFactorEnd, userEnd } from '#routes/constants.js';
export default class authService {
	static #jwtOptions = {
		secretOrKey: secretOrKey,
		jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken()
	};
	static async #createJWT(user) {
		const now = Date.now();
		const weekInMilliseconds = 6.048e8;
		const expiryDateMs = now + weekInMilliseconds;
		// jti lets one token be logged out; issued (milliseconds, finer than the
		// standard iat) lets sessionsRevokedAt invalidate everything issued before
		// an instant while a token issued just after it still passes.
		const payload = {
			id: user.id,
			expiry: expiryDateMs,
			issued: now,
			jti: randomBytes(16).toString('hex')
		};
		const token = jwt.sign(payload, secretOrKey, { expiresIn: '1w' });
		// The database remembers when it issued tokens; see SessionRun.
		await SessionRun.recordIssue(now);
		return { token, expires: expiryDateMs };
	}

	/** A fresh token for a user (after a password change). */
	static async issueToken(user) {
		return await authService.#createJWT(user);
	}

	/** The decoded payload of the bearer token on a request that already passed the JWT strategy. */
	static tokenPayload(req) {
		const raw = ExtractJwt.fromAuthHeaderAsBearerToken()(req);
		return raw ? jwt.decode(raw) : null;
	}

	/**
	 * Is this token still good for this user? False once its id was logged
	 * out or the account's sessions were revoked after it was issued.
	 */
	static async tokenLive(payload, user) {
		if (payload.jti && (await RevokedToken.isRevoked(payload.jti))) {
			return false;
		}
		const issued =
			typeof payload.issued === 'number'
				? payload.issued
				: typeof payload.iat === 'number'
					? payload.iat * 1000
					: 0; // a token from before this check: treated as older than any revocation
		// Issued at a time this database has no record of: a token from before
		// a reset, or from a timeline a restore discarded. Its user id may now
		// belong to someone else.
		if (!(await SessionRun.covers(issued))) {
			return false;
		}
		return !user.sessionsRevokedAt || issued >= user.sessionsRevokedAt.getTime();
	}

	/** How long the second step of a two-factor sign-in may take. */
	static TWO_FACTOR_CHALLENGE_MS = 5 * 60 * 1000;

	/**
	 * The first half of a two-factor sign-in: proof that the password was right,
	 * good for five minutes and for nothing but POST /auth/login/two-factor. The
	 * JWT strategy refuses any token with a `purpose`, so it never works as a session.
	 */
	static async #createChallenge(user) {
		const now = Date.now();
		// Recorded like any token's issue, so the session checks (tokenLive) accept it.
		await SessionRun.recordIssue(now);
		const expires = now + authService.TWO_FACTOR_CHALLENGE_MS;
		const challenge = jwt.sign(
			{ id: user.id, purpose: 'two-factor', issued: now, jti: randomBytes(16).toString('hex') },
			secretOrKey,
			{ expiresIn: Math.floor(authService.TWO_FACTOR_CHALLENGE_MS / 1000) }
		);
		return { challenge, expires };
	}

	/**
	 * The account a two-factor challenge was made for, or null when it is not
	 * one, has expired, was used, or the account's sessions were ended since.
	 */
	static async challengeUser(challenge) {
		let payload;
		try {
			payload = jwt.verify(String(challenge ?? ''), secretOrKey);
		} catch {
			return null;
		}
		if (payload?.purpose !== 'two-factor' || payload.id === undefined) {
			return null;
		}
		const user = await User.scope('withTwoFactor').findByPk(payload.id);
		if (!user || user.role === 'banned' || !user.totpEnabledAt) {
			return null;
		}
		if (!(await authService.tokenLive(payload, user))) {
			return null;
		}
		return { user, payload };
	}

	/**
	 * Spend a challenge: true for the one request that gets to, false for any other
	 * (two requests with two good codes cannot both sign in). The unique index on
	 * the token id decides.
	 */
	static async spendChallenge(payload) {
		try {
			await RevokedToken.create({
				jti: payload.jti,
				userId: payload.id,
				expiresAt: new Date(payload.exp * 1000)
			});
			return true;
		} catch (err) {
			if (err?.name === 'SequelizeUniqueConstraintError') {
				return false;
			}
			throw err;
		}
	}

	static async #verify(username, password, done) {
		let user;

		try {
			user = (await User.getUserWithPassword({ username })) || false;
			if (user && user.role !== 'banned' && !User.isUnclaimedManaged(user)) {
				const match = (await bcrypt.compare(password, user.password)) || false;
				if (match) {
					if (user.totpEnabledAt) {
						// Right password; the code from the authenticator app comes next.
						return done(null, user, { twoFactor: await authService.#createChallenge(user) });
					}
					const token = await authService.#createJWT(user);

					return done(null, user, { token: token });
				}
			}
			return done(null, false);
		} catch (err) {
			const errVar = !(err instanceof Error) ? new Error(err) : err;
			return done(errVar);
		}
	}

	static login = new LocalStrategy(
		{ usernameField: 'username', passwordField: 'password' },
		authService.#verify
	);
	/**
	 * What someone who must set up two-factor sign-in, and has not, may still do:
	 * set it up, see where they stand, and sign out. Everything else is refused
	 * until they have, whether they signed in before the requirement or after it.
	 */
	static #duringSetup = new Set([
		'GET /auth' + twoFactorEnd.get.one,
		'POST /auth' + twoFactorEnd.post.setup,
		'POST /auth' + twoFactorEnd.post.confirm,
		'POST /auth' + userEnd.post.logout
	]);

	/** @throws {HttpError} 403 TwoFactorRequiredError, when the account must set it up first */
	static async #requireTwoFactorSetUp(req, user) {
		const need = await requirementFor(user);
		if (!need.required) {
			return;
		}
		const state = await User.scope('withTwoFactor').findByPk(user.id, {
			attributes: ['id', 'totpEnabledAt']
		});
		if (state && state.totpEnabledAt) {
			return;
		}
		const path =
			req.method +
			' ' +
			String(req.originalUrl || '')
				.split('?')[0]
				.replace(/\/+$/, '');
		if (authService.#duringSetup.has(path)) {
			return;
		}
		const err = new HttpError(
			403,
			'This account must use two-factor sign-in. Set it up first (POST /auth/two-factor/setup, then POST /auth/two-factor/confirm).',
			'TwoFactorRequiredError'
		);
		err.condition = 'setup_required';
		err.because = need.because;
		throw err;
	}

	static authorize = new JwtStrategy(
		{ ...authService.#jwtOptions, passReqToCallback: true },
		async (req, jwt_payload, next) => {
			try {
				if (jwt_payload?.id === undefined || jwt_payload.id === null) {
					return next(null, false);
				}
				// A token made for one step of something (a two-factor challenge) is not a session.
				if (jwt_payload.purpose !== undefined) {
					return next(null, false);
				}
				const user = await User.getUser({ id: jwt_payload.id });
				if (user && user.role !== 'banned' && (await authService.tokenLive(jwt_payload, user))) {
					await AuthzService.noteGroupStanding(user);
					await authService.#requireTwoFactorSetUp(req, user);
					return next(null, user);
				}
				return next(null, false);
			} catch (err) {
				const errVar = !(err instanceof Error) ? new Error(err) : err;
				return next(errVar);
			}
		}
	);
}

// Register the strategies once. Route files refer to them by name in
// passport.authenticate('UsrJStrat' | 'LStrat', ...); index.js imports this
// module so registration happens before any router is mounted.
passport.use('UsrJStrat', authService.authorize);
passport.use('LStrat', authService.login);

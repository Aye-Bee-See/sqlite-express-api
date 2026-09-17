import { ExtractJwt, Strategy as JwtStrategy } from 'passport-jwt';
import { Strategy as LocalStrategy } from 'passport-local';
import jwt from 'jsonwebtoken';
import { User, RevokedToken, SessionRun } from '#db/sql-database.js';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcrypt';
import passport from 'passport';
import { secretOrKey } from '#constants';
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

	static async #verify(username, password, done) {
		let user;

		try {
			user = (await User.getUserWithPassword({ username })) || false;
			if (user && user.role !== 'banned' && !User.isUnclaimedManaged(user)) {
				const match = (await bcrypt.compare(password, user.password)) || false;
				if (match) {
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
	static authorize = new JwtStrategy(authService.#jwtOptions, async (jwt_payload, next) => {
		try {
			if (jwt_payload?.id === undefined || jwt_payload.id === null) {
				return next(null, false);
			}
			const user = await User.getUser({ id: jwt_payload.id });
			if (user && user.role !== 'banned' && (await authService.tokenLive(jwt_payload, user))) {
				return next(null, user);
			}
			return next(null, false);
		} catch (err) {
			const errVar = !(err instanceof Error) ? new Error(err) : err;
			return next(errVar);
		}
	});
}

// Register the strategies once. Route files refer to them by name in
// passport.authenticate('UsrJStrat' | 'LStrat', ...); index.js imports this
// module so registration happens before any router is mounted.
passport.use('UsrJStrat', authService.authorize);
passport.use('LStrat', authService.login);

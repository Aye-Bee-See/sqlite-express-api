import { ExtractJwt, Strategy as JwtStrategy } from 'passport-jwt';
import { Strategy as LocalStrategy } from 'passport-local';
import jwt from 'jsonwebtoken';
import { User } from '#db/sql-database.js';
import bcrypt from 'bcrypt';
import { secretOrKey } from '#constants';
export default class authService {
	static #jwtOptions = {
		secretOrKey: secretOrKey,
		jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken()
	};
	static #createJWT(user) {
		const now = Date.now();
		const weekInMilliseconds = 6.048e8;
		const expiryDateMs = now + weekInMilliseconds;
		let payload = { id: user.id, expiry: expiryDateMs };
		let token = jwt.sign(payload, secretOrKey, { expiresIn: '1w' });
		return { token, expires: expiryDateMs };
	}

	static async register() {}

	static async #verify(username, password, done) {
		let user;

		try {
			user = (await User.getUser({ username })) || false;
			if (user) {
				const match = (await bcrypt.compare(password, user.password)) || false;
				if (match) {
					const token = authService.#createJWT(user);

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
			if (user) {
				return next(null, user);
			}
			return next(null, false);
		} catch (err) {
			const errVar = !(err instanceof Error) ? new Error(err) : err;
			return next(errVar);
		}
	});
}

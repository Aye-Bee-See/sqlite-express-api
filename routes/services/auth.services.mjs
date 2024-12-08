import { ExtractJwt, Strategy as JwtStrategy } from 'passport-jwt';
import {Strategy as LocalStrategy} from 'passport-local';
import jwt from 'jsonwebtoken';
import {User} from "#db/sql-database.mjs";
import bcrypt from 'bcrypt';
import {secretOrKey} from '#constants';
export default class authService {
    static #jwtOptions = {
        secretOrKey: secretOrKey,
        jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken()
    };
    static #createJWT(user) {
        const now = Date.now();
        const weekInMilliseconds = 6.048e+8;
        const expiryDateMs = now + weekInMilliseconds;
        let payload = {id: user.id, expiry: expiryDateMs};
        let token = jwt.sign(payload, secretOrKey, {expiresIn: '1w'});
        console.log(token);
        return {token, expires: expiryDateMs};
    }

    static async register() {

    }

    static async #verify(username, password, done) {
        let user;
        
        try {
            user = await User.getUser({username});
            if (!user) {
                return done(null, false, { message: 'No such user' });
            }

            const match = await bcrypt.compare(password, user.password);
            if (!match) {
                return done(null, false, { message: 'Wrong password' });
            }
            const token = authService.#createJWT(user);
            return done(null, user, { token });
        } catch (err) {
            err = !(err instanceof Error) ? new Error(err) : err;
            return done(err);
        }

    }

    static login = new LocalStrategy({usernameField: 'username', passwordField: 'password'}, authService.#verify);
    static authorize = new JwtStrategy(authService.#jwtOptions, (jwt_payload, next) => {
        let user = User.getUser({id: jwt_payload.id});
        if (user) {
            next(null, user);
        } else {
            next(null, false);
        }
    });
}


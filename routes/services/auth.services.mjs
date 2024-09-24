import { ExtractJwt, Strategy as JwtStrategy } from 'passport-jwt';
import {Strategy as LocalStrategy} from 'passport-local';
import jwt from 'jsonwebtoken';
import {User} from "#db/sql-database.mjs";
import bcrypt from 'bcrypt';


export default class authService {
    static #jwtOptions = {
        secretOrKey: process.env.JWT_SECRET,
        jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken()
    };
    
    static #createJWT(user) {
        const now = Date.now();
        const weekInMilliseconds = 6.048e+8;
        const expiryDateMs = now + weekInMilliseconds;

        let payload = {id: user.id, expiry: expiryDateMs};
        let token = jwt.sign(payload, process.env.JWT_SECRET, {expiresIn: '1w'});

        return {token, expires: expiryDateMs};
    }

    static async register() {
        
    }
    
    
    
    static async #verify(username, password, done) {
        let user;

        try {
            user = await User.getUser({username});

            const match = await bcrypt.compare(password, user.password);
            if (!match) {
                return done(null, false);
            }
            const token = authService.#createJWT(user);
            //req.body.token = token;

            return done(null, user, {token:token});
        } catch (err) {
            err = !(err instanceof Error) ? new Error(err) : err;
            return done(err);
        }

    }

    static login = new LocalStrategy({usernameField: 'username', passwordField: 'password'}, authService.#verify);

    static authorize = new JwtStrategy(authService.#jwtOptions, function (jwt_payload, next) {
        let user = User.getUser({id: jwt_payload.id});
        if (user) {
            next(null, user);
        } else {
            next(null, false);
        }
    });

}

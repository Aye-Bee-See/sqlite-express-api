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

    static async register(req, res) {
        const { username, password } = req.body;
        try {
            const hashedPassword = await bcrypt.hash(password, 10);
            const newUser = await User.createUser({ username, password: hashedPassword });
            const token = authService.#createJWT(newUser);
            res.status(201).json({ user: newUser, token });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
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

    static authorize = new JwtStrategy(authService.#jwtOptions, (jwt_payload, next)=> {
        let user = User.getUser({id: jwt_payload.id});
        if (user) {
            next(null, user);
        } else {
            next(null, false);
        }
    });

}


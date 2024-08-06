import { ExtractJwt, Strategy as JwtStrategy } from 'passport-jwt'
import jwt from 'jsonwebtoken'
import {User} from "#db/sql-database.mjs"


export default class authService {
    static #jwtOptions={
            secretOrKey: process.env.JWT_SECRET,
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken()
        };

    register() {}
    login() {}
    static authorize= new JwtStrategy(authService.#jwtOptions, function (jwt_payload, next) {
            console.trace("Authorize GOGOGO");
            console.log('payload sreceived', jwt_payload);
            let user = User.getUser({id: jwt_payload.id});
            if (user) {
                next(null, user);
            } else {
                next(null, false);
            }
        });
    
}


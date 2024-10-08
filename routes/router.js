import express, {Router as router} from 'express';
import * as bodyParser from 'body-parser';
import * as passport from 'passport';

import authService from "#rtServices/auth.services.mjs";

    console.group("authService");
    console.group("router.js line 10");
    console.log(authService);
    console.groupEnd();
    console.groupEnd();
  //  const JwtStrat=  authService.authorize;


const app = express();


app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));
app.use(passport.initialize());

export default router;


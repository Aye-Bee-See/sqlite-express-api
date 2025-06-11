import express, { Router as router } from 'express';
import * as bodyParser from 'body-parser';
import * as passport from 'passport';

import authService from '#rtServices/auth.services.js';

const app = express();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(passport.initialize());

export default router;

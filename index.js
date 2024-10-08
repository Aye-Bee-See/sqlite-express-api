import express from 'express';
import passport from 'passport';
import {default as bodyParser} from 'body-parser';
import {ErrorHandler as errorMiddleware} from './middleware/ErrorHandler.js';
import {default as authRouter} from '#routes/user/user.cjs'; 
import {default as prisonRouter} from '#routes/prison/prison.cjs'; 
import {default as prisonerRouter} from '#routes/prisoner/prisoner.cjs'; 
import {default as ruleRouter} from '#routes/rule/rule.mjs'; 
import {default as messagingRouter} from '#routes/message/messaging.cjs';
import 'dotenv/config';

const app = express();

// parse application/json
app.use(bodyParser.json());
//parse application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: true }));

app.use(passport.initialize());

// start the app
app.listen(process.env.PORT, function() {
  console.log('Express is running on port: ' + process.env.PORT);
});


// Add headers before the routes are defined
app.use(function (req, res, next) {

  // Website you wish to allow to connect
  res.setHeader('Access-Control-Allow-Origin', 'http://localhost:3001');

  // Request methods you wish to allow
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');

  // Request headers you wish to allow
  res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');

  // Set to true if you need the website to include cookies in the requests sent
  // to the API (e.g. in case you use sessions)
  res.setHeader('Access-Control-Allow-Credentials', false);

  // Pass to next layer of middleware
  next();
});

app.use('/auth', authRouter);
app.use('/prison', prisonRouter);
app.use('/prisoner', prisonerRouter);
app.use('/rule', ruleRouter);
app.use('/messaging', messagingRouter);
app.use(errorMiddleware);

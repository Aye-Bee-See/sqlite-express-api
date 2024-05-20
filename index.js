const express = require('express');
const bodyParser = require('body-parser');
const app = express();
const passport = require('passport');
const errorMiddleware = require('./middleware/ErrorHandler')

// parse application/json
app.use(bodyParser.json());
//parse application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: true }));

app.use(passport.initialize());

// start the app
app.listen(3000, function() {
  console.log('Express is running on port 3000');
});

var authRouter = require('./routes/user/user');
var prisonRouter = require('./routes/prison/prison');
var prisonerRouter = require('./routes/prisoner/prisoner');
var ruleRouter = require('./routes/rule/rule');
var messagingRouter = require('./routes/message/messaging')

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
  res.setHeader('Access-Control-Allow-Credentials', true);

  // Pass to next layer of middleware
  next();
});

app.use('/auth', authRouter);
app.use('/prison', prisonRouter);
app.use('/prisoner', prisonerRouter);
app.use('/rule', ruleRouter);
app.use('/messaging', messagingRouter);
app.use(errorMiddleware);
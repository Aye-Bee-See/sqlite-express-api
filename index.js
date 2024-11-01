import express from 'express';
import passport from 'passport';
import {default as bodyParser} from 'body-parser';
import {sysPort} from '#constants';
import {ErrorHandler as errorMiddleware} from './middleware/ErrorHandler.js';
import {default as authRouter} from '#routes/user/user.js';
import {default as authRouter} from '#routes/user/user.js';
import prisonRoutes from '#routes/prison/prison.js';
import PrisonerRoutes from '#routes/prisoner/prisoner.js';
import RuleRoutes from '#routes/rule/rule.mjs';
import MessageRoutes from '#routes/message/message.js';
import ChatRoutes from '#routes/chat/chat.js';

const app = express();

// Add CORS middleware before any routes are defined
app.use(cors({
    origin: 'http://localhost:3001',
    methods: 'GET, POST, OPTIONS, PUT, PATCH, DELETE',
    allowedHeaders: 'X-Requested-With,content-type, authorization',
    credentials: false
}));

// parse application/json
app.use(bodyParser.json());
//parse application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({extended: true}));

app.use(passport.initialize());

// start the app
app.listen(sysPort, function () {
    console.log('Express is running on port: ' + sysPort);
});


// Add headers before the routes are defined
app.use(function (req, res, next) {

    // Website you wish to allow to connect
    res.setHeader('Access-Control-Allow-Origin', 'http://localhost:3001');

    // Request methods you wish to allow
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');

    // Request headers you wish to allow
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type, authorization');

    // Set to true if you need the website to include cookies in the requests sent
    // to the API (e.g. in case you use sessions)
    res.setHeader('Access-Control-Allow-Credentials', false);

    // Pass to next layer of middleware
    next();
});



app.use('/auth', authRouter.Router);
app.use('/prison', prisonRoutes.Router);
app.use('/prisoner', PrisonerRoutes.Router);
app.use('/rule', RuleRoutes.Router);
app.use('/messaging', MessageRoutes.Router);
app.use('/chat', ChatRoutes.Router);
app.use('/chat', ChatRoutes.Router);
app.use(errorMiddleware);


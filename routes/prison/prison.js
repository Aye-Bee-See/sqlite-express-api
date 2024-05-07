/**
 * Express router for prison routes.
 * @module prisonRouter
 */

var express = require('express');
const bodyParser = require('body-parser');

const app = express();
var router = express.Router();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const prisonHelpers = require('./prison.helpers')

// Enable authentication

const jwt = require('jsonwebtoken');
// import passport and passport-jwt modules
const passport = require('passport');
const passportJWT = require('passport-jwt');
// ExtractJwt to help extract the token
let ExtractJwt = passportJWT.ExtractJwt;
// JwtStrategy which is the strategy for the authentication
let JwtStrat = require('../../jwt-strategy')
app.use(passport.initialize());

/**
 * GET request handler for the root route.
 * @name GET /
 * @function
 * @memberof module:prisonRouter
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 */
router.get('/', function(req, res) {
  res.json({ message: 'Prisons is up!' });
});

/**
 * GET request handler for getting all prisons.
 * @name GET /prisons
 * @function
 * @memberof module:prisonRouter
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 */
router.get('/prisons/:full?', function(req, res) {
  const { full } = req.query;
  const fullBool = (full === 'true');
  prisonHelpers.getAllPrisons(fullBool).then(prison => res.json(prison)); 
});

/**
 * GET request handler for getting a prison by ID.
 * @name GET /prison
 * @function
 * @memberof module:prisonRouter
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 */
router.get('/prison/:id/:full?', function(req, res) {
  const { id } = req.params;
  const { full } = req.query;
  const fullBool = (full === 'true');
  prisonHelpers.getPrisonByID(id, fullBool).then(prison => res.json(prison));
});

/**
 * POST request handler for creating a new prison.
 * @name POST /create-prison
 * @function
 * @memberof module:prisonRouter
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @param {function} next - Express next middleware function.
 */
router.post('/create-prison', function(req, res, next) {
  const { prisonName, address } = req.body;
  prisonHelpers.createPrison({ prisonName, address }).then(prison =>
    res.json({ prison, msg: 'account created successfully' })
  );
});

module.exports = router;
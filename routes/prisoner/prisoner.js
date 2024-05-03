var express = require('express');
const bodyParser = require('body-parser');

const app = express();
var router = express.Router();
const db = require('../../sql-database')

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const prisonerHelper = require('./prisoner.helper');

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

router.get('/', function(req, res) {
  res.json({ message: 'Prisoners is up!' });
});

// get all prisons
router.get('/prisoners/:prison?', function(req, res) {
  console.log(req.query);
  const { prison } = req.query;
  const ip = (prison == 'true');
  prisonerHelper.getAllPrisoners(ip).then(prisoners => res.json(prisoners)); 
});

router.get('/prisoner/:id', function(req, res) {
  const { id } = req.params;
  prisonerHelper.getPrisonerByID(id).then(prisoner => res.json(prisoner))
})

router.post('/create-prisoner', function(req, res, next) {
  const { birthName, chosenName, prison, inmateID, releaseDate, bio } = req.body;
  prisonerHelper.createPrisoner({ birthName, chosenName, prison, inmateID, releaseDate, bio }).then(prisoner =>
    res.json({ prisoner, msg: 'prisoner created successfully' })
  );
});

router.put('/update-prison', function(req, res, next) {
  const { id, prison } = req.body;
  prisonerHelper.addPrisonerToPrison(id, prison).then(updatedPrisoner => res.json({updatedPrisoner, msg: 'Prisoner successfully added to prison'}));
})

router.put('/update-prisoner', function(req, res, next) {
  const prisoner = req.body;
  prisonerHelper.updatePrisoner(prisoner).then(updatedPrisoner => {
    res.json({ updatedPrisoner, msg: 'prisoner updated successfully'})
  })
})

module.exports = router
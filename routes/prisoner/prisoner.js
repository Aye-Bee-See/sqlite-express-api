var express = require('express');
const bodyParser = require('body-parser');

const app = express();
var router = express.Router();
const db = require('../../sql-database')

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const prisonerHelper = require('./prisoner.helper');

// TODO: Rename these routes to be consistent with other routes

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
router.get('/prisoners/:full?', function(req, res) {
  const { full } = req.query;
  const fullBool = (full === 'true');
  prisonerHelper.getAllPrisoners(fullBool).then(prisoners => res.json(prisoners)); 
});

router.get('/prisoner/:id/:full?', function(req, res) {
  const { id } = req.params;
  const { full } = req.query;
  const fullBool = (full === 'true');
  prisonerHelper.getPrisonerByID(id, fullBool).then(prisoner => res.json(prisoner))
})

router.post('/create-prisoner', function(req, res, next) {
  const { birthName, chosenName, prison_id, inmateID, releaseDate, bio } = req.body;
  prisonerHelper.createPrisoner({ birthName, chosenName, prison_id, inmateID, releaseDate, bio }).then(prisoner =>
    res.json({ prisoner, msg: 'prisoner created successfully' })
  ).catch(err => res.status(400).json({ msg: "Error creating prisoner", err }));
});

router.put('/update-prisoner', function(req, res, next) {
  const prisoner = req.body;
  prisonerHelper.updatePrisoner(prisoner).then(updatedPrisoner => {
    res.json({ updatedPrisoner, msg: 'prisoner updated successfully'})
  });
});

router.delete('/prisoner', function(req, res, next) {
  const { id } = req.body;
  prisonerHelper.deletePrisoner(id).then(deletedRows => { 
    if (deletedRows < 1) { res.status(400).json({ msg: "No such prisoner" }); }
    else { res.status(200).json({ msg: "Prisoner successfully deleted" }); }
   }).catch(err => res.status(400).json({msg: "Error deleting prisoner", err}));
});

module.exports = router
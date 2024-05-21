var express = require('express');
const bodyParser = require('body-parser');

const app = express();
var router = express.Router();

let Prisoner;
let Prison;
const db = import ("#db/sql-database.mjs").then(async(res)=>{
    Prison=await res.Prison;
    Prisoner=await res.Prisoner;
});

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

<<<<<<< HEAD
const prisonerHelper = require('./prisoner.helper');
const prisonHelper = require('../prison/prison.helpers')
=======
>>>>>>> structure-work

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
  res.status(200).json({ message: 'Prisoners is up!' });
});

router.post('/prisoner', function(req, res, next) {
  const { birthName, chosenName, prison, inmateID, releaseDate, bio } = req.body;
<<<<<<< HEAD
  prisonHelper.getPrisonByID(prison, false).then(prison => {
    if (prison) {
      prisonerHelper.createPrisoner({ birthName, chosenName, prison: prison.id, inmateID, releaseDate, bio }).then(prisoner =>
=======
  Prison.getPrisonByID(prison, false).then(prison => {
    if (prison) {
      Prisoner.createPrisoner({ birthName, chosenName, prison: prison.id, inmateID, releaseDate, bio }).then(prisoner =>
>>>>>>> structure-work
        res.status(200).json({ prisoner, msg: 'Prisoner created successfully' })
      ).catch(err => res.status(400).json({ msg: "Error creating prisoner", err }));
    }
    else {
      res.status(400).json( { msg: "Error creating prisoner to non-existent prison"} );
    }
  });
});

// get all prisons
router.get('/prisoners/:prison?/:full?', function(req, res) {
  const { full, prison } = req.query;
  const fullBool = (full === 'true');
  if (prison) {
<<<<<<< HEAD
    prisonHelper.getPrisonersByPrison(prison, fullBool).then(prisoners => res.status(200).json(prisoners))
      .catch(err => res.status(400).json({msg: "Error getting prisoners by prison.", err}));
  }
  prisonerHelper.getAllPrisoners(fullBool).then(prisoners => res.status(200).json(prisoners))
=======
    Prison.getPrisonersByPrison(prison, fullBool).then(prisoners => res.status(200).json(prisoners))
      .catch(err => res.status(400).json({msg: "Error getting prisoners by prison.", err}));
  }
  Prisoner.getAllPrisoners(fullBool).then(prisoners => res.status(200).json(prisoners))
>>>>>>> structure-work
    .catch(err => res.status(400).json({msg: "Error getting all prisoners", err})); 
});

router.get('/prisoner/:id/:full?', function(req, res) {
  const { id } = req.params;
  const { full } = req.query;
  const fullBool = (full === 'true');
<<<<<<< HEAD
  prisonerHelper.getPrisonerByID(id, fullBool).then(prisoner => res.status(200).json(prisoner))
=======
  Prisoner.getPrisonerByID(id, fullBool).then(prisoner => res.status(200).json(prisoner))
>>>>>>> structure-work
    .catch(err => res.status(400).json({msg: "Error getting prisoner by ID", err}));
})

router.put('/prisoner', function(req, res, next) {
  const prisoner = req.body;
<<<<<<< HEAD
  prisonerHelper.updatePrisoner(prisoner).then(updatedPrisoner => {
=======
  Prisoner.updatePrisoner(prisoner).then(updatedPrisoner => {
>>>>>>> structure-work
    res.status(200).json({ updatedPrisoner, msg: 'Prisoner updated successfully'})})
      .catch(err => res.status(400).json({msg: "Error updating prisoner", err }))
});

router.delete('/prisoner', function(req, res, next) {
  const { id } = req.body;
<<<<<<< HEAD
  prisonerHelper.deletePrisoner(id).then(deletedRows => { 
=======
  Prisoner.deletePrisoner(id).then(deletedRows => { 
>>>>>>> structure-work
    if (deletedRows < 1) { res.status(400).json({ msg: "No such prisoner" }); }
    else { res.status(200).json({ msg: "Prisoner successfully deleted" }); }})
      .catch(err => res.status(400).json({msg: "Error deleting prisoner", err}));
});

module.exports = router
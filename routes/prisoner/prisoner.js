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
  const { birthName, chosenName, prison, inmateID, releaseDate, bio, status } = req.body;
  Prison.getPrisonByID(prison, false).then(prison => {
    if (prison) {
      Prisoner.createPrisoner({ birthName, chosenName, prison: prison.id, inmateID, releaseDate, bio, status }).then(prisoner =>
        res.status(200).json({ prisoner, msg: 'Prisoner created successfully.' })
      ).catch(err => res.status(400).json({ msg: "Error creating prisoner.", err }));
    } else {
        res.status(400).json( { msg: "Error creating prisoner to non-existent prison."} );
    }
  });
});

// get all prisoners by prison
router.get('/prisoners/:prison?/:full?', function(req, res) {
  const { full, prison } = req.query;
  const fullBool = (full === 'true');
  if (prison) {
    Prison.getPrisonersByPrison(prison, fullBool).then(prisoners => res.status(200).json(prisoners))
      .catch(err => res.status(400).json({msg: "Error getting prisoners by prison.", err}));
  }
  Prisoner.getAllPrisoners(fullBool).then(prisoners => res.status(200).json(prisoners))
    .catch(err => res.status(400).json({msg: "Error getting all prisoners.", err})); 
});

router.get('/prisoner/:id/:full?', function(req, res) {
  const { id } = req.params;
  const { full } = req.query;
  const fullBool = (full === 'true');

  Prisoner.getPrisonerByID(id, fullBool).then(prisoner => res.status(200).json(prisoner))
    .catch(err => res.status(400).json({msg: "Error getting prisoner by ID.", err}));
})

router.put('/prisoner', function(req, res, next) {
  const prisoner = req.body;
  Prisoner.updatePrisoner(prisoner).then(updatedPrisoner => {
    res.status(200).json({ updatedPrisoner, msg: 'Prisoner updated successfully.'})})
      .catch(err => res.status(400).json({msg: "Error updating prisoner.", err }))
});

router.delete('/prisoner', function(req, res, next) {
  const { id } = req.body;

  Prisoner.deletePrisoner(id).then(deletedRows => { 
    if (deletedRows < 1) { res.status(400).json({ msg: "No such prisoner." }); }
    else { res.status(200).json({ msg: "Prisoner successfully deleted." }); }})
      .catch(err => res.status(400).json({msg: "Error deleting prisoner.", err}));
});

module.exports = router
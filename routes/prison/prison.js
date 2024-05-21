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

let Prison;
const db = import ("#db/sql-database.mjs").then(async(res)=>{
    Prison=await res.Prison;
});

// Authentication imports
const jwt = require('jsonwebtoken');
const passport = require('passport');
const passportJWT = require('passport-jwt');
let ExtractJwt = passportJWT.ExtractJwt;
let JwtStrat = require('../../jwt-strategy');
app.use(passport.initialize());

// Create

router.post('/prison', function(req, res, next) {
  const { prisonName, address } = req.body;
  Prison.createPrison({ prisonName, address }).then(prison => res.status(200).json({ msg: 'Prison created successfully', prison }))
    .catch(err => res.status(400).json({message: "Error creating prison", err}));
});

// Read

router.get('/prisons/:full?', function(req, res) {
  const { full } = req.query;
  const fullBool = (full === 'true');
  Prison.getAllPrisons(fullBool).then(prison => res.status(200).json(prison))
    .catch(err => res.status(400).json({msg: 'Error reading all prisons', err})); 
});

router.get('/prison/:id?/:full?', function(req, res) {
  const { id, full } = req.query;
  const fullBool = (full === 'true');
  Prison.getPrisonByID(id, fullBool).then(prison => res.status(200).json(prison))
  .catch(err => res.status(200).json({msg: 'Error reading on prison by ID', err}));
});

// Update
router.put('/prison', function(req, res) {
  const prison = req.body;
  Prison.updatePrison(prison).then(updatedRows => res.status(200).json({updatedRows, newPrison: prison}))
    .catch(err => res.status(400).json({msg: "Error updating prison", err}));
});

router.put('/rule', function(req, res) {
  const { rule, prison } = req.body;
  Prison.addRule(rule, prison).then(result => res.status(200).json({msg: "Rule added to prison", result}))
    .catch(err => res.status(400).json({msg: "Error adding rule to prison", err}));
});

// Delete

router.delete('/prison', function(req, res) {
  const { id } = req.body;
  Prison.deletePrison(id).then(deletedRows => {
    if (deletedRows < 1) { res.status(400).json({ msg: "No such prison" }); }
    else { res.status(200).json({ msg: "Prison successfully deleted" }); }
  })
    .catch(err => {res.status(400).json({msg: "Error deleting prison", err})});
});

module.exports = router;
const express = require('express');
const app = express();
const router = express.Router();

const bodyParser = require('body-parser');

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

let Rule;
const DB = import ("#db/sql-database.mjs").then(async(res)=>{
    Rule=await res.Rule;
});

const passport = require('passport');
const JwtStrat = require('../../jwt-strategy');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

app.use(passport.initialize());
passport.use(JwtStrat);

// Create

router.post('/rule', function(req, res) {
  const {title, description} = req.body
<<<<<<< HEAD
  ruleHelper.createRule({ title, description})
=======
  Rule.createRule({ title, description})
>>>>>>> structure-work
    .then(rule => res.status(200).json({msg: "Successfully created rule", rule}) )
    .catch(err => res.status(400).json({msg: "Error creating rule", err}));
});

// Read

router.get('/rules/:prison?', function(req, res) {
  const { prison } = req.query;
  if (!prison) {
<<<<<<< HEAD
  ruleHelper.getAllRules()
=======
  Rule.getAllRules()
>>>>>>> structure-work
  .then(rules => res.status(200).json(rules))
  .catch(err => res.status(400).json({msg: "Error getting all rules", err}));
  }
  else {
<<<<<<< HEAD
    ruleHelper.getRulesByPrison(prison).then(rules => res.status(200).json(rules))
=======
    Rule.getRulesByPrison(prison).then(rules => res.status(200).json(rules))
>>>>>>> structure-work
      .catch(err => {
        let sqliteError = ""
        // if (err.original.errno === 1) { sqliteError =  "That prison doesn't exist."}
        res.status(400).json({msg: "Error getting rules by prison.", err})}
      )
  }
});

router.get('/rule/:id?/:full?', function(req, res){
  const { id, full } = req.query;
  const fullBool = (full === 'true');
<<<<<<< HEAD
  ruleHelper.getRuleByID(id, fullBool)
=======
  Rule.getRuleByID(id, fullBool)
>>>>>>> structure-work
  .then(rule => res.status(200).json(rule))
  .catch(err => res.status(400).json({msg: "Error getting rule by ID", err}));
});

// Update

router.put('/rule', function(req, res){
  const rule = req.body;
  console.log(rule)
<<<<<<< HEAD
  ruleHelper.updateRule(rule).then(updatedRows => {
=======
  Rule.updateRule(rule).then(updatedRows => {
>>>>>>> structure-work
    res.status(200).json({msg: "Rule succeessfully updated", updatedRows, newRule: rule})}
  ).catch(err => res.status(400).json({msg: "Error updating rule", err}))
});

// Delete

router.delete('/rule', async function(req, res){
  const { id } = req.body;
<<<<<<< HEAD
  ruleHelper.deleteRule(id).then(deletedRows => {
=======
  Rule.deleteRule(id).then(deletedRows => {
>>>>>>> structure-work
    if (deletedRows < 1) { res.status(400).json({msg: "No such rule"}) }
    else { res.status(200).json({ msg: "Deleted rule", deletedRows}); };
  }).catch(err => {res.status(200).json({ msg: "Error deleting rule", err })});
});

module.exports = router
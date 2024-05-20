const express = require('express');
const app = express();
const router = express.Router();

const bodyParser = require('body-parser');

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const ruleHelper = require('./rule.helper');

const passport = require('passport');
const JwtStrat = require('../../jwt-strategy');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

app.use(passport.initialize());
passport.use(JwtStrat);

// Create

router.post('/rule', function(req, res) {
  const {title, description} = req.body
  ruleHelper.createRule({ title, description})
    .then(rule => res.status(200).json({msg: "Successfully created rule", rule}) )
    .catch(err => res.status(400).json({msg: "Error creating rule", err}));
});

// Read

router.get('/rules/:full?', function(req, res) {
  const { full } = req.query;
  const fullBool = (full === 'true');
  ruleHelper.getAllRules(fullBool)
  .then(rules => res.status(200).json(rules))
  .catch(err => res.status(400).json({msg: "Error getting rules", err}));
});

router.get('/rule/:id?/:full?', function(req, res){
  const { id, full } = req.query;
  const fullBool = (full === 'true');
  ruleHelper.getRuleByID(id, fullBool)
  .then(rule => res.status(200).json(rule))
  .catch(err => res.status(400).json({msg: "Error getting rule by ID", err}));
});

// Update

router.put('/rule', function(req, res){
  const rule = req.body;
  console.log(rule)
  ruleHelper.updateRule(rule).then(updatedRows => {
    res.status(200).json({msg: "Rule succeessfully updated", updatedRows, newRule: rule})}
  ).catch(err => res.status(400).json({msg: "Error updating rule", err}))
});

// Delete

router.delete('/rule', async function(req, res){
  const { id } = req.body;
  ruleHelper.deleteRule(id).then(deletedRows => {
    if (deletedRows < 1) { res.status(400).json({msg: "No such rule"}) }
    else { res.status(200).json({ msg: "Deleted rule", deletedRows}); };
  }).catch(err => {res.status(200).json({ msg: "Error deleting rule", err })});
});

module.exports = router
const express = require('express');
const app = express();
const router = express.Router();

const bodyParser = require('body-parser');

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

let Rule;
let authService;
const DB = import ("#db/sql-database.mjs").then(async(res)=>{
    Rule=await res.Rule;
    authService= await import("#rtServices/auth.services.mjs").then((module)=>{return module.default;});


const passport = require('passport');
const JwtStrat=authService.authorize;
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

app.use(passport.initialize());
passport.use(JwtStrat);

// Create

router.post('/rule', function(req, res) {
  const {title, description} = req.body;

  Rule.createRule({ title, description})
    .then(rule => res.status(200).json({msg: "Successfully created rule", rule}) )
    .catch(err => res.status(400).json({msg: "Error creating rule", err}));
});

// Read

router.get('/rules/:prison?', function(req, res) {
  const { prison } = req.query;
  if (!prison) {
  Rule.getAllRules()
  .then(rules => res.status(200).json(rules))
  .catch(err => res.status(400).json({msg: "Error getting all rules", err}));
  }
  else {

    Rule.getRulesByPrison(prison).then(rules => res.status(200).json(rules))
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

  Rule.getRuleByID(id, fullBool)
  .then(rule => res.status(200).json(rule))
  .catch(err => res.status(400).json({msg: "Error getting rule by ID", err}));
});

// Update

router.put('/rule', function(req, res){
  const rule = req.body;
  console.log(rule)

  Rule.updateRule(rule).then(updatedRows => {
    res.status(200).json({msg: "Rule succeessfully updated", updatedRows, newRule: rule})}
  ).catch(err => res.status(400).json({msg: "Error updating rule", err}))
});

// Delete

router.delete('/rule', async function(req, res){
  const { id } = req.body;

  Rule.deleteRule(id).then(deletedRows => {
    if (deletedRows < 1) { res.status(400).json({msg: "No such rule"}) }
    else { res.status(200).json({ msg: "Deleted rule", deletedRows}); };
  }).catch(err => {res.status(200).json({ msg: "Error deleting rule", err })});
});
});
module.exports = router

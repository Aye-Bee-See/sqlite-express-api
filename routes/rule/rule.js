const express = require('express');
const app = express();
const router = express.Router();

const bodyParser = require('body-parser');

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const ruleHelper = require('../../database/helpers/rule.helper');

const passport = require('passport');
const JwtStrat = require('../../jwt-strategy');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

app.use(passport.initialize());
passport.use(JwtStrat);

router.post('/rule', function(req, res) {
  const {prison, title, description} = req.body
  ruleHelper.createRule({prison, title, description})
    .then(rule => {  res.json({rule, msg: "Successfully created rule"})})
});

router.get('/rules', function(req, res) {
  ruleHelper.getAllRules().then(rules => res.json(rules)); 
});

router.get('/rule', function(req, res){
  const { id } = req.body;
  ruleHelper.getRuleByID(id).then(rule => res.json(rule));
});

module.exports = router
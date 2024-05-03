const Rule = require('../../sql-database').Rule;
const Prison = require('../../sql-database').Prison;

const createRule = async function({ prison, title, description }){
  return await Rule.create({ prison, title, description  })
}

const getAllRules = async function(){
  return await Rule.findAll()
}

const getRuleByID = async function(id) {
  return await Prisoner.findOne({
  where: {id: id},
});
};

module.exports = { createRule, getAllRules, getRuleByID }
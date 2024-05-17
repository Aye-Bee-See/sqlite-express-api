const {Rule,Prison} = import('../sql-database.mjs');

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
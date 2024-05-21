const { Rule, Prison, Prisoner} = require('../../sql-database');

const createRule = async ({ prison, title, description }) => {
  return await Rule.create({ prison, title, description  })
}

const getAllRules = async (full) => {
  if (full) {
    return await Rule.findAll({
      include: [
        {
          model: Prison,
          as: 'prisons'
        }
      ]
    })
  }
  else {
    return await Rule.findAll({})
  }
};

const getRulesByPrison = async (prison) => {
    return await Rule.findAll({
      include: [
        {
          model: Prison,
          as: 'prisons',
          where: {
            id: prison
          }
        },
      ]
    });
}

const getRuleByID = async (id, full) => {
  if (full) {
    return await Rule.findOne({
      where: {id: id},
      include: [
        {
          model: Prison,
          as: 'prisons'
        }
      ]
    })
  }
  else {
  return await Prisoner.findOne({
  where: {id: id},
})
  };
};

const updateRule = async (newRule) => {
    return await Rule.update({...newRule}, {where: {id: newRule.id}} );
};

const deleteRule = async (id) => {
  return await Rule.destroy({ where: {id: id}, force: true });
};

module.exports = {  createRule, 
                    getAllRules, getRulesByPrison, getRuleByID,
                    updateRule,
                    deleteRule
                     }
const { Prison, Prisoner, Rule } = require('../../sql-database');

// Create

const createPrison = async ({ prisonName, address }) => {
  return await Prison.create({ prisonName, address })
};

const getAllPrisons = async (full) => {
  if (full) {
    return await Prison.findAll({
      include: [{
        model: Prisoner,
        as: "prisoners"
      },
      {
        model: Rule,
        as: 'rules'
      }
    ]
    });
  }
  else {
    return await Prison.findAll();
  };
};

// Read

const getPrisonByID = async (id, full) => {
  if (full) {
    return await Prison.findOne({
      include: [{ 
        model: Prisoner,
        as: 'prisoners'
      },
      {
        model: Rule,
        as: 'rules'
      }
    ],
      where: {id: id},
    });
  }
  else {
    return await Prison.findOne({
      where: { id: id }
    });
  };
};

// Update

const updatePrison = async (prison) => {
  return await Prison.update({...prison}, { where: {id: prison.id}});
};

const addRule = async (rule, prison) => {
  Rule.findOne({
    where: { id: rule}
  }).then(rule => {
    Prison.findOne({
      where: {id: prison}
    }).then(prison => {
      rule.addPrison(prison)
    })
  })
};

// Delete

// TODO: deleting prison currently deletes all prisoners attached to this prison, change this
const deletePrison = async (id) => {
  return await Prison.destroy({
    where: { id: id },
    force: true
  });
};

module.exports = {createPrison, addRule,
                  getAllPrisons, getPrisonByID,
                  updatePrison,
                  deletePrison}
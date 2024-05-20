const { Prison, Prisoner, Rule } = require('../../sql-database');

// Create

const createPrison = async ({ prisonName, address }) => {
  return await Prison.create({ prisonName, address, deleted: false });
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
  } else {
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
    });
  });
};

// Delete

const deletePrison = async (id) => {
  Prison.update({deleted: true}, { where: {id: id} })
};

module.exports = {createPrison, addRule,
                  getAllPrisons, getPrisonByID,
                  updatePrison,
                  deletePrison}
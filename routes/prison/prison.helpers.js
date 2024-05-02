const Prison = require('../../sql-database').Prison;

const createPrison = async ({ prisonName, address }) => {
  return await Prison.create({ prisonName, address })
}

const getAllPrisons = async () => {
  return await Prison.findAll();
};

const getPrisonByID = async function(id) {
  return await Prison.findOne({
  include: { 
    model: Prisoner,
    as: 'prisoners'
  },
  where: {id: id},
});
};

module.exports = {createPrison, getAllPrisons, getPrisonByID}


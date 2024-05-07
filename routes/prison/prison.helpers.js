const {Prison, Prisoner} = require('../../sql-database');

const createPrison = async ({ prisonName, address }) => {
  return await Prison.create({ prisonName, address })
}

const getAllPrisons = async (full) => {
  if (full) {
    return await Prison.findAll({
      include: {
        model: Prisoner,
        as: "prisoners"
      }
    });
  }
  else {
    return await Prison.findAll();
  }

};

const getPrisonByID = async (id, full) => {
  if (full) {
    return await Prison.findOne({
      include: { 
        model: Prisoner,
        as: 'prisoners'
      },
      where: {id: id},
    });
  }
  else {
    return await Prison.findOne({
      where: { id: id }
    });
  }

};

module.exports = {createPrison, getAllPrisons, getPrisonByID}
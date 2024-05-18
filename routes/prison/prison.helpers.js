const { Prison, Prisoner } = require('../../sql-database');

// Create

const createPrison = async ({ prisonName, address }) => {
  return await Prison.create({ prisonName, address })
};

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
  };
};

// Read

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
  };
};

// Update

const updatePrison = async (prison) => {
  return await Prison.update({...prison}, { where: {id: prison.id}});
};

// Delete

// TODO: deleting prison currently deletes all prisoners attached to this prison, change this
const deletePrison = async (id) => {
  return await Prison.destroy({
    where: { id: id },
    force: true
  });
};

module.exports = {createPrison, 
                  getAllPrisons, getPrisonByID,
                  updatePrison,
                  deletePrison}
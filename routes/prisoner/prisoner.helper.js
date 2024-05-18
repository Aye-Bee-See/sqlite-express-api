const { bio } = require('./prisoner.model');

const Prisoner = require('../../sql-database').Prisoner;
const Prison = require('../../sql-database').Prison;

const createPrisoner = async ({ birthName, chosenName, prison_id, inmateID, releaseDate, bio }) => {
  return await Prisoner.create({ birthName, chosenName, prison_id, inmateID, releaseDate, bio })
}

const getAllPrisoners = async (full) => {
  if (full) {
  return await Prisoner.findAll({
    include: [
      {
        model: Prison,
        as: 'prison_details', 
        key: 'prison_key'
      }
      ]
  })}
  else {
    return await Prisoner.findAll();
  };
};

const getPrisonerByID = async (id, full) => {
  if (full) {
    return await Prisoner.findOne({
      include: [
        {
          model: Prison,
          as: 'prison'
        }
      ],
      where: {id: id},
    });
  }
  else {
    return await Prisoner.findOne({
      where: {id: id},
    });
  }

};

const updatePrisoner = async function(newPrisoner) {
  return await Prisoner.update({...newPrisoner}, { where: {id: newPrisoner.id}})
}

const addPrisonerToPrison = async function(id, prison) {
  return await Prisoner.update({
    prison: prison
  }, {where: {id: id}}).then(updatedPrisoner => {
    return updatedPrisoner;
  })
}

module.exports = { createPrisoner, getAllPrisoners, getPrisonerByID, updatePrisoner, addPrisonerToPrison }
const { bio } = require('./prisoner.model');

const { Prisoner, Prison, Chat } = require('../../sql-database')

// Create

const createPrisoner = async ({ birthName, chosenName, prison_id, inmateID, releaseDate, bio }) => {
  return await Prisoner.create({ birthName, chosenName, prison_id, inmateID, releaseDate, bio });
}

// Read

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

const getPrisonersByPrison = async (prisonId, full) => {
  if (full) {
    return await Prisoner.findAll({
      include: [
        {
          model: Chat,
          as: "chats"
        }
      ],
      where: {prison_id: prisonId}     
    })
  } 
  else {
    return await Prisoner.findAll({
      where: { prison_id: prisonId }
    })
  };
};

// Update

const updatePrisoner = async function(newPrisoner) {
  return await Prisoner.update({...newPrisoner}, { where: {id: newPrisoner.id}});
};

// Delete

const deletePrisoner = async (id) => {
  return await Prisoner.destroy({
    where: {id: id}
  });
};

module.exports = {  createPrisoner, 
                    getAllPrisoners, getPrisonerByID, getPrisonersByPrison,
                    updatePrisoner,
                    deletePrisoner }
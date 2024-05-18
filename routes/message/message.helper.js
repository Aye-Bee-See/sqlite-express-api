const { Prisoner, Chat, Message, User } = require('../../sql-database');

// Create
const createChat = async function({ user, prisoner }) {
  return await Chat.create({ user, prisoner});
};

const createMessage = async (chat, messageText, sender ) => {
  return await Message.create(chat, messageText, sender);
};

// Read

const readAllChats = async (full) => {
  if (full) {
    return await Chat.findAll({
      include: [
        {
          model: Message,
          as: 'messages',
          key: 'chat_key'
        },
        {
          model: User,
          as: 'userDetails'
        },
        {
          model: Prisoner,
          as: 'prisonerDetails'
        }
      ]
    });
  } else {
    return await Chat.findAll({});
  };
};

const readChatsByUser = async (id, full) => {
  if (full) {
  return await Chat.findAll({
    where: {user: id},
    include: [
      {
        model: Message,
        as: 'messages'
      },
      {
        model: User,
        as: 'user'
      },
      {
        model: Prisoner,
        as: 'prisoner'
      }
    ]
  });
}
else {
  return await Chat.findAll({
    where: {user: id}
  })
};
};

const readChatsByPrisoner = async (id, full) => {
  if (full) {
    return await Chat.findAll({
      where: {prisoner: id},
      include: [
        {
          model: Message,
          as: 'messages'
        },
        {
          model: User,
          as: 'user'
        },
        {
          model: Prisoner,
          as: 'prisoner'
        }
      ]
    });
  }
  else {
    return await Chat.findAll({
      where: {prisoner: id}
    });
  };
};

const readChatsByUserAndPrisoner = async (user, prisoner, full) => {
  if (full) {
    return await Chat.findOne({
      where: {user: user, prisoner: prisoner},
      include: [
        {
          model: Message,
          as: 'messages'
        },
        {
          model: User,
          as: 'userDetails'
        },
        {
          model: Prisoner,
          as: 'prisonerDetails'
        }
      ]
    });
  }
  else {
    return await Chat.findOne({
      where: {user: user, prisoner: prisoner}
    });
  };
}

const readChatById = async (id, full) => {
  if (full) {
    return await Chat.findAll({
      where: {id: id},
      include: [
        {
          model: Message,
          as: 'messages'
        },
        {
          model: User,
          as: 'user'
        },
        {
          model: Prisoner,
          as: 'prisoner'
        }
      ]
    });
  }
  else {
    return await Chat.findAll({
      where: {id: id}
    })
  }
};

const readAllMessages = async function() {
  return await Message.findAll();
};

const readMessageById = async function(id) {
  return await Message.findAll({
    where: {id: id}
  });
};

const ReadMessagesByChat = async (id) => {
  return await Message.findAll({
    where: {chat: id}
  });
};

const findOrCreateChat = async (user, prisoner) => {
  return await Chat.findOrCreate({ where: {user: user, prisoner: prisoner}, defaults: {user: user, prisoner: prisoner}, paranoid: false });
}

// Update

const updateChat = async (chat) => {
  const user = chat.user;
  const prisoner = chat.prisoner;
  return await Chat.update({...chat}, { where: {id: chat.id}}).then( updatedChat =>
    Message.update({user: user, prisoner: prisoner}, {where: {chat: updatedChat}})
  );
};

const updateMessage = async (message) => {
  return await Message.update({...message}, { where: {id: message.id}});
};

// Delete

const deleteChat = async (id) => {
  var destroyedChats = 0;
  await Message.destroy({
    where: {
      chat: id
    }
  }).then(await Chat.destroy({ where: {id: id} }).then(dc => {destroyedChats = dc}));
  return destroyedChats;
};

const deleteMessage = async (id) => {
  return await Message.destroy({
    where: { id: id },
    force: true
  })
};

module.exports = {  createChat, createMessage, 
                    readAllChats, readChatsByUser, readChatsByPrisoner, readChatById, readAllMessages, ReadMessagesByChat, readMessageById, findOrCreateChat, readChatsByUserAndPrisoner,
                    updateChat, updateMessage,
                    deleteChat,deleteMessage
                  };
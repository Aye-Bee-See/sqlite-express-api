const { prisoner } = require('#schemas/chat.schema.js');

const {Chat,Message,User} = import('../sql-database.mjs');

const createChat = async function({ user, prisoner }) {
  return await Chat.create({ user, prisoner});
};

const readAllChats = async (full) => {
  if (full) {
    return await Chat.findAll({
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
    })
  } else {
    return await Chat.findAll({});
  }
};

const readChatsByUser = async function(id, full) {
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
}
};

const readChatsByPrisoner = async function(id, full) {
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
    })
  }
};

const readChatById = async function(id, full) {
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

const updateChat = async function(chat) {
  return await Chat.update({...chat}, { where: {id: chat.id}});
}

const deleteChat = async function(id) {
  const chat = Chat.readChat(id);

  if (chat == null) { return null };
  
  return await chat.destroy().then(Message.destroy({
    where: {
      chat: id
    }
  }));
};

const createMessage = async function({ chat, messageText, sender }) {
  return await Message.create({ chat, messageText, sender });
};

const readAllMessages = async function() {
  return await Message.findAll();
};

const readMessagesById = async function(id) {
  return await Message.findAll({
    where: {id: id}
  });
};

const ReadMessagesByChat = async function(id) {
  return await Message.findAll({
    where: {chat: id}
  });
};

const updateMessage = async function({ message }) {
  return await Message.update({...message}, { where: {id: message.id}});
}

module.exports = { createChat, readAllChats, readChatsByUser, readChatsByPrisoner, readChatById, updateChat, deleteChat,
                  createMessage, readAllMessages, ReadMessagesByChat, readMessagesById, updateMessage };
// TODO: Handle not found errors

const express = require('express');
const app = express();
const router = express.Router();

const bodyParser = require('body-parser');

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const messageHelper = require('./message.helper');

const passport = require('passport');
const JwtStrat = require('../../jwt-strategy');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { chat } = require('./message.model');

app.use(passport.initialize());
passport.use(JwtStrat);

router.get('/', function(req, res) {
  res.status(200).json({ msg: 'Messaging is up!' });
});

// TODO: Add catches to all routes

// Create

// find or create chat
router.post('/chat', function(req, res) {
  const {user, prisoner} = req.body;
  messageHelper.findOrCreateChat(user, prisoner)
    .then(chat => {  res.status(200).json({created_new: chat[1], msg: "Successfully created or found chat", chat: chat})})
    .catch(err => {
      console.log(err);
      res.status(400).json(err)
    })
});

// find or create chat, create message
router.post('/message', function(req, res) {
  const { messageText, sender, prisoner, user } = req.body;
  messageHelper.findOrCreateChat(user, prisoner).then(foundOrCreatedChat => {
    const chat = foundOrCreatedChat[0].id;
    messageHelper.createMessage({ chat, messageText, sender, prisoner, user }).then(message => {
      res.status(200).json({message, msg: "Message successfully created"});
    }).catch(err => {res.status(400).json(err)});
  })
});

// Read

// get all chats
router.get('/chats/:full?', function(req, res) {
  const { full } = req.query;
  const fullBool = (full === 'true');
  messageHelper.readAllChats(fullBool).then(chats => res.status(200).json(chats))
  .catch(err => res.status(400).json({msg: "Error getting all chats", err}));
});

router.get('/messages/:full?', function(req, res) {
  const { full } = req.query;
  const fullBool = (full === 'true');
  messageHelper.readAllMessages(fullBool).then(messages => res.status(200).json(messages))
    .catch(err => res.status(400).json({msg: "Error getting all messages", err}))
})

// get chats by user or prisoner or id
router.get('/chat/:id?/:user?/:prisoner?/:full?', function(req, res) {
  console.log(req.query);
  const { full } = req.query;
  const fullBool = (full === 'true');
  const { id, user, prisoner } = req.query;
  if ( id == null && user == null && prisoner == null) { res.status(401).json({msg: "No id, user, or prisoner provided"}) }
  else if (id != null) {
  messageHelper.readChatById(id, fullBool).then(chat => res.status(200).json(chat))
    .catch(err => res.status(400).json({msg: "Error reading chat: " + id, err}));
  }
  else if (user != null & prisoner != null) {
    messageHelper.readChatsByUserAndPrisoner(user, prisoner, fullBool).then(chat => res.status(200).json(chat))
    .catch(err => res.status(400).json({msg: "Error reading chats by user and prisoner", err}));
  }
  else if (user != null) {
    messageHelper.readChatsByUser(user, fullBool).then(chat => res.status(200).json(chat))
    .catch(err => res.status(400).json({msg: "Error reading chats by user", err}));
  }
  else if (prisoner != null) { 
    messageHelper.readChatsByPrisoner(prisoner, fullBool).then(chat => res.status(200).json(chat))
    .catch(err => res.status(400).json({msg: "Error reading chats by prisoner", err}));
   }
});

router.get('/messages/:id?/:chat?/:prisoner?/:user?', function(req, res) {
  const { id, chat, prisoner, user } = req.query;
  if ( id == null && user == null && prisoner == null && chat == null) { res.status(400).json({msg: "No id, user, or prisoner provided"}) }
  else if (id != null) {
  messageHelper.readMessageById(id).then(chat => res.status(200).json(message))
  .catch(err => res.status(400).json({msg: "Error reading message by id", err}));
  }
  else if (chat != null) {
    messageHelper. readMessagesByChat(chat).then(chat => res.status(200).json(message))
    .catch(err => res.status(400).json({msg: "Error reading messages by chat", err}));
  }
  else if (prisoner != null) {
    messageHelper.readMessagesByPrisoner(chat).then(messages => res.status(200).json({messages}))
    .catch(err => res.status(400).json({msg: "Error reading messages by prisoner.", err}));
  }
  else if (user != null) {
    messageHelper.readMessagesByUser(chat).then(messages => res.status(200).json({messages}))
    .catch(err => res.status(400).json({msg: "Error reading messages by user.", err}));
  }
});

// Update

router.put('/chat', function(req, res) {
  const chat = req.body;
  messageHelper.updateChat(chat).then(updatedChat => res.status(200).json({ updatedChat, msg: "Chat successfully updated"}))
});

router.put('/message', function(req, res) {
  const message = req.body;
  messageHelper.updateMessage(message).then(updatedMessage => res.status(200).json({updatedMessage, msg: "Message successfully updated"}))
})

router.delete('/chat', function(req, res) {
  const { id } = req.body;
  messageHelper.deleteChat(id).then( deletedRows => {
    console.log(deletedRows);
    if (deletedRows < 1) { res.status(400).json({ msg: "No such chat" }) }
    else { res.status(200).json({ msg: "Chat successfully deleted" }) }
  } )
});

router.delete('/message', function(req, res) {
  const { id } = req.body;
  messageHelper.deleteMessage(id).then( deletedRows => {
    if (deletedRows < 1) { 
      res.status(400).json({ msg: "No such message" }); }
    else { 
      res.status(200).json({ msg: "Message successfully deleted" });
      console.log(chat); }
  }
 ).catch(err => res.status(400).status({msg: "Error deleting message", err}));
});

module.exports = router;
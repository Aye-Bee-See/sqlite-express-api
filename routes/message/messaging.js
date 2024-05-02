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
  res.json({ msg: 'Messaging is up!' });
});

router.post('/chat', function(req, res) {
  const {user, prisoner} = req.body;
  messageHelper.createChat({ user, prisoner })
    .then(chat => {  res.json({chat, msg: "Successfully created chat"})});
});

router.get('/chats', function(req, res) {
  messageHelper.readAllChats().then(chats => res.status(200).json(chats));
});

router.get('/chat', function(req, res) {
  const { id, user, prisoner } = req.body;
  if ( id == null && user == null && prisoner == null) { res.status(401).json({msg: "No id, user, or prisoner provided"}) }
  else if (id != null) {
  messageHelper.readChatById(id).then(chat => res.status(200).json(chat));
  }
  else if (user != null) {
    messageHelper.readChatsByUser(user).then(chat => res.status(200).json(chat))
  }
  else if (prisoner != null) { 
    messageHelper.readChatsByPrisoner(prisoner).then(chat => res.status(200).json(chat))
   }
});

router.put('/chat', function(req, res) {
  const { chat } = req;
  messageHelper.updateChat(chat).then(updatedChat => res.status(200).json({ updatedChat, msg: "Chat successfully updated"}))
});

router.delete('/chat', function(req, res) {
  const { id } = req.body;
  messageHelper.deleteChat(id).then( chat => {
    if (chat == null) { res.status(401).json({ msg: "No such chat" }) }
    else { res.status(200).json({ msg: "Chat successfully deleted" }) }
  } )
});
// TODO: Check if chat between these users already exists
router.post('/message', function(req, res) {
  const { chat, messageText, sender  } = req.body;
  messageHelper.createMessage({ chat, messageText, sender }).then(message => res.status(200).json({ message, msg: "Message created" }));
});

router.get('/messages', function(req, res) {
  messageHelper.readAllMessages().then(messages => res.status(200).json({messages}));
});

router.get('/message', function(req, res) {
  const { id, chat } = req.body;
  if ( id == null && user == null && prisoner == null) { res.status(401).json({msg: "No id, user, or prisoner provided"}) }
  else if (id != null) {
  messageHelper.readMessagesById(id).then(chat => res.status(200).json(message));
  }
  else if (chat != null) {
    messageHelper.ReadMessagesByChat(chat).then(chat => res.status(200).json(message));
  }
});

router.put('/message', function(req, res) {
  const { message } = req;
  messageHelper.updateMessage(message).then(updatedMessage => res.status(200).json({ updatedMessage, msg: "Chat successfully updated"}))
});

router.delete('/message', function(req, res) {
  const { id } = req.body;
  messageHelper.deleteChat(message).then( chat => {
    if (chat == null) { res.status(401).json({ msg: "No such message" }) }
    else { res.status(200).json({ msg: "Chat successfully deleted" }) }
  } )
});

module.exports = router;
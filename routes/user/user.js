const express = require('express');
const app = express();
const router = express.Router();

const bodyParser = require('body-parser');

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

let User;
const db = import ("#db/sql-database.mjs").then(async(res)=>{
    User=await res.User;
});



const passport = require('passport');
const JwtStrat = require('../../jwt-strategy');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const e = require('express');

app.use(express.urlencoded({ extended: false }));

app.use(passport.initialize());
passport.use(JwtStrat);

const stripPassword = function(userList) {
  return userList.map(function(user) { return { id: user.id, email: user.email, name: user.name, role: user.role } } );
};


// Create

// register admin route
router.post('/user', async function(req, res, next) {
  // const hashedPass = await bcrypt.hash(req.body.password, 10);
  const { name, email, password } = req.body;
  const role = req.body.role.toLowerCase();

  User.getUserByNameOrEmail(name, email, false).then(user => {
      User.createUser({ name, password, role, email }).then(user => { 
      const strippedPassword = stripPassword([user])[0];
      res.status(200).json({ msg: "User successfully created", user: strippedPassword });
  }).catch(err => { res.status(400).json({message: err.message}); }); 
  }).catch(err => res.status(400).json({msg: "Error checking if user exists", err}));
});

// Read

// get all users
router.get('/users/:role?/:full?', function(req, res, next) {
  const { role, full } = req.query;
  const fullBool = (full === 'true');

  if (role) {
    User.getUsersByRole(role, fullBool).then (users => {
      const filteredUsers = stripPassword(users);
      res.status(200).json(filteredUsers);
    }).catch(err => res.status(400).json({msg: "Error getting users by role", err}));
  }
  else {
  User.getAllUsers(fullBool).then(users => {
    const filteredUsers = stripPassword(users);
    if (users.length > 0) { res.status(200).json(filteredUsers) }
    else { res.status(400).json({ msg: "Zero users exist in the database." }) };
    }).catch(err => { res.status(400).json({msg: "Error retrieving user list", err}) }); 
  }
});

// get one user
router.get('/user/:id?/:email?/:name?/:full?', function(req, res) {
  const { id, email, name, full } = req.query;
  const fullBool = (full === 'true');

  if (id === null && email === null && name === null ) { res.status(200).json({msg: "No ID or email provided"}) }
  else if (id) {
    User.getUserByID(id, fullBool).then(user => {
      const strippedPassword = stripPassword([user])[0];
      if (user) { res.status(200).json({user: strippedPassword}) }
      else { res.status(400).json({msg: "Error: No such user ID."}) }
      }
      )
      .catch (err => { res.status(400).json({msg: "Error getting user by ID", err}) })
  }
  else if (email) {
    User.getUserByEmail(email, fullBool).then(user => {
      const strippedPassword = stripPassword([user])[0];
      if (user) { res.status(200).json({user: strippedPassword}) }
      else { res.status(400).json({msg: "Error: No such user email."}) };
    }
  ).catch(err => { res.status(400).json({msg: "Error getting user by email", err}) })
  }
  else {
    User.getUserByName(name, fullBool).then(user => {
      const strippedPassword = stripPassword([user])[0];
      if (user) { res.status(200).json({user: strippedPassword}) }
      else { res.status(400).json({msg: "Error: No such user email."}) };
    }).catch(err => res.status(200).json({msg: "Error getting user by name", err}))
  }
});

// Update

router.put('/user', async function(req, res) {
  const newUser = req.body;
  User.updateUser(newUser).then(updatedRows => res.status(200).json({ msg: "Updated user", updatedRows ,newUser })
  ).catch(err => {res.status(400).json({ msg: "Error updating user", err })});
});

// Delete

router.delete('/user', async function(req, res) {
  const { id } = req.body;
  User.deleteUser(id).then(deletedRows => {
    res.status(200).json({ msg: "Deleted user", deletedRows});
  }).catch(err => {res.status(200).json({ msg: "Error deleting user", err })});
});

// protected route
router.get('/protected', passport.authenticate('jwt', { session: false }), function(req, res) {
  res.status(200).json({ msg: 'Congrats! You are seeing this because you are authorized.'});
  });

// login route
router.post('/login', async function(req, res, next) { 
  const { name, password } = req.body;
  if (name && password) {
    let user = await User.getUser({ name });
    if (!user) {
      res.status(400).json({ msg: 'No such user or associated password found.', user }
    )
    }
    else {
      const match = await bcrypt.compare(req.body.password, user.password);
      if (match) {
      // from now on we’ll identify the user by the id and the id is
      // the only personalized value that goes into our token

      // TODO: Add expiration to token
      // https://stackoverflow.com/questions/40187770/passport-jwt-token-expiration
      let payload = { id: user.id };
      //TODO: Better secret than this, hide it in a .env file
      let token = jwt.sign(payload, 'wowwow');
      res.status(200).json({ msg: 'ok', token });
      }
      else {
        res.status(400).json({ msg: 'No such user or associated password found.' });
      };
    };
  } else {
    res.status(400).json({msg: 'Call must contain both username and password'});
  };
});

module.exports = router;
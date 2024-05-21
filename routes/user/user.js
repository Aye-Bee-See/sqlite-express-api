const express = require('express');
const app = express();
const router = express.Router();

const bodyParser = require('body-parser');

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
let User;
const DB=import('../../database/sql-database.mjs');
DB.then(async(res)=>{
    User=await res.User;
});

//const User = import('../../database/models/user.model.mjs');
console.log(User);
//const userHelper=User? User(User):null;
const passport = require('passport');
const JwtStrat = require('../../jwt-strategy');
const jwt = require('jsonwebtoken');

app.use(passport.initialize());
passport.use(JwtStrat);

router.get('/', function(req, res) {
  res.status(200).json({ message: 'Auth is up!' });
});

// get all admins
router.get('/users/:full?', function(req, res, next) {
  const { full } = req.query;
  const fullBool = (full === 'true');
  User.getAllUsers(fullBool).then(users => {
    if (users.length > 0) { res.status(200).json(users) }
    else { res.status(400).json({ error: "Zero users exist in the database." }) }
    }); 
});

// get one user
router.get('/user/:id/:full?', passport.authenticate('jwt', {session: false}), function(req, res) {
  const { id } = req.params;
  const { full } = req.query;
  const fullBool = (full === 'true');

  User.getUserByID(id, fullBool).then(user => {
  if (user) { res.status(200).json(user) }
  else { res.status(400).json({message: "Error: No such user."}) }
  }
  )
})

// register admin route
router.post('/register-admin', async function(req, res, next) {
  const role = "Admin"
  const { name, email, password } = req.body;

  User.getUserByNameOrEmail(name, email, false).then(user => {
 
      User.createUser({ name, password, role, email }).then(user => { 
      res.status(200).json({ name, role, email, message: 'Account created successfully.' });
  }
  ).catch(err => {
    res.status(400).json({message: err.message});
  }); 
  })
});

// login route
router.post('/login', async function(req, res, next) { 
    const bcrypt = require('bcrypt');
  const { name, password } = req.body;
  if (name && password) {
    console.log(User);
    let user = await User.getUser({ name });
    if (!user) {
      res.status(401).json({ msg: 'No such user or associated password found.', user });
    }
    else {
      const match = await bcrypt.compare(req.body.password, user.password)
      if (match) {
      // from now on we’ll identify the user by the id and the id is
      // the only personalized value that goes into our token

      // TODO: Add expiration to token
      // https://stackoverflow.com/questions/40187770/passport-jwt-token-expiration
      let payload = { id: user.id };
      //TODO: Better secret than this, hide it in a .env file
      let token = jwt.sign(payload, 'wowwow');
      res.status(200).json({ message: 'ok', token: token });
      }
      else {
        res.status(400).json({ message: 'No such user or associated password found.' });
      }
    }

  }
});

// protected route
router.get('/protected', passport.authenticate('jwt', { session: false }), function(req, res) {
  res.status(200).json({ msg: 'Congrats! You are seeing this because you are authorized.'});
  });


module.exports = router;
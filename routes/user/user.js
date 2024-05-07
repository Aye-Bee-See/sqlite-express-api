const express = require('express');
const app = express();
const router = express.Router();

const bodyParser = require('body-parser');

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const userHelper = require('./user.helper')

const passport = require('passport');
const JwtStrat = require('../../jwt-strategy');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

app.use(passport.initialize());
passport.use(JwtStrat);

router.get('/', function(req, res) {
  res.json({ message: 'Auth is up!' });
});

// get all admins
router.get('/users/:full?', function(req, res) {
  const { full } = req.query;
  const fullBool = (full === 'true');
  userHelper.getAllUsers(fullBool).then(user => res.json(user)); 
});

// get one user
router.get('/user/:id/:full?', passport.authenticate('jwt', {session: false}), function(req, res) {
  const { id } = req.params;
  const { full } = req.query;
  const fullBool = (full === 'true');
  userHelper.getUserByID(id, fullBool).then(user => res.json(user))
})

// register admin route
// TODO: Check if name or email already exists
// TODO: Don't show hashed password in response
router.post('/register-admin', async function(req, res, next) {
  const role = "Admin"
  const password = await bcrypt.hash(req.body.password, 10);
  const { name, email } = req.body;

  userHelper.createUser({ name, password, role, email }).then(user =>
    res.json({ user, msg: 'account created successfully' })
  );
});

// login route
// TODO: Don't reveal whether user or password is incorrect
router.post('/login', async function(req, res, next) { 
  const { name, password } = req.body;
  if (name && password) {
    
    let user = await userHelper.getUser({ name });
    if (!user) {
      res.status(401).json({ msg: 'No such user found', user });
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
      res.json({ msg: 'ok', token: token });
      }
      else {
        res.status(401).json({ msg: 'Password is incorrect' });
      }
    }

  }
});

// protected route
router.get('/protected', passport.authenticate('jwt', { session: false }), function(req, res) {
  res.json({ msg: 'Congrats! You are seeing this because you are authorized'});
  });


module.exports = router;
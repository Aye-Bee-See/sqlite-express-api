const express = require('express');
const app = express();
const router = express.Router();




const bodyParser = require('body-parser');

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));

const passport = require('passport');
const JwtStrat = require('../../jwt-strategy');


import('#rtControllers/user.controller.mjs').then(async(res) => {

    const usrCtrl = await new res.default;


const {userEnd} = require('#routes/constants.js');
const userGet = userEnd.get;
const userPost = userEnd.post;
const userPut = userEnd.put;
const userDel = userEnd.delete;


app.use(express.urlencoded({extended: false}));

app.use(passport.initialize());
passport.use(JwtStrat);



// Create

// register admin route
router.post(userPost.registerUser, usrCtrl.register);

// Read
// 
// get all users
router.get(userGet.getAllUsers, usrCtrl.getAll);
// get one user
router.get(userGet.getUser, usrCtrl.getOne);

// Update

router.put(userPut.updateUser, usrCtrl.update);

// Delete

router.delete(userDel.deleteUser, usrCtrl.remove);

// protected route
router.get(userGet.getProtectedUser, passport.authenticate('jwt', {session: false}), usrCtrl.protect);

// login route
router.post(userPost.loginUser, usrCtrl.login);

});

module.exports = router;
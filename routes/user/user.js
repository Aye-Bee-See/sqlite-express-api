const express = require('express');
const app = express();
const router = express.Router();




const bodyParser = require('body-parser');

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));

const passport = require('passport');
//const JwtStrat = require('../../jwt-strategy');


//const JwtStrat=authService.authorize;



import('#rtControllers/user.controller.mjs').then(async(res) => {
    let authService= await import("#rtServices/auth.services.mjs").then((module)=>{return module.default;});

    console.log(authService);
    const JwtStrat=authService.authorize;
    console.log(JwtStrat);
    const usrCtrl = await new res.default;


const {userEnd} = require('#routes/constants.js');
const userGet = userEnd.get;
const userPost = userEnd.post;
const userPut = userEnd.put;
const userDel = userEnd.delete;


app.use(express.urlencoded({extended: false}));

app.use(passport.initialize());
passport.use('name',JwtStrat);



// Create

// register admin route
router.post(userPost.register, usrCtrl.register);

// Read
// 
// get all users
router.get(userGet.list, usrCtrl.getList);
// get one user
router.get(userGet.user, usrCtrl.getUser);

// Update

router.put(userPut.update, usrCtrl.update);

// Delete

router.delete(userDel.delete, usrCtrl.remove);

// protected route
router.get(userGet.protect, passport.authenticate('name', {session: false}), usrCtrl.protect);

// login route
router.post(userPost.login, usrCtrl.login);

});

module.exports = router;
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
    let authService = await import("#rtServices/auth.services.mjs").then((module) => {
        return module.default;
    });
    const JwtStrat = authService.authorize;
    const LocStrat = authService.login;
    const userCtrlr = await new res.default;
    passport.use('JStrat', JwtStrat);
    passport.use('LStrat', LocStrat);
    const constants = import('#routes/constants.js');

    const {userEnd} = await constants;
    const userGet = userEnd.get;
    const userPost = userEnd.post;
    const userPut = userEnd.put;
    const userDel = userEnd.delete;


    app.use(express.urlencoded({extended: false}));

    app.use(passport.initialize());




// Create

// register admin route
    router.post(userPost.register, userCtrlr.register);

// Read
// 
// get all users
    router.get(userGet.list, userCtrlr.getList);
// get one user
    router.get(userGet.user, userCtrlr.getUser);

// Update

    router.put(userPut.update, userCtrlr.update);

// Delete

    router.delete(userDel.remove, userCtrlr.remove);

// protected route
    router.get(userGet.protect, passport.authenticate('JStrat', {session: false}), userCtrlr.protect);

// login route
    router.post(userPost.login, passport.authenticate('LStrat', {session: false}), userCtrlr.login);

});

module.exports = router;

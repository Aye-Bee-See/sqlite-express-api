const express = require('express');
const app = express();
const router = express.Router();



let dbgLog;
import('../../debug/logger.mjs').then((res)=>{
//   console.log("u6:"); 
//   console.table(res.default);
   dbgLog=new res.default;
   //dbgLog.log("u9:");
   
});

const bodyParser = require('body-parser');

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));

const passport = require('passport');
const JwtStrat = require('../../jwt-strategy');
//console.log("u14: " +dbgLog);

import('#rtControllers/user.controller.mjs').then(async(res) => {

    const usrCtrl = await new res.default;
//    console.log("\x1b[48;5;49m%s\x1b[0m", "Mint Background");
dbgLog.output_base_colors();
  dbgLog.term(usrCtrl);
  dbgLog.term(usrCtrl.register);
   // dbgLog.term(1);
//    dbgLog.term(true);
//    dbgLog.term([12,23,55,4]);
//    dbgLog.term({"log":true,"good":"JSON"});





const {userEnd} = require('#routes/constants.js');
const userGet = userEnd.get;
const userPost = userEnd.post;
const userPut = userEnd.put;
const userDel = userEnd.delete;

console.log(userGet);

app.use(express.urlencoded({extended: false}));

app.use(passport.initialize());
passport.use(JwtStrat);



// Create
//console.log(usrCtrl);
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
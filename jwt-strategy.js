const passportJWT = require('passport-jwt');
let User;
const db = import ("#db/sql-database.mjs").then(async(res)=>{
    User=await res.User;
});
let JwtStrategy = passportJWT.Strategy;
let ExtractJwt = passportJWT.ExtractJwt;
let jwtOptions = {};
jwtOptions.jwtFromRequest = ExtractJwt.fromAuthHeaderAsBearerToken();

jwtOptions.secretOrKey = process.env.JWT_SECRET;
const userHelper = require('./routes/user/user.helper')

let jwtStrategy = new JwtStrategy(jwtOptions, function(jwt_payload, next) {
  console.log('payload received', jwt_payload);
  let user = User.getUser({ id: jwt_payload.id });
  if (user) {
    next(null, user);
  } else {
    next(null, false);
  }
});

module.exports = jwtStrategy
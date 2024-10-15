import 'dotenv/config';


//console.log(process.env);
const environ=process.env;
const {JWT_SECRET, PORT, REDIS_SECRET}=process.env;
//console.log(environ);

export {environ, JWT_SECRET as secretOrKey, PORT as sysPort, REDIS_SECRET as redisSecret};

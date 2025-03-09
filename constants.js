import 'dotenv/config';


//console.log(process.env);
const environ=process.env;
const {JWT_SECRET, PORT, REDIS_SECRET}=process.env;
//console.log(environ);

const userEnd = {
    get: {
        list: '/list',
        user: '/user',
        protect: '/protect'
    },
    post: {
        register: '/register',
        login: '/login',
        uploadAvi: '/uploadAvi' // Add this line
    },
    put: {
        update: '/update',
        uploadAvi: '/uploadAvi' // Add this line if PUT is also used
    },
    delete: {
        remove: '/remove'
    }
};

export {environ, JWT_SECRET as secretOrKey, PORT as sysPort, REDIS_SECRET as redisSecret, userEnd};

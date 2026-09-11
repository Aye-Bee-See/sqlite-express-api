import 'dotenv/config';

const environ = process.env;
const { JWT_SECRET, PORT, REDIS_SECRET, ADMIN_USERNAME, ADMIN_PASSWORD, ADMIN_EMAIL } = process.env;

export {
	environ,
	JWT_SECRET as secretOrKey,
	PORT as sysPort,
	REDIS_SECRET as redisSecret,
	ADMIN_USERNAME as adminUsername,
	ADMIN_PASSWORD as adminPassword,
	ADMIN_EMAIL as adminEmail
};

import { hash } from 'bcrypt';

export default {
	beforeCreate: async function hashPass(record) {
		const hashedPass = await hash(record.password, 10);
		record.password = hashedPass;
	}
	//afterCreate: (instance, options)=>{}
};

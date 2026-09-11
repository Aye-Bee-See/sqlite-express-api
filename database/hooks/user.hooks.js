import { hash } from 'bcrypt';

const SALT_ROUNDS = 10;

/**
 * Replace a plain-text password on the instance with its bcrypt hash.
 * @param {import('sequelize').Model} record
 */
async function hashPassword(record) {
	record.password = await hash(record.password, SALT_ROUNDS);
}

export default {
	beforeCreate: hashPassword,

	/**
	 * Runs for instance.save() and for Model.update(..., { individualHooks: true }).
	 * Only re-hash when the password is actually being changed, otherwise an
	 * unrelated update would hash the existing hash.
	 */
	beforeUpdate: async function hashChangedPassword(record) {
		if (record.changed('password')) {
			await hashPassword(record);
		}
	}
};

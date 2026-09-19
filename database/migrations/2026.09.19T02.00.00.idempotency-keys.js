import { DataTypes } from 'sequelize';

/**
 * Idempotency keys: a client-made key sent with a write, so that a retry
 * after a lost connection (or a double click) gets the record the first
 * attempt made instead of making a second one. A row points at what was
 * created; it never holds a copy of it.
 */

export async function up({ context: queryInterface }) {
	await queryInterface.createTable('IdempotencyKeys', {
		id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
		userId: {
			type: DataTypes.INTEGER,
			allowNull: false,
			references: { model: 'User', key: 'id' },
			onDelete: 'CASCADE',
			onUpdate: 'CASCADE'
		},
		scope: { type: DataTypes.STRING, allowNull: false },
		key: { type: DataTypes.STRING, allowNull: false },
		fingerprint: { type: DataTypes.STRING, allowNull: false },
		state: { type: DataTypes.STRING, allowNull: false, defaultValue: 'processing' },
		resourceId: { type: DataTypes.INTEGER },
		createdAt: { type: DataTypes.DATE, allowNull: false },
		updatedAt: { type: DataTypes.DATE, allowNull: false }
	});
	await queryInterface.addIndex('IdempotencyKeys', ['userId', 'scope', 'key'], {
		unique: true,
		name: 'idempotency_keys_owner_scope_key'
	});
}

export async function down({ context: queryInterface }) {
	await queryInterface.dropTable('IdempotencyKeys');
}

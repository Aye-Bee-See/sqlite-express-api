import { DataTypes } from 'sequelize';
import { dropColumn } from '../migration-helpers.js';

/**
 * A queued letter can be held: the person it is for was moved or freed after
 * it was written, and somebody should look before it is printed. `heldReason`
 * says why; null means not held.
 */

export async function up({ context: queryInterface }) {
	await queryInterface.addColumn('Messages', 'heldReason', { type: DataTypes.STRING });
}

export async function down({ context: queryInterface }) {
	await dropColumn(queryInterface, 'Messages', 'heldReason');
}

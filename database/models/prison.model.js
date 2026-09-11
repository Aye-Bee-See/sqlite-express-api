import { Model } from 'sequelize';
import Schemas from '#schemas/all.schema.js';
import Hooks from '#hooks/all.hooks.js';
import Prisoner from '#models/prisoner.model.js';
import Rule from '#models/rule.model.js';
import { NotFoundError } from '#services/HttpError.js';
import { publishedWhere } from '#db/record-status.js';

export default class Prison extends Model {
	static init(sequelize) {
		return super.init(Schemas.prison, {
			sequelize,
			hooks: Hooks.prison || null,
			modelName: 'Prison'
		});
	}
	static associate(models) {
		this.hasMany(models.Prisoner, {
			as: 'prisoners',
			foreignKey: 'prison',
			onDelete: 'RESTRICT',
			onUpdate: 'CASCADE'
		});
		this.belongsToMany(models.Rule, {
			as: 'rules',
			through: 'RulePassthrough',
			foreignKey: 'prison',
			otherKey: 'rule'
		});
	}

	/**
	 * Includes for full=true. With publishedOnly, embedded prisoners are
	 * limited to published ones (rules have no status).
	 */
	static #includes(publishedOnly) {
		return [
			{
				model: Prisoner,
				as: 'prisoners',
				...(publishedOnly ? { where: publishedWhere(true), required: false } : {})
			},
			{ model: Rule, as: 'rules' }
		];
	}

	// Create
	static async createPrison({ prisonName, address, recordStatus }) {
		const values = { prisonName, address };
		if (recordStatus !== undefined) {
			values.recordStatus = recordStatus;
		}
		return await this.create(values);
	}

	/**
	 *  create multiple prisons
	 *
	 *  @param {array} prisonArray  - Array of prison params
	 */
	static async createBulkPrisons(prisonArray) {
		return await this.bulkCreate(prisonArray, { individualHooks: true, ignoreDuplicates: true });
	}

	/**
	 * Get raw prison count
	 * @returns {int}
	 */
	static async countPrisons() {
		const { count } = await this.findAndCountAll();

		return count;
	}

	// Read

	/**
	 * One page of prisons.
	 * @param {{full?: boolean, limit?: number, offset?: number, publishedOnly?: boolean, where?: object}} options
	 * @returns {Promise<{rows: Prison[], count: number}>}
	 */
	static async getAllPrisons({
		full = false,
		limit,
		offset = 0,
		publishedOnly = false,
		where = {}
	} = {}) {
		return await this.findAndCountAll({
			where: { ...where, ...publishedWhere(publishedOnly) },
			include: full ? this.#includes(publishedOnly) : [],
			limit,
			offset,
			distinct: true,
			order: [['id', 'ASC']]
		});
	}

	/**
	 * @param {number|string} id
	 * @param {{full?: boolean, publishedOnly?: boolean}} options
	 * @returns {Promise<Prison|null>} null when missing, or unpublished and publishedOnly
	 */
	static async getPrisonByID(id, { full = false, publishedOnly = false } = {}) {
		return await this.findOne({
			where: { id, ...publishedWhere(publishedOnly) },
			include: full ? this.#includes(publishedOnly) : []
		});
	}

	// Update
	static async updatePrison(prison) {
		return await this.update({ ...prison }, { where: { id: prison.id } });
	}

	/**
	 * Attach an existing rule to an existing prison (idempotent).
	 * @param {number|string} ruleId
	 * @param {number|string} prisonId
	 * @returns {Promise<Prison>} the prison with its rules loaded
	 * @throws {Error} when either record does not exist
	 */
	static async addRule(ruleId, prisonId) {
		const [rule, prison] = await Promise.all([Rule.findByPk(ruleId), this.findByPk(prisonId)]);
		if (!rule) {
			throw new NotFoundError('Rule ' + ruleId + ' not found');
		}
		if (!prison) {
			throw new NotFoundError('Prison ' + prisonId + ' not found');
		}
		await prison.addRule(rule);
		return await this.getPrisonByID(prisonId, { full: true });
	}

	// Delete

	static async deletePrison(id) {
		return await this.destroy({ where: { id: id } });
	}
}

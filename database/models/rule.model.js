import { Model } from 'sequelize';
import Schemas from '#schemas/all.schema.js';
import Hooks from '#hooks/all.hooks.js';
import Prison from '#models/prison.model.js';
import modelsService from '#models/models.service.js';
import { NotFoundError } from '#services/HttpError.js';
import { publishedWhere, PUBLISHED } from '#db/record-status.js';

export default class Rule extends Model {
	static init(sequelize) {
		return super.init(Schemas.rule, {
			sequelize,
			hooks: Hooks.rule || null,
			modelName: 'Rule'
		});
	}

	static associate(models) {
		this.belongsToMany(models.Prison, {
			as: 'prisons',
			through: 'RulePassthrough',
			foreignKey: 'rule',
			otherKey: 'prison'
		});
	}

	/** Includes for full=true: the prisons a rule is attached to (published only when asked). */
	static #includes(publishedOnly) {
		return [
			{
				model: Prison,
				as: 'prisons',
				...(publishedOnly ? { where: publishedWhere(true), required: false } : {})
			}
		];
	}

	static async createRule({ title, description }) {
		return await this.create({ title, description });
	}
	/**
	 *  create multiple rule
	 *
	 *  @param {array} ruleArray  - Array of rule params
	 */
	static async createBulkRules(ruleArray) {
		return await this.bulkCreate(ruleArray, { individualHooks: true, ignoreDuplicates: true });
	}

	/**
	 * Get raw rule count
	 * @returns {int}
	 */
	static async countRules() {
		const { count } = await this.findAndCountAll();

		return count;
	}

	/**
	 * One page of rules. Rules have no publication state of their own.
	 * @param {{full?: boolean, limit?: number, offset?: number, publishedOnly?: boolean, where?: object, order?: Array}} options
	 * @returns {Promise<{rows: Rule[], count: number}>}
	 */
	static async getAllRules({
		full = false,
		limit,
		offset = 0,
		publishedOnly = false,
		where = {},
		order = [['id', 'ASC']]
	} = {}) {
		return await this.findAndCountAll({
			where,
			include: full ? this.#includes(publishedOnly) : [],
			limit,
			offset,
			distinct: true,
			order
		});
	}

	/**
	 * One page of the rules attached to one prison.
	 * @param {number|string} prisonId
	 * @param {{limit?: number, offset?: number, publishedOnly?: boolean, where?: object, order?: Array}} options
	 * @throws {NotFoundError} when the prison does not exist, or is unpublished and publishedOnly
	 */
	static async getRulesByPrison(
		prisonId,
		{ limit, offset = 0, publishedOnly = false, where = {}, order = [['id', 'ASC']] } = {}
	) {
		const prison = await modelsService.modelInstanceExists('Prison', prisonId);
		if (prison instanceof Error) {
			throw prison;
		}
		if (publishedOnly && prison.recordStatus !== PUBLISHED) {
			throw new NotFoundError('Prison ' + prisonId + ' not found');
		}
		return await this.findAndCountAll({
			where,
			include: [
				{
					model: Prison,
					as: 'prisons',
					where: { id: prisonId },
					required: true,
					attributes: []
				}
			],
			limit,
			offset,
			distinct: true,
			order
		});
	}

	/**
	 * @param {number|string} id
	 * @param {{full?: boolean, publishedOnly?: boolean}} options
	 */
	static async getRuleByID(id, { full = false, publishedOnly = false } = {}) {
		return await this.findOne({
			where: { id },
			include: full ? this.#includes(publishedOnly) : []
		});
	}

	static async updateRule(rule) {
		return await this.update({ ...rule }, { where: { id: rule.id } });
	}

	static async deleteRule(id) {
		return await this.destroy({ where: { id: id }, force: true });
	}
}

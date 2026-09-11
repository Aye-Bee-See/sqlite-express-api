import { Model } from 'sequelize';
import Schemas from '#schemas/all.schema.js';
import Hooks from '#hooks/all.hooks.js';
import Prisoner from '#models/prisoner.model.js';
import Rule from '#models/rule.model.js';
import Chapter from '#models/chapter.model.js';
import { NotFoundError } from '#services/HttpError.js';
import { publishedWhere } from '#db/record-status.js';

/** Fields a client may set on create. */
export const PRISON_FIELDS = [
	'prisonName',
	'address',
	'country',
	'routing',
	'scanService',
	'notes',
	'verifiedBy',
	'verifiedAt',
	'verificationNotes',
	'recordStatus'
];

/** Columns hidden from anonymous and user-role callers. */
export const PRISON_STAFF_ONLY = ['verificationNotes'];

function pick(source, fields) {
	const out = {};
	for (const f of fields) {
		if (source[f] !== undefined) {
			out[f] = source[f];
		}
	}
	return out;
}

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
		this.belongsToMany(models.Chapter, {
			as: 'relay_groups',
			through: 'PrisonRelay',
			foreignKey: 'prison',
			otherKey: 'chapter'
		});
		this.belongsTo(models.Chapter, {
			as: 'verified_by_group',
			foreignKey: 'verifiedBy',
			onDelete: 'SET NULL',
			onUpdate: 'CASCADE'
		});
	}

	/** Attribute selection for non-staff readers. */
	static publicAttributes(publishedOnly) {
		return publishedOnly ? { attributes: { exclude: PRISON_STAFF_ONLY } } : {};
	}

	/**
	 * Includes for full=true: prisoners, rules, and relay groups. Embedded
	 * prisoners and groups are limited to published ones for non-staff
	 * (rules have no status).
	 */
	static #includes(publishedOnly) {
		const publishedOnlyOpts = publishedOnly ? { where: publishedWhere(true), required: false } : {};
		return [
			{
				model: Prisoner,
				as: 'prisoners',
				...Prisoner.publicAttributes(publishedOnly),
				...publishedOnlyOpts
			},
			{ model: Rule, as: 'rules' },
			{
				model: Chapter,
				as: 'relay_groups',
				through: { attributes: [] },
				...publishedOnlyOpts
			}
		];
	}

	// Create
	static async createPrison(fields) {
		return await this.create(pick(fields, PRISON_FIELDS));
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
	 * @param {{full?: boolean, limit?: number, offset?: number, publishedOnly?: boolean, where?: object, order?: Array}} options
	 * @returns {Promise<{rows: Prison[], count: number}>}
	 */
	static async getAllPrisons({
		full = false,
		limit,
		offset = 0,
		publishedOnly = false,
		where = {},
		order = [['id', 'ASC']]
	} = {}) {
		return await this.findAndCountAll({
			...this.publicAttributes(publishedOnly),
			where: { ...where, ...publishedWhere(publishedOnly) },
			include: full ? this.#includes(publishedOnly) : [],
			limit,
			offset,
			distinct: true,
			order
		});
	}

	/**
	 * @param {number|string} id
	 * @param {{full?: boolean, publishedOnly?: boolean}} options
	 * @returns {Promise<Prison|null>} null when missing, or unpublished and publishedOnly
	 */
	static async getPrisonByID(id, { full = false, publishedOnly = false } = {}) {
		return await this.findOne({
			...this.publicAttributes(publishedOnly),
			where: { id, ...publishedWhere(publishedOnly) },
			include: full ? this.#includes(publishedOnly) : []
		});
	}

	// Update
	static async updatePrison(prison) {
		return await this.update({ ...prison }, { where: { id: prison.id } });
	}

	/**
	 * Load a prison and a related record for a link operation.
	 * @throws {NotFoundError} when either is missing
	 */
	static async #pair(prisonId, Related, relatedId, label) {
		const [prison, related] = await Promise.all([
			this.findByPk(prisonId),
			Related.findByPk(relatedId)
		]);
		if (!related) {
			throw new NotFoundError(label + ' ' + relatedId + ' not found');
		}
		if (!prison) {
			throw new NotFoundError('Prison ' + prisonId + ' not found');
		}
		return [prison, related];
	}

	/**
	 * Attach an existing rule to an existing prison (idempotent).
	 * @returns {Promise<Prison>} the prison with its relations loaded
	 */
	static async addRule(ruleId, prisonId) {
		const [prison, rule] = await this.#pair(prisonId, Rule, ruleId, 'Rule');
		await prison.addRule(rule);
		return await this.getPrisonByID(prisonId, { full: true });
	}

	/**
	 * Detach a rule from a prison.
	 * @returns {Promise<number>} links removed (0 when there was none)
	 */
	static async removeRule(ruleId, prisonId) {
		const [prison, rule] = await this.#pair(prisonId, Rule, ruleId, 'Rule');
		return await prison.removeRule(rule);
	}

	/**
	 * Attach a relay group (chapter) to a prison (idempotent).
	 * @returns {Promise<Prison>} the prison with its relations loaded
	 */
	static async addRelay(chapterId, prisonId) {
		const [prison, chapter] = await this.#pair(prisonId, Chapter, chapterId, 'Chapter');
		await prison.addRelay_group(chapter);
		return await this.getPrisonByID(prisonId, { full: true });
	}

	/**
	 * Detach a relay group from a prison.
	 * @returns {Promise<number>} links removed (0 when there was none)
	 */
	static async removeRelay(chapterId, prisonId) {
		const [prison, chapter] = await this.#pair(prisonId, Chapter, chapterId, 'Chapter');
		return await prison.removeRelay_group(chapter);
	}

	// Delete

	static async deletePrison(id) {
		return await this.destroy({ where: { id: id } });
	}
}

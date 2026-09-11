import { Model } from 'sequelize';
import Schemas from '#schemas/all.schema.js';
import Hooks from '#hooks/all.hooks.js';
import Chat from '#models/chat.model.js';
import Prison from '#models/prison.model.js';
import modelsService from '#models/models.service.js';
import { NotFoundError } from '#services/HttpError.js';
import { publishedWhere, PUBLISHED } from '#db/record-status.js';

export default class Prisoner extends Model {
	static init(sequelize) {
		return super.init(Schemas.prisoner, {
			sequelize,
			hooks: Hooks.prisoner || null,
			modelName: 'Prisoner'
		});
	}
	static associate(models) {
		this.belongsTo(models.Prison, {
			as: 'prison_details',
			foreignKey: 'prison',
			onDelete: 'RESTRICT',
			onUpdate: 'CASCADE'
		});
		this.hasMany(models.Chat, {
			as: 'chats',
			foreignKey: 'prisoner',
			onDelete: 'RESTRICT',
			onUpdate: 'CASCADE'
		});
		this.hasMany(models.Message, {
			as: 'messages',
			foreignKey: 'prisoner',
			onDelete: 'RESTRICT',
			onUpdate: 'CASCADE'
		});
	}

	/**
	 * Includes for full=true. The prison is embedded (published ones only when
	 * publishedOnly). Chats are private and are embedded only for staff, and
	 * only when asked for.
	 */
	static #includes(publishedOnly, withChats = false) {
		const includes = [
			{
				model: Prison,
				as: 'prison_details',
				...(publishedOnly ? { where: publishedWhere(true), required: false } : {})
			}
		];
		if (withChats && !publishedOnly) {
			includes.push({ model: Chat, as: 'chats' });
		}
		return includes;
	}

	// Create

	static async createPrisoner({
		birthName,
		chosenName,
		prison,
		inmateID,
		releaseDate,
		bio,
		status,
		recordStatus
	}) {
		const values = { birthName, chosenName, prison, inmateID, releaseDate, bio, status };
		if (recordStatus !== undefined) {
			values.recordStatus = recordStatus;
		}
		return await this.create(values);
	}
	/**
	 *  create multiple prisoners
	 *
	 *  @param {array} prisonerArray  - Array of prisoner params
	 */
	static async createBulkPrisoners(prisonerArray) {
		return await this.bulkCreate(prisonerArray, { individualHooks: true, ignoreDuplicates: true });
	}

	/**
	 * Get raw prisoner count
	 * @returns {int}
	 */
	static async countPrisoners() {
		const { count } = await this.findAndCountAll();

		return count;
	}

	// Read

	/**
	 * One page of prisoners.
	 * @param {{full?: boolean, limit?: number, offset?: number, publishedOnly?: boolean, where?: object, order?: Array}} options
	 * @returns {Promise<{rows: Prisoner[], count: number}>}
	 */
	static async getAllPrisoners({
		full = false,
		limit,
		offset = 0,
		publishedOnly = false,
		where = {},
		order = [['id', 'ASC']]
	} = {}) {
		return await this.findAndCountAll({
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
	 * @returns {Promise<Prisoner|null>}
	 */
	static async getPrisonerByID(id, { full = false, publishedOnly = false } = {}) {
		return await this.findOne({
			where: { id, ...publishedWhere(publishedOnly) },
			include: full ? this.#includes(publishedOnly) : []
		});
	}

	/**
	 * One page of the prisoners held at one prison.
	 * @param {number|string} prisonId
	 * @param {{full?: boolean, limit?: number, offset?: number, publishedOnly?: boolean, where?: object, order?: Array}} options
	 * @throws {NotFoundError} when the prison does not exist, or is unpublished and publishedOnly
	 */
	static async getPrisonersByPrison(
		prisonId,
		{
			full = false,
			limit,
			offset = 0,
			publishedOnly = false,
			where = {},
			order = [['id', 'ASC']]
		} = {}
	) {
		const prison = await modelsService.modelInstanceExists('Prison', prisonId);
		if (prison instanceof Error) {
			throw prison;
		}
		if (publishedOnly && prison.recordStatus !== PUBLISHED) {
			throw new NotFoundError('Prison ' + prisonId + ' not found');
		}
		return await this.findAndCountAll({
			where: { ...where, prison: prisonId, ...publishedWhere(publishedOnly) },
			include: full ? this.#includes(publishedOnly, true) : [],
			limit,
			offset,
			distinct: true,
			order
		});
	}

	// Update

	static async updatePrisoner(prisoner) {
		return await this.update({ ...prisoner }, { where: { id: prisoner.id } });
	}

	// Delete

	static async deletePrisoner(id) {
		return await this.destroy({
			where: { id: id }
		});
	}
}

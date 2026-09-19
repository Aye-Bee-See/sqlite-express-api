import { Model } from 'sequelize';
import Schemas from '#schemas/all.schema.js';
import Hooks from '#hooks/all.hooks.js';
import Chat from '#models/chat.model.js';
import Prison from '#models/prison.model.js';
import MailRule from '#models/mail-rule.model.js';
import Chapter from '#models/chapter.model.js';
import PrisonerSupport from '#models/prisoner-support.model.js';
import modelsService from '#models/models.service.js';
import { NotFoundError } from '#services/HttpError.js';
import { publishedWhere, PUBLISHED } from '#db/record-status.js';

/** Fields a client may set on create. Everything else is derived or managed. */
export const PRISONER_FIELDS = [
	'birthName',
	'chosenName',
	'aliases',
	'prison',
	'country',
	'inmateID',
	'releaseDate',
	'detainedSince',
	'sentence',
	'charges',
	'estimatedRelease',
	'bio',
	'interests',
	'photoUrl',
	'supportWebsite',
	'donationInfo',
	'status',
	'statusNotice',
	'featured',
	'verifiedBy',
	'verifiedAt',
	'verificationNotes',
	'recordStatus'
];

/** Columns hidden from anonymous and user-role callers. */
export const PRISONER_STAFF_ONLY = ['verificationNotes'];

function pick(source, fields) {
	const out = {};
	for (const f of fields) {
		if (source[f] !== undefined) {
			out[f] = source[f];
		}
	}
	return out;
}

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
		this.belongsTo(models.Chapter, {
			as: 'verified_by_group',
			foreignKey: 'verifiedBy',
			onDelete: 'SET NULL',
			onUpdate: 'CASCADE'
		});
		this.belongsToMany(models.Chapter, {
			as: 'support_groups',
			through: models.PrisonerSupport,
			foreignKey: 'prisoner',
			otherKey: 'chapter'
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

	/** Attribute selection for non-staff readers. */
	static publicAttributes(publishedOnly) {
		return publishedOnly ? { attributes: { exclude: PRISONER_STAFF_ONLY } } : {};
	}

	/**
	 * Includes for full=true: the prison, the supporting groups (with the
	 * link's description), and, for admins only when asked, chats. Embedded
	 * records are limited to published ones for non-staff.
	 */
	static #includes(publishedOnly, withChats = false) {
		const publishedOnlyOpts = publishedOnly ? { where: publishedWhere(true), required: false } : {};
		const includes = [
			{
				model: Prison,
				as: 'prison_details',
				...Prison.publicAttributes(publishedOnly),
				...publishedOnlyOpts,
				// The facility's mail rules travel with it (they are rows, not a column).
				include: [MailRule.detailsInclude()]
			},
			{
				model: Chapter,
				as: 'support_groups',
				through: { attributes: ['description'] },
				...publishedOnlyOpts
			}
		];
		if (withChats && !publishedOnly) {
			includes.push({ model: Chat, as: 'chats' });
		}
		return includes;
	}

	/**
	 * The facility a prisoner is held in and the ids of its active relay groups.
	 * @param {Prisoner} prisoner
	 * @returns {Promise<{prison: Prison|null, relayIds: number[]}>}
	 */
	static async relayGroupsFor(prisoner) {
		const prison = await Prison.findByPk(prisoner.prison);
		if (!prison) {
			return { prison: null, relayIds: [] };
		}
		const groups = await prison.getRelay_groups({
			attributes: ['id'],
			where: { accountStatus: 'active' },
			joinTableAttributes: []
		});
		return { prison, relayIds: groups.map((g) => g.id) };
	}

	/**
	 * A light facility summary for list rows ("Held at ..."), so cards need no
	 * extra request. full=true replaces it with the complete include.
	 */
	static #facilitySummary(publishedOnly) {
		return [
			{
				model: Prison,
				as: 'prison_details',
				attributes: ['id', 'prisonName', 'country', 'routing'],
				...(publishedOnly ? { where: publishedWhere(true), required: false } : {})
			}
		];
	}

	// Create

	static async createPrisoner(fields) {
		return await this.create(pick(fields, PRISONER_FIELDS));
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
			...this.publicAttributes(publishedOnly),
			where: { ...where, ...publishedWhere(publishedOnly) },
			include: full ? this.#includes(publishedOnly) : this.#facilitySummary(publishedOnly),
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
			...this.publicAttributes(publishedOnly),
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
			withChats = false,
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
			...this.publicAttributes(publishedOnly),
			where: { ...where, prison: prisonId, ...publishedWhere(publishedOnly) },
			include: full
				? this.#includes(publishedOnly, withChats)
				: this.#facilitySummary(publishedOnly),
			limit,
			offset,
			distinct: true,
			order
		});
	}

	// Support groups

	/**
	 * Link a support group to a prisoner, or update the link's description.
	 * @param {number|string} prisonerId
	 * @param {number|string} chapterId
	 * @param {string} [description]
	 * @returns {Promise<Prisoner>} the prisoner with its groups loaded
	 * @throws {NotFoundError} when either record does not exist
	 */
	static async addSupport(prisonerId, chapterId, description) {
		const [prisoner, chapter] = await Promise.all([
			this.findByPk(prisonerId),
			Chapter.findByPk(chapterId)
		]);
		if (!prisoner) {
			throw new NotFoundError('Prisoner ' + prisonerId + ' not found');
		}
		if (!chapter) {
			throw new NotFoundError('Chapter ' + chapterId + ' not found');
		}
		await PrisonerSupport.upsert({
			prisoner: prisoner.id,
			chapter: chapter.id,
			description: description ?? null
		});
		return await this.getPrisonerByID(prisonerId, { full: true });
	}

	/**
	 * Remove a support-group link.
	 * @returns {Promise<number>} rows removed (0 when there was no link)
	 */
	static async removeSupport(prisonerId, chapterId) {
		return await PrisonerSupport.destroy({ where: { prisoner: prisonerId, chapter: chapterId } });
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

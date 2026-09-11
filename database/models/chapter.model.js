import { Model } from 'sequelize';
import Schemas from '#schemas/all.schema.js';
import Hooks from '#hooks/all.hooks.js';
import Prisoner from '#models/prisoner.model.js';
import Prison from '#models/prison.model.js';
import { publishedWhere } from '#db/record-status.js';

/** Fields a client may set on create. */
export const CHAPTER_FIELDS = [
	'name',
	'location',
	'subregion',
	'country',
	'about',
	'website',
	'email',
	'socialLinks',
	'services',
	'announcement',
	'vouchedBy',
	'lettersSent',
	'averageTimeDays',
	'recordStatus'
];

function pick(source, fields) {
	const out = {};
	for (const f of fields) {
		if (source[f] !== undefined) {
			out[f] = source[f];
		}
	}
	return out;
}

export default class Chapter extends Model {
	static init(sequelize) {
		return super.init(Schemas.chapter, {
			sequelize,
			hooks: Hooks.chapter || null,
			modelName: 'Chapter'
		});
	}

	static associate(models) {
		this.belongsToMany(models.Prisoner, {
			as: 'supported_prisoners',
			through: models.PrisonerSupport,
			foreignKey: 'chapter',
			otherKey: 'prisoner'
		});
		this.belongsToMany(models.Prison, {
			as: 'relay_prisons',
			through: 'PrisonRelay',
			foreignKey: 'chapter',
			otherKey: 'prison'
		});
		this.belongsTo(models.Chapter, {
			as: 'vouched_by_group',
			foreignKey: 'vouchedBy',
			onDelete: 'SET NULL',
			onUpdate: 'CASCADE'
		});
		this.hasMany(models.User, {
			as: 'members',
			foreignKey: 'chapterId',
			onDelete: 'SET NULL',
			onUpdate: 'CASCADE'
		});
	}

	/**
	 * Includes for full=true: the prisoners this group supports (with the
	 * link's description) and the prisons it relays to. Limited to published
	 * records for non-staff.
	 */
	static #includes(publishedOnly) {
		const publishedOnlyOpts = publishedOnly ? { where: publishedWhere(true), required: false } : {};
		return [
			{
				model: Prisoner,
				as: 'supported_prisoners',
				through: { attributes: ['description'] },
				...Prisoner.publicAttributes(publishedOnly),
				...publishedOnlyOpts
			},
			{
				model: Prison,
				as: 'relay_prisons',
				through: { attributes: [] },
				...Prison.publicAttributes(publishedOnly),
				...publishedOnlyOpts
			}
		];
	}

	//Create
	static async createChapter(fields) {
		return await this.create(pick(fields, CHAPTER_FIELDS));
	}
	static async createBulkChapters(chapterArray) {
		return await this.bulkCreate(chapterArray, { individualHooks: true, ignoreDuplicates: true });
	}

	//Read
	static async countChapters() {
		const { count } = await this.findAndCountAll();

		return count;
	}

	/**
	 * One page of chapters.
	 * @param {{full?: boolean, limit?: number, offset?: number, publishedOnly?: boolean, where?: object, order?: Array}} options
	 * @returns {Promise<{rows: Chapter[], count: number}>}
	 */
	static async getAllChapters({
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
	 */
	static async getChapterByID(id, { full = false, publishedOnly = false } = {}) {
		return await this.findOne({
			where: { id, ...publishedWhere(publishedOnly) },
			include: full ? this.#includes(publishedOnly) : []
		});
	}

	//Update
	static async updateChapter(chapter) {
		return await this.update({ ...chapter }, { where: { id: chapter.id } });
	}

	//Delete
	static async deleteChapter(id) {
		return await this.destroy({ where: { id: id }, force: true });
	}
}

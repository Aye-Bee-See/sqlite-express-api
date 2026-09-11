import { Model } from 'sequelize';
import Schemas from '#schemas/all.schema.js';
import Hooks from '#hooks/all.hooks.js';
import { publishedWhere } from '#db/record-status.js';

export default class Chapter extends Model {
	static init(sequelize) {
		return super.init(Schemas.chapter, {
			sequelize,
			hooks: Hooks.chapter || null,
			modelName: 'Chapter'
		});
	}

	// Chapters have no associations yet. A future relation to prisoners or
	// users would be declared here, like the other models.
	static associate() {}

	//Create
	static async createChapter({ name, location, recordStatus }) {
		const values = { name, location };
		if (recordStatus !== undefined) {
			values.recordStatus = recordStatus;
		}
		return await this.create(values);
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
	 * @param {{limit?: number, offset?: number, publishedOnly?: boolean, where?: object}} options
	 * @returns {Promise<{rows: Chapter[], count: number}>}
	 */
	static async getAllChapters({ limit, offset = 0, publishedOnly = false, where = {} } = {}) {
		return await this.findAndCountAll({
			where: { ...where, ...publishedWhere(publishedOnly) },
			limit,
			offset,
			order: [['id', 'ASC']]
		});
	}

	/**
	 * @param {number|string} id
	 * @param {{publishedOnly?: boolean}} options
	 */
	static async getChapterByID(id, { publishedOnly = false } = {}) {
		return await this.findOne({
			where: { id, ...publishedWhere(publishedOnly) }
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

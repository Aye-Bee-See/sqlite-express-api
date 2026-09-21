import { Model } from 'sequelize';
import Schemas from '#schemas/all.schema.js';
import pick, { updateById } from '#db/pick.js';
import Hooks from '#hooks/all.hooks.js';
import Prisoner from '#models/prisoner.model.js';
import Prison from '#models/prison.model.js';
import MailRule from '#models/mail-rule.model.js';
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
	'networkRole',
	'accountStatus',
	'vouchedBy',
	// lettersSent and averageTimeDays are counted, not typed (see recount and refreshMailingTimes).
	'lettersSentBefore',
	'recordStatus'
];

/** What only staff see of a group: the figures behind its public number. */
export const CHAPTER_STAFF_ONLY = ['lettersCounted', 'lettersSentBefore'];

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
				...publishedOnlyOpts,
				include: [MailRule.detailsInclude()]
			}
		];
	}

	//Create
	static async createChapter(fields) {
		const created = await this.create(pick(fields, CHAPTER_FIELDS));
		if (created.lettersSentBefore > 0) {
			await this.recount(created.id);
			await created.reload();
		}
		return created;
	}
	static async createBulkChapters(chapterArray) {
		return await this.bulkCreate(chapterArray, { individualHooks: true, ignoreDuplicates: true });
	}

	/** Below this many letters a group's numbers are not shown to the public. */
	static PUBLIC_FROM = 20;
	/** A median of fewer mailings than this says nothing. */
	static MIN_SAMPLES = 5;

	/** Attribute selection for non-staff readers. */
	static publicAttributes(publishedOnly) {
		return publishedOnly ? { attributes: { exclude: CHAPTER_STAFF_ONLY } } : {};
	}

	/** Bring the public `lettersSent` in line with the two figures behind it. */
	static async recount(id, { transaction } = {}) {
		await this.sequelize.query(
			'UPDATE `Chapters` SET `lettersSent` = CASE WHEN `lettersSentBefore` + `lettersCounted` >= :from THEN CAST(`lettersSentBefore` + `lettersCounted` AS TEXT) ELSE NULL END WHERE `id` = :id',
			{ replacements: { id, from: Chapter.PUBLIC_FROM }, transaction }
		);
	}

	/** This group has just mailed `letters` more letters. */
	static async countMailed(id, letters = 1, { transaction } = {}) {
		if (!id || letters < 1) {
			return;
		}
		await this.sequelize.query(
			'UPDATE `Chapters` SET `lettersCounted` = `lettersCounted` + :letters WHERE `id` = :id',
			{ replacements: { id, letters }, transaction }
		);
		await this.recount(id, { transaction });
	}

	/**
	 * `averageTimeDays` for every group: the median number of days its letters took
	 * from queued to mailed, over the last 90 days. Null when it mailed fewer than
	 * MIN_SAMPLES letters in that time, and while its letter count is not shown.
	 * Runs at boot and with the retention timer.
	 * @returns {Promise<number>} groups that have a figure
	 */
	static async refreshMailingTimes(now = new Date()) {
		const since = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
		const [rows] = await this.sequelize.query(
			"SELECT `m`.`relayChapter` AS chapter, `m`.`createdAt` AS written, `s`.`createdAt` AS mailed FROM `MessageStatuses` AS `s` JOIN `Messages` AS `m` ON `m`.`id` = `s`.`message` WHERE `s`.`toStatus` = 'mailed' AND `m`.`relayChapter` IS NOT NULL"
		);
		const days = new Map();
		for (const row of rows) {
			const mailed = new Date(row.mailed);
			if (mailed < since) {
				continue;
			}
			const took = (mailed - new Date(row.written)) / (24 * 60 * 60 * 1000);
			days.set(row.chapter, [...(days.get(row.chapter) || []), Math.max(took, 0)]);
		}
		const shown = await this.findAll({
			attributes: ['id', 'lettersSent', 'averageTimeDays'],
			hooks: false
		});
		let withFigure = 0;
		for (const chapter of shown) {
			const sample = (days.get(chapter.id) || []).sort((a, b) => a - b);
			let median = null;
			if (sample.length >= Chapter.MIN_SAMPLES && chapter.lettersSent !== null) {
				const mid = Math.floor(sample.length / 2);
				median = Math.round(sample.length % 2 ? sample[mid] : (sample[mid - 1] + sample[mid]) / 2);
				withFigure += 1;
			}
			if (median !== chapter.averageTimeDays) {
				await this.update({ averageTimeDays: median }, { where: { id: chapter.id } });
			}
		}
		return withFigure;
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
	 */
	static async getChapterByID(id, { full = false, publishedOnly = false } = {}) {
		return await this.findOne({
			...this.publicAttributes(publishedOnly),
			where: { id, ...publishedWhere(publishedOnly) },
			include: full ? this.#includes(publishedOnly) : []
		});
	}

	//Update
	static async updateChapter(chapter) {
		const result = await updateById(this, chapter.id, pick(chapter, CHAPTER_FIELDS));
		if (chapter.lettersSentBefore !== undefined) {
			await this.recount(chapter.id);
		}
		return result;
	}

	//Delete
	static async deleteChapter(id) {
		return await this.destroy({ where: { id: id }, force: true });
	}
}

import RouteController from '#rtControllers/route.controller.js';
import Chapter from '#models/chapter.model.js';
import { Op, literal } from 'sequelize';
import { readOptions, SORT_BY_CREATED } from '#rtControllers/directory.helpers.js';
import { ACCOUNT_STATUSES, CHAPTER_SERVICES } from '#db/validators.js';
import AuthzService from '#rtServices/authz.services.js';
import { audit } from '#rtServices/audit.services.js';

const READ_CONFIG = {
	searchFields: ['name'],
	sorts: { name: [['name', 'ASC']], ...SORT_BY_CREATED },
	filters: {
		country: {},
		// `both` groups match either role.
		networkRole: {
			allowed: ['collecting', 'relay'],
			build: (value) => ({ [Op.and]: [{ networkRole: { [Op.in]: [value, 'both'] } }] })
		},
		accountStatus: { allowed: ACCOUNT_STATUSES },
		// services is a JSON array stored as text; Sequelize would JSON-encode a
		// LIKE value on a JSON column, so match the quoted element with raw SQL.
		// The value is validated against CHAPTER_SERVICES (word characters only).
		service: {
			allowed: CHAPTER_SERVICES,
			build: (value) => ({
				[Op.and]: [literal('`Chapter`.`services` LIKE \'%"' + value + '"%\'')]
			})
		}
	}
};

export default class chapterController extends RouteController {
	constructor() {
		/*
		 * If we use class methods as subfunctions (or callbacks)
		 * JS loses where we are and thinks this is is something
		 * other than the instance of our class
		 */
		super('chapter');
		this.create = this.create.bind(this);
		this.getMany = this.getMany.bind(this);
		this.getOne = this.getOne.bind(this);
		this.update = this.update.bind(this);
		this.remove = this.remove.bind(this);

		this.#handleSuccess = super.handleSuccess;
		this.#handleErr = super.handleErr;
		this.#handleLimits = super.handleLimits;
	}

	#handleSuccess;
	#handleErr;
	#handleLimits;

	async create(req, res, next) {
		if (req.body.accountStatus !== undefined && !AuthzService.isAdmin(req)) {
			return next(AuthzService.forbidden("Only an admin can set a group's account status."));
		}
		try {
			const chapter = await Chapter.createChapter(req.body);
			await audit(req, 'chapter.create', 'chapter', chapter.id, { fields: req.body });
			this.#handleSuccess(res, chapter);
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	async getOne(req, res) {
		const { id, full } = req.query;
		const { publishedOnly } = readOptions(req);
		try {
			const chapter = await Chapter.getChapterByID(id, { full: full === 'true', publishedOnly });
			this.#handleSuccess(res, this.requireFound(chapter, 'Chapter ' + id));
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	/** List chapters: page, page_size, full, q, sort, country, service, and (staff only) recordStatus. */
	async getMany(req, res) {
		const { page, page_size, full } = req.query;
		const limits = this.#handleLimits(page, page_size);
		const { publishedOnly, where, order } = readOptions(req, READ_CONFIG);
		try {
			const result = await Chapter.getAllChapters({
				full: full === 'true',
				limit: limits.limit,
				offset: limits.offset,
				publishedOnly,
				where,
				order
			});
			this.handlePage(res, result, limits);
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	async update(req, res, next) {
		const newChapter = req.body;
		if (newChapter.accountStatus !== undefined && !AuthzService.isAdmin(req)) {
			return next(AuthzService.forbidden("Only an admin can set a group's account status."));
		}
		try {
			const updatedRows = await Chapter.updateChapter(newChapter);
			this.requireAffected(updatedRows, 'Chapter ' + newChapter.id);
			await audit(req, 'chapter.update', 'chapter', newChapter.id, { fields: newChapter });
			this.#handleSuccess(res, { updatedRows, newChapter });
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	async remove(req, res) {
		const { id } = req.body;
		try {
			const deletedRows = await Chapter.deleteChapter(id);
			this.requireAffected(deletedRows, 'Chapter ' + id);
			await audit(req, 'chapter.delete', 'chapter', id);
			this.#handleSuccess(res, deletedRows);
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}
}

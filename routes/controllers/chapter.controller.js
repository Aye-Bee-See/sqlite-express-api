import RouteController from '#rtControllers/route.controller.js';
import Chapter from '#models/chapter.model.js';
import { readOptions } from '#rtControllers/directory.helpers.js';

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

	async create(req, res) {
		const { name, location, recordStatus } = req.body;
		try {
			const chapter = await Chapter.createChapter({ name, location, recordStatus });
			this.#handleSuccess(res, chapter);
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	async getOne(req, res) {
		const { id } = req.query;
		const { publishedOnly } = readOptions(req);
		try {
			const chapter = await Chapter.getChapterByID(id, { publishedOnly });
			this.#handleSuccess(res, this.requireFound(chapter, 'Chapter ' + id));
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	/** List chapters: page, page_size, and (staff only) recordStatus. */
	async getMany(req, res) {
		const { page, page_size } = req.query;
		const limits = this.#handleLimits(page, page_size);
		const { publishedOnly, where } = readOptions(req);
		try {
			const result = await Chapter.getAllChapters({
				limit: limits.limit,
				offset: limits.offset,
				publishedOnly,
				where
			});
			this.handlePage(res, result, limits);
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	async update(req, res) {
		const newChapter = req.body;
		try {
			const updatedRows = await Chapter.updateChapter(newChapter);
			this.requireAffected(updatedRows, 'Chapter ' + newChapter.id);
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
			this.#handleSuccess(res, this.requireAffected(deletedRows, 'Chapter ' + id));
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}
}

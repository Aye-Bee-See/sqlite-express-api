import RouteController from '#rtControllers/route.controller.js';
import Chapter from '#models/chapter.model.js';

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
	}

	#handleSuccess;
	#handleErr;

	async create(req, res) {
		const { name, location } = req.body;
		try {
			const chapter = await Chapter.createChapter({ name, location });
			this.#handleSuccess(res, chapter);
		} catch (err) {
			//TODO: this is used multiple times, can it be extracted?
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	async getOne(req, res) {
		const { id } = req.query;
		try {
			const chapter = await Chapter.getChapterByID(id);
			this.#handleSuccess(res, chapter);
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	async getMany(req, res) {
		try {
			const chapters = await Chapter.getAllChapters();
			this.#handleSuccess(res, chapters);
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	async update(req, res) {
		const newChapter = req.body;
		try {
			const updatedRows = await Chapter.updateChapter(newChapter);
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
			this.#handleSuccess(res, deletedRows);
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}
}

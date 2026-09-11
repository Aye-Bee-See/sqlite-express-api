import Rule from '#models/rule.model.js';
import RouteController from '#rtControllers/route.controller.js';
import { readOptions } from '#rtControllers/directory.helpers.js';

export default class ruleController extends RouteController {
	constructor() {
		/*
		 * If we use class methods as subfunctions (or callbacks)
		 * JS loses where we are and thinks this is is something
		 * other than the instance of our class
		 */
		super('rule');
		this.getMany = this.getMany.bind(this);
		this.getOne = this.getOne.bind(this);
		this.update = this.update.bind(this);
		this.remove = this.remove.bind(this);
		this.create = this.create.bind(this);

		this.#handleErr = super.handleErr;
		this.#handleSuccess = super.handleSuccess;
		this.#handleLimits = super.handleLimits;
	}

	#handleSuccess;
	#handleErr;
	#handleLimits;

	/**
	 * List rules, optionally only those attached to one prison via
	 * ?prison=<id>. Paginated with page and page_size; full=true embeds the
	 * prisons each rule is attached to.
	 */
	async getMany(req, res) {
		const { prison, full, page, page_size } = req.query;
		const limits = this.#handleLimits(page, page_size);
		const { publishedOnly } = readOptions(req);
		const options = { limit: limits.limit, offset: limits.offset, publishedOnly };

		try {
			const result =
				prison !== undefined
					? await Rule.getRulesByPrison(prison, options)
					: await Rule.getAllRules({ ...options, full: full === 'true' });
			this.handlePage(res, result, limits);
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	// get one rule

	async getOne(req, res) {
		const { id, full } = req.query;
		const { publishedOnly } = readOptions(req);
		try {
			const rule = await Rule.getRuleByID(id, { full: full === 'true', publishedOnly });
			this.#handleSuccess(res, this.requireFound(rule, 'Rule ' + id));
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}
	// Create
	async create(req, res) {
		const { title, description } = req.body;
		try {
			const rule = await Rule.createRule({ title, description });
			this.#handleSuccess(res, rule);
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	// Update

	async update(req, res) {
		const newRule = req.body;
		try {
			const updatedRows = await Rule.updateRule(newRule);
			this.requireAffected(updatedRows, 'Rule ' + newRule.id);
			this.#handleSuccess(res, { updatedRows, newRule });
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	// Delete
	async remove(req, res) {
		const { id } = req.body;
		try {
			const deletedRows = await Rule.deleteRule(id);
			this.#handleSuccess(res, this.requireAffected(deletedRows, 'Rule ' + id));
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}
}

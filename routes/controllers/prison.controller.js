import Prison from '#models/prison.model.js';
import { Op, literal } from 'sequelize';
import RouteController from '#rtControllers/route.controller.js';
import { publishedWhere } from '#db/record-status.js';
import { readOptions, SORT_BY_CREATED, filterValues } from '#rtControllers/directory.helpers.js';
import { ROUTING_METHODS } from '#db/validators.js';
import { MAIL_RULE_CATEGORIES, MAIL_RULE_CONFLICTS, MAIL_RULE_PARAMETERS } from '#db/mail-rules.js';
import MailRule from '#models/mail-rule.model.js';
import { MAIL_RULE_TAG } from '#schemas/mail-rule.schema.js';
import AuthzService from '#rtServices/authz.services.js';
import ValidationError from '#services/ValidationError.js';
import { staleVerificationWhere } from '#db/record-status.js';
import { audit } from '#rtServices/audit.services.js';

const READ_CONFIG = {
	searchFields: ['prisonName'],
	sorts: { name: [['prisonName', 'ASC']], ...SORT_BY_CREATED },
	filters: {
		country: {},
		routing: { allowed: ROUTING_METHODS },
		stale: { allowed: ['true'], build: () => staleVerificationWhere() },
		// mailRule=<tag>: facilities carrying that tag. The value is checked
		// against the vocabulary before it reaches the SQL.
		mailRule: {
			build: (tag) => {
				// Only the shape of a tag reaches the SQL; one that is not on the list matches nothing.
				if (!MAIL_RULE_TAG.test(tag)) {
					throw new ValidationError('mailRule must be a rule tag from GET /prison/mail-rules.');
				}
				return {
					id: {
						[Op.in]: literal(
							"(SELECT `PrisonMailRules`.`prison` FROM `PrisonMailRules` JOIN `MailRules` ON `MailRules`.`id` = `PrisonMailRules`.`rule` WHERE `MailRules`.`tag` = '" +
								tag +
								"')"
						)
					}
				};
			}
		},
		// language=<code>: facilities that accept mail in it; no restriction counts.
		language: {
			build: (code) => {
				if (!/^[a-z]{2}$/.test(code)) {
					throw new ValidationError('language must be a two-letter ISO 639-1 code in lower case.');
				}
				return {
					id: {
						[Op.in]: literal(
							"(SELECT `Prisons`.`id` FROM `Prisons` WHERE `Prisons`.`mailLanguages` IS NULL OR json_array_length(`Prisons`.`mailLanguages`) = 0 OR EXISTS (SELECT 1 FROM json_each(`Prisons`.`mailLanguages`) WHERE json_each.value = '" +
								code +
								"'))"
						)
					}
				};
			}
		},
		// relay=true: at least one active relay group; relay=false: none.
		relay: {
			allowed: ['true', 'false'],
			build: (value) => ({
				id: {
					[value === 'true' ? Op.in : Op.notIn]: literal(
						"(SELECT `PrisonRelay`.`prison` FROM `PrisonRelay` JOIN `Chapters` ON `Chapters`.`id` = `PrisonRelay`.`chapter` WHERE `Chapters`.`accountStatus` = 'active')"
					)
				}
			})
		}
	}
};

export default class PrisonController extends RouteController {
	constructor() {
		/*
		 * If we use class methods as subfunctions (or callbacks)
		 * JS loses where we are and thinks this is is something
		 * other than the instance of our class
		 */
		super('prison');
		this.getMany = this.getMany.bind(this);
		this.filters = this.filters.bind(this);
		this.getOne = this.getOne.bind(this);
		this.update = this.update.bind(this);
		this.remove = this.remove.bind(this);
		this.create = this.create.bind(this);
		this.mailRules = this.mailRules.bind(this);
		this.createMailRule = this.createMailRule.bind(this);
		this.updateMailRule = this.updateMailRule.bind(this);
		this.removeMailRule = this.removeMailRule.bind(this);
		this.addRelay = this.addRelay.bind(this);
		this.removeRelay = this.removeRelay.bind(this);

		this.#handleErr = super.handleErr;
		this.#handleSuccess = super.handleSuccess;
		this.#handleLimits = super.handleLimits;
	}

	#handleSuccess;
	#handleErr;
	#handleLimits;

	/** List prisons: page, page_size, full, q, sort, and (staff only) recordStatus. */
	/**
	 * GET /prison/filters: the values the list pages build their filter chips
	 * from ([`country`, `routing`]), each with a count, over the records the caller could list.
	 */
	async filters(req, res) {
		try {
			const { publishedOnly } = readOptions(req);
			const where = publishedOnly ? publishedWhere(true) : {};
			this.handleSuccess(res, await filterValues(Prison, ['country', 'routing'], where));
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.handleErr(res, errorVar);
		}
	}

	async getMany(req, res) {
		const { full, page, page_size } = req.query;
		const limits = this.#handleLimits(page, page_size);
		const { publishedOnly, where, order } = readOptions(req, READ_CONFIG);
		try {
			const result = await Prison.getAllPrisons({
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

	/**
	 * GET /prison/mail-rules: the rule tags a facility may carry, grouped by
	 * category, with default English wording, and the typed limits beside them.
	 */
	async mailRules(req, res) {
		try {
			// Staff also see retired rules, to restore one or to read a facility that still has it.
			const includeRetired = req.query.retired === 'true' && !AuthzService.publishedOnly(req);
			const rules = await MailRule.list({ includeRetired });
			this.#handleSuccess(res, {
				categories: MAIL_RULE_CATEGORIES,
				rules: rules.map((rule) => PrisonController.#presentRule(rule)),
				conflicts: MAIL_RULE_CONFLICTS,
				parameters: MAIL_RULE_PARAMETERS
			});
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	static #presentRule(rule, extra = {}) {
		return {
			id: rule.id,
			tag: rule.tag,
			category: rule.category,
			label: rule.label,
			description: rule.description,
			retired: Boolean(rule.retiredAt),
			...extra
		};
	}

	/** POST /prison/mail-rule { tag, category, label, description? } (admin): add to the master list. */
	async createMailRule(req, res) {
		try {
			const rule = await MailRule.createRule(req.body, req.user.id);
			await audit(req, 'mail-rule.create', 'mail-rule', rule.id, { tag: rule.tag });
			this.#handleSuccess(res, PrisonController.#presentRule(rule));
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	/**
	 * PUT /prison/mail-rule { id, category?, label?, description?, retired? } (admin):
	 * reword, recategorise, retire, or restore. The tag never changes.
	 */
	async updateMailRule(req, res) {
		try {
			const rule = this.requireFound(
				await MailRule.updateRule(req.body.id, req.body),
				'Mail rule ' + req.body.id
			);
			await audit(req, 'mail-rule.update', 'mail-rule', rule.id, {
				fields: Object.keys(req.body).filter((field) => field !== 'id')
			});
			this.#handleSuccess(
				res,
				PrisonController.#presentRule(rule, { prisons: await MailRule.usage(rule.id) })
			);
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	/** DELETE /prison/mail-rule { id } (admin): only a rule no facility carries; otherwise retire it. */
	async removeMailRule(req, res) {
		try {
			// The usage check and the delete are one step in the model, in the same
			// queue as facility rule writes, so a facility cannot link to it in between.
			const rule = this.requireFound(
				await MailRule.deleteRule(req.body.id),
				'Mail rule ' + req.body.id
			);
			await audit(req, 'mail-rule.delete', 'mail-rule', rule.id, { tag: rule.tag });
			this.#handleSuccess(res, PrisonController.#presentRule(rule));
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	// get one prison

	async getOne(req, res) {
		const { id, full } = req.query;
		const { publishedOnly } = readOptions(req);
		try {
			const prison = await Prison.getPrisonByID(id, { full: full === 'true', publishedOnly });
			this.#handleSuccess(res, this.requireFound(prison, 'Prison ' + id));
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}
	// Create
	async create(req, res) {
		try {
			const prison = await Prison.createPrison(req.body);
			await audit(req, 'prison.create', 'prison', prison.id, { fields: req.body });
			this.#handleSuccess(res, prison);
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	// Update

	async update(req, res) {
		const newPrison = req.body;
		try {
			const updatedRows = await Prison.updatePrison(newPrison);
			this.requireAffected(updatedRows, 'Prison ' + newPrison.id);
			await audit(req, 'prison.update', 'prison', newPrison.id, { fields: newPrison });
			this.#handleSuccess(res, { updatedRows, newPrison });
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	/**
	 * A group admin links and unlinks their own active group only; a superadmin any.
	 * @throws {Error} 403
	 */
	async #ownGroupOnly(req, chapter) {
		if (AuthzService.isAdmin(req)) {
			return;
		}
		const own = await AuthzService.activeChapterOf(req);
		if (!own) {
			throw await AuthzService.groupRefusal(req);
		}
		if (String(chapter) !== String(own)) {
			throw AuthzService.forbidden('A group admin links their own group only; ask a superadmin.');
		}
	}

	/** PUT /prison/relay { prison, chapter }: attach a relay group. */
	async addRelay(req, res, next) {
		const { chapter, prison } = req.body;
		try {
			await this.#ownGroupOnly(req, chapter);
			const updatedRows = await Prison.addRelay(chapter, prison);
			await audit(req, 'prison.relay.add', 'prison', prison, { chapter });
			this.#handleSuccess(res, { updatedRows, chapter, prison });
		} catch (err) {
			if (err && err.status === 403) {
				return next(err);
			}
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	/** DELETE /prison/relay { prison, chapter }: detach a relay group. */
	async removeRelay(req, res, next) {
		const { chapter, prison } = req.body;
		try {
			await this.#ownGroupOnly(req, chapter);
			const removed = await Prison.removeRelay(chapter, prison);
			this.requireAffected(removed, 'Relay link for prison ' + prison + ' and chapter ' + chapter);
			await audit(req, 'prison.relay.remove', 'prison', prison, { chapter });
			this.#handleSuccess(res, removed);
		} catch (err) {
			if (err && err.status === 403) {
				return next(err);
			}
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	// Delete

	async remove(req, res) {
		const { id } = req.body;
		try {
			const deletedRows = await Prison.deletePrison(id);
			this.requireAffected(deletedRows, 'Prison ' + id);
			await audit(req, 'prison.delete', 'prison', id);
			this.#handleSuccess(res, deletedRows);
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}
}

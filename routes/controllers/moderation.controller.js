import RouteController from '#rtControllers/route.controller.js';
import AuthzService from '#rtServices/authz.services.js';
import Submission, { RESOURCES, REVIEWER_ONLY } from '#models/submission.model.js';
import AuditLog from '#models/audit-log.model.js';
import Prisoner from '#models/prisoner.model.js';
import Prison from '#models/prison.model.js';
import Chapter from '#models/chapter.model.js';
import ValidationError from '#services/ValidationError.js';
import { HttpError } from '#services/HttpError.js';
import { audit } from '#rtServices/audit.services.js';
import { notify } from '#rtServices/notify.services.js';
import { SUBMISSION_RESOURCES, SUBMISSION_STATUSES } from '#schemas/submission.schema.js';
import { RECORD_STATUSES, staleVerificationWhere } from '#db/record-status.js';

/**
 * Moderation: proposed directory changes, their review, the audit log, and
 * the dashboard summary.
 *
 * Any signed-in account may propose; admins review. Submitters see and
 * withdraw their own proposals.
 */
export default class ModerationController extends RouteController {
	constructor() {
		/*
		 * If we use class methods as subfunctions (or callbacks)
		 * JS loses where we are and thinks this is is something
		 * other than the instance of our class
		 */
		super('moderation');
		this.create = this.create.bind(this);
		this.getMany = this.getMany.bind(this);
		this.getOne = this.getOne.bind(this);
		this.update = this.update.bind(this);
		this.approve = this.approve.bind(this);
		this.reject = this.reject.bind(this);
		this.remove = this.remove.bind(this);
		this.audit = this.audit.bind(this);
		this.summary = this.summary.bind(this);

		this.#handleErr = super.handleErr;
		this.#handleSuccess = super.handleSuccess;
		this.#handleLimits = super.handleLimits;
	}

	#handleSuccess;
	#handleErr;
	#handleLimits;

	#fail(res, next, err) {
		if (err && err.status === 403) {
			return next(err);
		}
		const errorVar = !(err instanceof Error) ? new Error(err) : err;
		this.#handleErr(res, errorVar);
	}

	/** Tell the person who proposed it what was decided. (The reviewer's note stays in the submission.) */
	static async #announceDecision(req, submission) {
		await notify(
			[submission.submittedBy],
			{
				event: 'submission.decided',
				submission: submission.id,
				detail: { status: submission.status, resource: submission.resource }
			},
			{ actor: req.user.id }
		);
	}

	/**
	 * A submission as this caller may see it: non-admins never receive the
	 * reviewer-only fields a decision may have set.
	 */
	#present(req, submission, extra = {}) {
		const plain = { ...submission.toJSON(), ...extra };
		if (!AuthzService.isAdmin(req) && plain.appliedChanges) {
			plain.appliedChanges = { ...plain.appliedChanges };
			for (const field of REVIEWER_ONLY) {
				delete plain.appliedChanges[field];
			}
		}
		return plain;
	}

	/** Load a submission the caller may see (admin, or its submitter). */
	async #visible(req, id) {
		const submission = this.requireFound(await Submission.read(id), 'Submission ' + id);
		const own = String(submission.submittedBy) === String(req.user.id);
		if (!AuthzService.isAdmin(req) && !own) {
			throw AuthzService.forbidden();
		}
		return submission;
	}

	/**
	 * POST /moderation/submission { resource, target?, fields, evidence?, note? }
	 * Propose a new record (no target) or changes to one.
	 */
	async create(req, res, next) {
		const { resource, target, fields, evidence, note } = req.body;
		try {
			const submission = await Submission.propose({
				resource,
				target,
				fields,
				evidence,
				note,
				submittedBy: req.user.id,
				publishedOnly: AuthzService.publishedOnly(req)
			});
			await audit(req, 'submission.create', 'submission', submission.id, {
				resource,
				kind: submission.kind,
				targetId: submission.targetId
			});
			this.#handleSuccess(res, this.#present(req, await Submission.read(submission.id)));
		} catch (err) {
			this.#fail(res, next, err);
		}
	}

	/**
	 * GET /moderation/submissions?status=&resource=&submittedBy=&page=&page_size=
	 * Admins see everything (default: pending); others see their own.
	 */
	async getMany(req, res, next) {
		const { status, resource, submittedBy, page, page_size } = req.query;
		const limits = this.#handleLimits(page, page_size);
		try {
			const where = {};
			// Empty query values (e.g. a blank form field) mean "no filter".
			const given = (v) => v !== undefined && v !== '';
			if (given(status) && status !== 'all') {
				if (!SUBMISSION_STATUSES.includes(status)) {
					throw new ValidationError(
						'status must be one of ' + SUBMISSION_STATUSES.join(', ') + ', or all.'
					);
				}
				where.status = status;
			} else if (!given(status) && AuthzService.isAdmin(req)) {
				where.status = 'pending';
			}
			if (given(resource)) {
				if (!SUBMISSION_RESOURCES.includes(resource)) {
					throw new ValidationError(
						'resource must be one of ' + SUBMISSION_RESOURCES.join(', ') + '.'
					);
				}
				where.resource = resource;
			}
			if (AuthzService.isAdmin(req)) {
				if (given(submittedBy)) {
					where.submittedBy = submittedBy;
				}
			} else {
				where.submittedBy = req.user.id;
			}
			const result = await Submission.list({ where, limit: limits.limit, offset: limits.offset });
			this.handlePage(
				res,
				{ rows: result.rows.map((s) => this.#present(req, s)), count: result.count },
				limits
			);
		} catch (err) {
			this.#fail(res, next, err);
		}
	}

	/** GET /moderation/submission?id=: one proposal with the target's current values. */
	async getOne(req, res, next) {
		const { id } = req.query;
		try {
			const submission = await this.#visible(req, id);
			const current = await Submission.currentValues(submission, AuthzService.publishedOnly(req));
			this.#handleSuccess(res, this.#present(req, submission, { current }));
		} catch (err) {
			this.#fail(res, next, err);
		}
	}

	/**
	 * PUT /moderation/submission { id, fields?, evidence?, note? }: the
	 * submitter (or an admin) revises a proposal that is still pending.
	 */
	async update(req, res, next) {
		const { id, fields, evidence, note } = req.body;
		try {
			const submission = await this.#visible(req, id);
			const result = await Submission.revise(submission, { fields, evidence, note });
			await audit(req, 'submission.update', 'submission', result.id, { resource: result.resource });
			this.#handleSuccess(res, this.#present(req, result));
		} catch (err) {
			this.#fail(res, next, err);
		}
	}

	/** PUT /moderation/approve { id, fields?, decisionNote? } (admin). */
	async approve(req, res, next) {
		const { id, fields, decisionNote, ifUnchangedSince } = req.body;
		try {
			const submission = this.requireFound(await Submission.read(id), 'Submission ' + id);
			if (
				fields !== undefined &&
				(!fields || typeof fields !== 'object' || Array.isArray(fields))
			) {
				throw new ValidationError('fields must be an object of reviewer edits.');
			}
			const result = await Submission.approve(submission, {
				reviewer: req.user.id,
				fields,
				decisionNote,
				ifUnchangedSince
			});
			await audit(req, 'submission.approve', 'submission', result.id, {
				resource: result.resource,
				kind: result.kind,
				targetId: result.targetId,
				changes: result.appliedChanges
			});
			await audit(
				req,
				result.resource + '.' + (result.kind === 'create' ? 'create' : 'update'),
				result.resource,
				result.targetId,
				{ viaSubmission: result.id, fields: result.appliedChanges }
			);
			await ModerationController.#announceDecision(req, result);
			this.#handleSuccess(res, this.#present(req, result));
		} catch (err) {
			this.#fail(res, next, err);
		}
	}

	/** PUT /moderation/reject { id, decisionNote } (admin). */
	async reject(req, res, next) {
		const { id, decisionNote } = req.body;
		try {
			const submission = this.requireFound(await Submission.read(id), 'Submission ' + id);
			if (submission.status !== 'pending') {
				throw new HttpError(
					409,
					'Submission ' + submission.id + ' is already ' + submission.status + '.',
					'SubmissionStateError'
				);
			}
			if (typeof decisionNote !== 'string' || decisionNote.trim() === '') {
				throw new ValidationError('decisionNote is required when rejecting.');
			}
			const result = await Submission.reject(submission, {
				reviewer: req.user.id,
				decisionNote: decisionNote.trim()
			});
			await audit(req, 'submission.reject', 'submission', result.id, {
				resource: result.resource,
				decisionNote: result.decisionNote
			});
			await ModerationController.#announceDecision(req, result);
			this.#handleSuccess(res, this.#present(req, result));
		} catch (err) {
			this.#fail(res, next, err);
		}
	}

	/** DELETE /moderation/submission { id }: withdraw (submitter or admin). */
	async remove(req, res, next) {
		const { id } = req.body;
		try {
			const submission = await this.#visible(req, id);
			const result = await Submission.withdraw(submission);
			await audit(req, 'submission.withdraw', 'submission', result.id, {
				resource: result.resource
			});
			this.#handleSuccess(res, this.#present(req, result));
		} catch (err) {
			this.#fail(res, next, err);
		}
	}

	/** GET /moderation/audit?actor=&action=&resource=&target=&page=&page_size= (admin). */
	async audit(req, res, next) {
		const { actor, action, resource, target, page, page_size } = req.query;
		const limits = this.#handleLimits(page, page_size);
		try {
			const where = {};
			if (actor !== undefined) {
				where.actor = actor;
			}
			if (action !== undefined) {
				where.action = action;
			}
			if (resource !== undefined) {
				where.resource = resource;
			}
			if (target !== undefined) {
				where.targetId = target;
			}
			const result = await AuditLog.list({ where, limit: limits.limit, offset: limits.offset });
			this.handlePage(res, result, limits);
		} catch (err) {
			this.#fail(res, next, err);
		}
	}

	/**
	 * GET /moderation/summary (admin): pending proposals per resource, records
	 * by recordStatus, and how many prisoners and prisons need re-verification.
	 */
	async summary(req, res, next) {
		try {
			const byStatus = async (Model) => {
				const out = Object.fromEntries(RECORD_STATUSES.map((s) => [s, 0]));
				const rows = await Model.findAll({
					attributes: [
						'recordStatus',
						[Model.sequelize.fn('COUNT', Model.sequelize.col('id')), 'n']
					],
					group: ['recordStatus'],
					raw: true
				});
				for (const row of rows) {
					out[row.recordStatus] = Number(row.n);
				}
				return out;
			};
			const summary = {
				pendingSubmissions: await Submission.pendingCounts(),
				records: {
					prisoner: await byStatus(Prisoner),
					prison: await byStatus(Prison),
					chapter: await byStatus(Chapter)
				},
				groups: {
					pendingApproval: await Chapter.count({ where: { accountStatus: 'pending' } }),
					suspended: await Chapter.count({ where: { accountStatus: 'suspended' } })
				},
				staleVerification: {
					prisoner: await Prisoner.count({ where: staleVerificationWhere() }),
					prison: await Prison.count({ where: staleVerificationWhere() })
				},
				// Prisoners whose mail came back as transferred, released, or undeliverable,
				// and whose record nobody has touched since (GET /prisoner/prisoners?addressInDoubt=true).
				addressInDoubt: {
					prisoner: await Prisoner.count({ where: Prisoner.addressInDoubtWhere() })
				},
				resources: Object.fromEntries(
					Object.entries(RESOURCES).map(([name, spec]) => [name, { submittable: spec.submittable }])
				)
			};
			this.#handleSuccess(res, summary);
		} catch (err) {
			this.#fail(res, next, err);
		}
	}
}

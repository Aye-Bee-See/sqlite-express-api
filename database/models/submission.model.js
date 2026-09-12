import { Model, Op } from 'sequelize';
import Schemas from '#schemas/all.schema.js';
import { SUBMISSION_KINDS, SUBMISSION_RESOURCES } from '#schemas/submission.schema.js';
import Prisoner, { PRISONER_FIELDS } from '#models/prisoner.model.js';
import Prison, { PRISON_FIELDS } from '#models/prison.model.js';
import Chapter, { CHAPTER_FIELDS } from '#models/chapter.model.js';
import ValidationError from '#services/ValidationError.js';
import { HttpError, NotFoundError } from '#services/HttpError.js';
import { publishedWhere } from '#db/record-status.js';

/** Fields a submitter may never propose directly, and never sees in a decision; a reviewer may set them on approval. */
export const REVIEWER_ONLY = [
	'verifiedBy',
	'verifiedAt',
	'verificationNotes',
	'recordStatus',
	'vouchedBy'
];

/** What each resource is, which fields may be proposed, and how to write it. */
export const RESOURCES = {
	prisoner: {
		model: Prisoner,
		label: 'Prisoner',
		fields: PRISONER_FIELDS,
		submittable: PRISONER_FIELDS.filter((f) => !REVIEWER_ONLY.includes(f)),
		create: (fields) => Prisoner.createPrisoner(fields),
		update: (fields) => Prisoner.updatePrisoner(fields)
	},
	prison: {
		model: Prison,
		label: 'Prison',
		fields: PRISON_FIELDS,
		submittable: PRISON_FIELDS.filter((f) => !REVIEWER_ONLY.includes(f)),
		create: (fields) => Prison.createPrison(fields),
		update: (fields) => Prison.updatePrison(fields)
	},
	chapter: {
		model: Chapter,
		label: 'Chapter',
		fields: CHAPTER_FIELDS,
		submittable: CHAPTER_FIELDS.filter(
			(f) => !REVIEWER_ONLY.includes(f) && !['lettersSent', 'averageTimeDays'].includes(f)
		),
		create: (fields) => Chapter.createChapter(fields),
		update: (fields) => Chapter.updateChapter(fields)
	}
};

function pick(source, fields) {
	const out = {};
	for (const field of fields) {
		if (source[field] !== undefined) {
			out[field] = source[field];
		}
	}
	return out;
}

export default class Submission extends Model {
	static init(sequelize) {
		return super.init(Schemas.submission, {
			sequelize,
			modelName: 'Submission',
			tableName: 'Submissions'
		});
	}

	static associate(models) {
		this.belongsTo(models.User, {
			as: 'submitter',
			foreignKey: 'submittedBy',
			onDelete: 'SET NULL',
			onUpdate: 'CASCADE'
		});
		this.belongsTo(models.User, {
			as: 'reviewer',
			foreignKey: 'reviewedBy',
			onDelete: 'SET NULL',
			onUpdate: 'CASCADE'
		});
	}

	static #people() {
		return [
			{ association: 'submitter', attributes: ['id', 'username', 'name', 'role'] },
			{ association: 'reviewer', attributes: ['id', 'username', 'name', 'role'] }
		];
	}

	/**
	 * File a proposal.
	 * @param {{resource: string, target?: number|string|null, fields: object, evidence?: string, note?: string, submittedBy: number, publishedOnly?: boolean}} input
	 *   `publishedOnly` limits the target to published records (non-staff callers).
	 * @throws {ValidationError} bad resource, empty, disallowed, or (for a new record) invalid fields; {NotFoundError} missing target
	 */
	static async propose({
		resource,
		target,
		fields,
		evidence,
		note,
		submittedBy,
		publishedOnly = true
	}) {
		const spec = RESOURCES[resource];
		if (!spec) {
			throw new ValidationError('resource must be one of ' + SUBMISSION_RESOURCES.join(', ') + '.');
		}
		if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
			throw new ValidationError('fields must be an object of proposed values.');
		}
		const disallowed = Object.keys(fields).filter((f) => !spec.submittable.includes(f));
		if (disallowed.length > 0) {
			throw new ValidationError(
				'These fields cannot be proposed for a ' +
					resource +
					': ' +
					disallowed.join(', ') +
					'. Allowed: ' +
					spec.submittable.join(', ') +
					'.'
			);
		}
		const payload = pick(fields, spec.submittable);
		if (Object.keys(payload).length === 0) {
			throw new ValidationError('Propose at least one field.');
		}
		const kind = target === undefined || target === null || target === '' ? 'create' : 'update';
		if (kind === 'update') {
			const existing = await spec.model.findOne({
				where: { id: target, ...publishedWhere(publishedOnly) }
			});
			if (!existing) {
				throw new NotFoundError(spec.label + ' ' + target + ' not found');
			}
		} else {
			// A new record must at least pass the model's own validation now,
			// so the submitter hears about a missing name today, not at review.
			await spec.model.build({ recordStatus: 'published', ...payload }).validate();
		}
		return await this.create({
			resource,
			kind,
			targetId: kind === 'update' ? Number(target) : null,
			payload,
			evidence: evidence || null,
			note: note || null,
			submittedBy
		});
	}

	/** One submission with the people involved, or null. */
	static async read(id) {
		return await this.findByPk(id, { include: this.#people() });
	}

	/**
	 * For an update proposal, the target's current values for the proposed
	 * fields, so a reviewer can see the diff. Null for creates, a target
	 * that has since been deleted, or one the caller may not see.
	 */
	static async currentValues(submission, publishedOnly = true) {
		if (submission.kind !== 'update') {
			return null;
		}
		const spec = RESOURCES[submission.resource];
		const target = await spec.model.findOne({
			where: { id: submission.targetId, ...publishedWhere(publishedOnly) }
		});
		if (!target) {
			return null;
		}
		return pick(target.get(), Object.keys(submission.payload));
	}

	/**
	 * A page of submissions, oldest first (the queue order).
	 * @param {{where?: object, limit?: number, offset?: number}} options
	 */
	static async list({ where = {}, limit, offset = 0 } = {}) {
		return await this.findAndCountAll({
			where,
			limit,
			offset,
			order: [['id', 'ASC']],
			include: this.#people()
		});
	}

	static #alreadyDecided(submission) {
		return new HttpError(
			409,
			'Submission ' + submission.id + ' is already ' + submission.status + '.',
			'SubmissionStateError'
		);
	}

	static #requirePending(submission) {
		if (submission.status !== 'pending') {
			throw Submission.#alreadyDecided(submission);
		}
	}

	/**
	 * Move a submission out of `pending` with a conditional update, so two
	 * concurrent decisions cannot both succeed. Resolves to false when
	 * someone else got there first.
	 */
	static async #transition(submission, values) {
		const [count] = await this.update(values, {
			where: { id: submission.id, status: 'pending' }
		});
		return count === 1;
	}

	/** Reload and throw the 409 for a submission that was decided concurrently. */
	static async #lost(submission) {
		const fresh = await this.findByPk(submission.id);
		throw Submission.#alreadyDecided(fresh || submission);
	}

	/**
	 * Apply a proposal, optionally with reviewer edits (any field of the
	 * resource, including the reviewer-only ones), then mark it approved.
	 * @param {Submission} submission
	 * @param {{reviewer: number, fields?: object, decisionNote?: string}} decision
	 * @returns {Promise<Submission>} refreshed
	 */
	static async approve(submission, { reviewer, fields = {}, decisionNote }) {
		Submission.#requirePending(submission);
		const spec = RESOURCES[submission.resource];
		const defaults = submission.kind === 'create' ? { recordStatus: 'published' } : {};
		const changes = { ...defaults, ...submission.payload, ...pick(fields || {}, spec.fields) };

		// Claim the row first so a second approver gets a 409 instead of a
		// second record; give it back if the write fails.
		const claimed = await Submission.#transition(submission, {
			status: 'approved',
			reviewedBy: reviewer,
			reviewedAt: new Date(),
			decisionNote: decisionNote || null,
			appliedChanges: changes
		});
		if (!claimed) {
			await Submission.#lost(submission);
		}
		let targetId = submission.targetId;
		try {
			if (submission.kind === 'update') {
				const [count] = await spec.update({ ...changes, id: targetId });
				if (count === 0) {
					throw new NotFoundError(spec.label + ' ' + targetId + ' no longer exists');
				}
			} else {
				const created = await spec.create(changes);
				targetId = created.id;
			}
		} catch (err) {
			await this.update(
				{
					status: 'pending',
					reviewedBy: null,
					reviewedAt: null,
					decisionNote: null,
					appliedChanges: null
				},
				{ where: { id: submission.id } }
			);
			throw err;
		}
		await this.update({ targetId }, { where: { id: submission.id } });
		return await this.read(submission.id);
	}

	/**
	 * Replace the proposed fields, evidence, or note of a pending proposal.
	 * Fields are validated as on propose; an omitted part is kept.
	 */
	static async revise(submission, { fields, evidence, note }) {
		Submission.#requirePending(submission);
		const spec = RESOURCES[submission.resource];
		const values = {};
		if (fields !== undefined) {
			if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
				throw new ValidationError('fields must be an object of proposed values.');
			}
			const disallowed = Object.keys(fields).filter((f) => !spec.submittable.includes(f));
			if (disallowed.length > 0) {
				throw new ValidationError(
					'These fields cannot be proposed for a ' +
						submission.resource +
						': ' +
						disallowed.join(', ') +
						'.'
				);
			}
			const payload = pick(fields, spec.submittable);
			if (Object.keys(payload).length === 0) {
				throw new ValidationError('Propose at least one field.');
			}
			values.payload = payload;
		}
		if (evidence !== undefined) {
			values.evidence = evidence || null;
		}
		if (note !== undefined) {
			values.note = note || null;
		}
		const [count] = await this.update(values, {
			where: { id: submission.id, status: 'pending' }
		});
		if (count === 0) {
			await Submission.#lost(submission);
		}
		return await this.read(submission.id);
	}

	static async reject(submission, { reviewer, decisionNote }) {
		Submission.#requirePending(submission);
		const done = await Submission.#transition(submission, {
			status: 'rejected',
			reviewedBy: reviewer,
			reviewedAt: new Date(),
			decisionNote
		});
		if (!done) {
			await Submission.#lost(submission);
		}
		return await this.read(submission.id);
	}

	static async withdraw(submission) {
		Submission.#requirePending(submission);
		const done = await Submission.#transition(submission, {
			status: 'withdrawn',
			reviewedAt: new Date()
		});
		if (!done) {
			await Submission.#lost(submission);
		}
		return await this.read(submission.id);
	}

	/** Pending counts per resource, for the dashboard. */
	static async pendingCounts() {
		const counts = Object.fromEntries(SUBMISSION_RESOURCES.map((r) => [r, 0]));
		const rows = await this.findAll({
			where: { status: 'pending' },
			attributes: ['resource', [this.sequelize.fn('COUNT', this.sequelize.col('id')), 'n']],
			group: ['resource'],
			raw: true
		});
		for (const row of rows) {
			counts[row.resource] = Number(row.n);
		}
		return counts;
	}
}

export { SUBMISSION_KINDS, SUBMISSION_RESOURCES, Op };

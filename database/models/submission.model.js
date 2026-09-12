import { Model, Op } from 'sequelize';
import Schemas from '#schemas/all.schema.js';
import { SUBMISSION_KINDS, SUBMISSION_RESOURCES } from '#schemas/submission.schema.js';
import Prisoner, { PRISONER_FIELDS } from '#models/prisoner.model.js';
import Prison, { PRISON_FIELDS } from '#models/prison.model.js';
import Chapter, { CHAPTER_FIELDS } from '#models/chapter.model.js';
import ValidationError from '#services/ValidationError.js';
import { HttpError, NotFoundError } from '#services/HttpError.js';

/** Fields a submitter may never propose directly; a reviewer may still set them on approval. */
const REVIEWER_ONLY = [
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
	 * @param {{resource: string, target?: number|string|null, fields: object, evidence?: string, note?: string, submittedBy: number}} input
	 * @throws {ValidationError} bad resource, empty or disallowed fields; {NotFoundError} missing target
	 */
	static async propose({ resource, target, fields, evidence, note, submittedBy }) {
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
		if (kind === 'update' && !(await spec.model.findByPk(target))) {
			throw new NotFoundError(spec.label + ' ' + target + ' not found');
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
	 * fields, so a reviewer can see the diff. Null for creates or a target
	 * that has since been deleted.
	 */
	static async currentValues(submission) {
		if (submission.kind !== 'update') {
			return null;
		}
		const spec = RESOURCES[submission.resource];
		const target = await spec.model.findByPk(submission.targetId);
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

	static #requirePending(submission) {
		if (submission.status !== 'pending') {
			throw new HttpError(
				409,
				'Submission ' + submission.id + ' is already ' + submission.status + '.',
				'SubmissionStateError'
			);
		}
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
		const changes = { ...submission.payload, ...pick(fields || {}, spec.fields) };
		let targetId = submission.targetId;
		if (submission.kind === 'update') {
			const [count] = await spec.update({ ...changes, id: targetId });
			if (count === 0) {
				throw new NotFoundError(spec.label + ' ' + targetId + ' no longer exists');
			}
		} else {
			const created = await spec.create({ recordStatus: 'published', ...changes });
			targetId = created.id;
		}
		await submission.update({
			status: 'approved',
			targetId,
			appliedChanges: changes,
			reviewedBy: reviewer,
			reviewedAt: new Date(),
			decisionNote: decisionNote || null
		});
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
		await submission.update(values);
		return await this.read(submission.id);
	}

	static async reject(submission, { reviewer, decisionNote }) {
		Submission.#requirePending(submission);
		await submission.update({
			status: 'rejected',
			reviewedBy: reviewer,
			reviewedAt: new Date(),
			decisionNote
		});
		return await this.read(submission.id);
	}

	static async withdraw(submission) {
		Submission.#requirePending(submission);
		await submission.update({ status: 'withdrawn', reviewedAt: new Date() });
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

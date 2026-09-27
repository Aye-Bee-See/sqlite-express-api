import { Op } from 'sequelize';
import Prisoner, { PRISONER_FIELDS } from '#models/prisoner.model.js';
import { photoVersion } from '#schemas/prisoner.schema.js';
import RouteController from '#rtControllers/route.controller.js';
import { publishedWhere } from '#db/record-status.js';
import { watchPrisoner, afterPrisonerChange } from '#rtServices/prisoner-change.services.js';
import { readOptions, SORT_BY_CREATED, filterValues } from '#rtControllers/directory.helpers.js';
import AuthzService from '#rtServices/authz.services.js';
import { staleVerificationWhere } from '#db/record-status.js';
import { audit } from '#rtServices/audit.services.js';
import AuditLog from '#models/audit-log.model.js';
import { changesBetween } from '#services/record-changes.js';
import Chapter from '#models/chapter.model.js';
import { NotFoundError } from '#services/HttpError.js';
import ValidationError from '#services/ValidationError.js';
import { stripMetadata } from '#services/image.js';
import { ALLOWED_TYPES, removeFile, sniffType, storeFile, storedPath } from '#services/files.js';
import { photoMaxBytes } from '#constants';
import { readFile } from 'node:fs/promises';

const READ_CONFIG = {
	table: 'Prisoner',
	searchFields: ['birthName', 'chosenName'],
	sorts: {
		name: [
			['chosenName', 'ASC'],
			['birthName', 'ASC']
		],
		...SORT_BY_CREATED
	},
	filters: {
		status: { allowed: ['pretrial', 'incarcerated', 'free'] },
		country: {},
		featured: { allowed: ['true', 'false'], transform: (v) => v === 'true' },
		stale: { allowed: ['true'], build: () => staleVerificationWhere() }
	}
};

export default class PrisonerController extends RouteController {
	constructor() {
		/*
		 * If we use class methods as subfunctions (or callbacks)
		 * JS loses where we are and thinks this is is something
		 * other than the instance of our class
		 */
		super('prisoner');
		this.getMany = this.getMany.bind(this);
		this.history = this.history.bind(this);
		this.filters = this.filters.bind(this);
		this.getOne = this.getOne.bind(this);
		this.update = this.update.bind(this);
		this.remove = this.remove.bind(this);
		this.create = this.create.bind(this);
		this.addSupport = this.addSupport.bind(this);
		this.removeSupport = this.removeSupport.bind(this);
		this.photo = this.photo.bind(this);
		this.createPhoto = this.createPhoto.bind(this);
		this.removePhoto = this.removePhoto.bind(this);
		this.photoEditor = this.photoEditor.bind(this);

		this.#handleErr = super.handleErr;
		this.#handleSuccess = super.handleSuccess;
		this.#handleLimits = super.handleLimits;
	}

	#handleSuccess;
	#handleErr;
	#handleLimits;

	/**
	 * List prisoners: page, page_size, full, q (name search), sort, status,
	 * prison (limit to one prison), and (staff only) recordStatus. full=true
	 * embeds the prison and support groups and, for admins listing by prison,
	 * each prisoner's chats.
	 */
	/**
	 * GET /prisoner/filters: the values the list pages build their filter chips
	 * from ([`country`, `status`]), each with a count, over the records the caller could list.
	 */
	async filters(req, res) {
		try {
			const { publishedOnly } = readOptions(req);
			const where = publishedOnly ? publishedWhere(true) : {};
			this.handleSuccess(res, await filterValues(Prisoner, ['country', 'status'], where));
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.handleErr(res, errorVar);
		}
	}

	/**
	 * GET /prisoner/history?id=: what has happened to one record, newest first.
	 * Staff only: it names the people who made each change and can carry
	 * staff-only field values. Paginated like any list.
	 */
	async history(req, res) {
		try {
			const { id, page, page_size } = req.query;
			const record = this.requireFound(await Prisoner.findByPk(id), 'Prisoner ' + id);
			const limits = this.handleLimits(page, page_size);
			const rows = await AuditLog.forRecord('prisoner', record.id, {
				limit: limits.limit,
				offset: limits.offset
			});
			this.handlePage(
				res,
				{ rows: rows.rows.map((row) => AuditLog.asHistory(row)), count: rows.count },
				limits
			);
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.handleErr(res, errorVar);
		}
	}

	async getMany(req, res) {
		const { prison, full, page, page_size } = req.query;
		const limits = this.#handleLimits(page, page_size);
		const { publishedOnly, where, order } = readOptions(req, READ_CONFIG);
		if (req.query.addressInDoubt === 'true' && !publishedOnly) {
			// Staff only (ignored for everyone else, like recordStatus): that somebody's
			// mail came back is not for the public directory.
			where[Op.and] = [...(where[Op.and] || []), Prisoner.addressInDoubtWhere()];
		}
		const options = {
			full: full === 'true',
			limit: limits.limit,
			offset: limits.offset,
			publishedOnly,
			withChats: AuthzService.isAdmin(req),
			where,
			order
		};

		try {
			const result =
				prison !== undefined
					? await Prisoner.getPrisonersByPrison(prison, options)
					: await Prisoner.getAllPrisoners(options);
			this.handlePage(res, result, limits);
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	// get one prisoner

	async getOne(req, res) {
		const { id, full } = req.query;
		const { publishedOnly } = readOptions(req);
		try {
			const prisoner = await Prisoner.getPrisonerByID(id, { full: full === 'true', publishedOnly });
			this.#handleSuccess(res, this.requireFound(prisoner, 'Prisoner ' + id));
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}
	// Create
	async create(req, res) {
		try {
			const prisoner = await Prisoner.createPrisoner(req.body);
			await audit(req, 'prisoner.create', 'prisoner', prisoner.id, { fields: req.body });
			this.#handleSuccess(res, prisoner);
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

	/** PUT /prisoner/support { prisoner, chapter, description? }: link a support group. */
	async addSupport(req, res, next) {
		const { prisoner, chapter, description } = req.body;
		try {
			await this.#ownGroupOnly(req, chapter);
			const updated = await Prisoner.addSupport(prisoner, chapter, description);
			await audit(req, 'prisoner.support.add', 'prisoner', prisoner, { chapter, description });
			this.#handleSuccess(res, { prisoner: updated, chapter });
		} catch (err) {
			if (err && err.status === 403) {
				return next(err);
			}
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	/** DELETE /prisoner/support { prisoner, chapter }: unlink a support group. */
	async removeSupport(req, res, next) {
		const { prisoner, chapter } = req.body;
		try {
			await this.#ownGroupOnly(req, chapter);
			const removed = await Prisoner.removeSupport(prisoner, chapter);
			this.requireAffected(
				removed,
				'Support link for prisoner ' + prisoner + ' and chapter ' + chapter
			);
			await audit(req, 'prisoner.support.remove', 'prisoner', prisoner, { chapter });
			this.#handleSuccess(res, removed);
		} catch (err) {
			if (err && err.status === 403) {
				return next(err);
			}
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	// Photos

	/** Image types a photo may be: the picture formats, never a PDF. */
	static #PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

	/**
	 * Who may put a photo on a record: a superadmin, or the group-owner admin
	 * of an active group (decided 26 September 2026). A photo is published at
	 * once and is the one part of a record a group changes without a proposal,
	 * so it is kept to the person each group has already made answerable for it.
	 * @throws {Error} 403
	 */
	async #requirePhotoEditor(req) {
		if (AuthzService.isAdmin(req)) {
			return;
		}
		const chapterId = await AuthzService.activeChapterOf(req);
		if (chapterId) {
			const chapter = await Chapter.findByPk(chapterId, { attributes: ['id', 'ownerId'] });
			if (chapter && String(chapter.ownerId) === String(req.user.id)) {
				return;
			}
		}
		throw AuthzService.forbidden(
			'Only a superadmin, or the group-owner admin of an active group, may change a photo.'
		);
	}

	/** Middleware: refuse an uploader before their file is read. */
	async photoEditor(req, res, next) {
		try {
			await this.#requirePhotoEditor(req);
			next();
		} catch (err) {
			next(err);
		}
	}

	/** The record, refusing one the caller may not even see. */
	async #photoRecord(req, id) {
		if (id === undefined || id === null || id === '') {
			throw new ValidationError({
				message: 'prisoner is required.',
				field: 'prisoner',
				code: 'required'
			});
		}
		const prisoner = this.requireFound(await Prisoner.findByPk(id), 'Prisoner ' + id);
		if (AuthzService.publishedOnly(req) && prisoner.recordStatus !== 'published') {
			// A record only staff may see keeps its photo to staff as well.
			throw new NotFoundError('Prisoner ' + id + ' not found');
		}
		return prisoner;
	}

	/**
	 * GET /prisoner/photo?prisoner=&v=: the picture itself, for an <img> tag.
	 * Public, like the record it belongs to.
	 *
	 * Checked with the server every time it is shown (`no-cache`, answered with
	 * a bodiless 304 while it is unchanged), so a photo taken down or replaced
	 * is gone at once rather than a day later. A photo on a record only staff
	 * may see is marked `private`, so no shared cache keeps a copy to hand out.
	 */
	async photo(req, res) {
		try {
			const prisoner = await this.#photoRecord(req, req.query.prisoner);
			const file = prisoner.getDataValue('photoFile');
			if (!file) {
				throw new NotFoundError('Prisoner ' + prisoner.id + ' has no photo here');
			}
			let bytes;
			try {
				bytes = await readFile(storedPath(file));
			} catch {
				throw new NotFoundError('The photo file for prisoner ' + prisoner.id + ' is missing');
			}
			const mime =
				Object.entries(ALLOWED_TYPES).find(([, t]) => file.endsWith('.' + t.ext))?.[0] ??
				'application/octet-stream';
			const etag = '"' + photoVersion(prisoner.photoAddedAt) + '"';
			res.setHeader(
				'Cache-Control',
				prisoner.recordStatus === 'published' ? 'public, no-cache' : 'private, no-cache'
			);
			res.setHeader('ETag', etag);
			if (req.headers['if-none-match'] === etag) {
				return res.status(304).end();
			}
			res.setHeader('Content-Type', mime);
			res.setHeader('Content-Length', bytes.length);
			res.send(bytes);
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	/**
	 * POST /prisoner/photo (multipart): the file in `photo`, the record in
	 * `prisoner`, and an optional `credit` line. Replaces whatever was there,
	 * and the file it replaces is deleted. Everything describing where the
	 * picture came from is removed before it is stored (services/image.js).
	 */
	async createPhoto(req, res) {
		try {
			await this.#requirePhotoEditor(req);
			const prisoner = await this.#photoRecord(req, req.body.prisoner);
			if (!req.file) {
				throw new ValidationError({
					message: 'Send the image in a "photo" field.',
					field: 'photo',
					code: 'required'
				});
			}
			const mime = sniffType(req.file.buffer);
			if (!mime || !PrisonerController.#PHOTO_TYPES.includes(mime)) {
				throw new ValidationError({
					message: 'A photo must be a JPEG, PNG, or WebP image; this file is not one.',
					field: 'photo',
					code: 'not_allowed_value',
					params: { allowed: PrisonerController.#PHOTO_TYPES }
				});
			}
			if (req.file.size > photoMaxBytes) {
				throw new ValidationError({
					message:
						'A photo can be at most ' +
						photoMaxBytes +
						' bytes; this one is ' +
						req.file.size +
						'.',
					field: 'photo',
					code: 'out_of_range',
					params: { max: photoMaxBytes }
				});
			}
			const credit = req.body.credit === undefined ? null : String(req.body.credit).trim() || null;
			if (credit && credit.length > 200) {
				throw new ValidationError({
					message: 'Photo credit can be at most 200 characters.',
					field: 'credit',
					code: 'length_out_of_range',
					params: { min: 0, max: 200 }
				});
			}
			const clean = stripMetadata(req.file.buffer, mime);
			const stored = await storeFile(clean, mime);
			const previous = prisoner.getDataValue('photoFile');
			await prisoner.update({
				photoFile: stored,
				photoCredit: credit,
				photoAddedAt: new Date(),
				photoAddedBy: req.user.id
			});
			if (previous && previous !== stored) {
				// Only once the row points at the new file: a crash leaves a spare
				// file on disk, never a record pointing at a file that is gone.
				await removeFile(previous);
			}
			await audit(req, 'prisoner.photo', 'prisoner', prisoner.id, { credit, replaced: previous });
			this.#handleSuccess(res, {
				id: prisoner.id,
				photo: prisoner.photo,
				bytesStored: clean.length,
				bytesUploaded: req.file.size
			});
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	/** DELETE /prisoner/photo { prisoner }: take the photo down and delete the file. */
	async removePhoto(req, res) {
		try {
			await this.#requirePhotoEditor(req);
			const prisoner = await this.#photoRecord(req, req.body.prisoner);
			const previous = prisoner.getDataValue('photoFile');
			if (!previous) {
				throw new NotFoundError('Prisoner ' + prisoner.id + ' has no photo here');
			}
			await prisoner.update({
				photoFile: null,
				photoCredit: null,
				photoAddedAt: null,
				photoAddedBy: null
			});
			await removeFile(previous);
			await audit(req, 'prisoner.photo.remove', 'prisoner', prisoner.id);
			this.#handleSuccess(res, { id: prisoner.id, photo: prisoner.photo });
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	// Update

	async update(req, res) {
		const newPrisoner = req.body;
		try {
			const before = await watchPrisoner(newPrisoner.id);
			// The row as it was, for the history: what a request sent is not what changed.
			const was = await Prisoner.findByPk(newPrisoner.id);
			const updatedRows = await Prisoner.updatePrisoner(newPrisoner);
			this.requireAffected(updatedRows, 'Prisoner ' + newPrisoner.id);
			await audit(req, 'prisoner.update', 'prisoner', newPrisoner.id, {
				changes: changesBetween(was, newPrisoner, PRISONER_FIELDS)
			});
			// Moved or freed: their writers are told, and queued letters re-routed or held.
			const mail = await afterPrisonerChange(req, before);
			const changed = mail && (mail.moved || mail.freed || mail.released > 0);
			this.#handleSuccess(res, { updatedRows, newPrisoner, ...(changed ? { mail } : {}) });
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	// Delete
	async remove(req, res) {
		const { id } = req.body;
		try {
			const deletedRows = await Prisoner.deletePrisoner(id);
			this.requireAffected(deletedRows, 'Prisoner ' + id);
			await audit(req, 'prisoner.delete', 'prisoner', id);
			this.#handleSuccess(res, deletedRows);
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}
}

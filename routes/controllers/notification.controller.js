import RouteController from '#rtControllers/route.controller.js';
import authService from '#rtServices/auth.services.js';
import Device from '#models/device.model.js';
import Notification from '#models/notification.model.js';
import ValidationError from '#services/ValidationError.js';
import * as push from '#services/push.js';

/**
 * Devices and the notification feed, under /auth.
 *
 * A push from this API says only "sync". What happened is in the feed,
 * which the app reads over its own connection; letter text is never in
 * either, and in end-to-end mode the server could not put it there anyway.
 */
export default class NotificationController extends RouteController {
	constructor() {
		super('notification');
		this.create = this.create.bind(this);
		this.getOne = this.getOne.bind(this);
		this.updateDevice = this.updateDevice.bind(this);
		this.remove = this.remove.bind(this);
		this.getMany = this.getMany.bind(this);
		this.update = this.update.bind(this);

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

	/**
	 * POST /auth/device { token, platform, provider?, label? } (create): register
	 * this device for pushes, or refresh it. Call it after every sign-in and
	 * whenever the push service issues a new token. Registering the same
	 * token again is fine; a token that was another account's moves to the caller.
	 */
	async create(req, res, next) {
		const { token, platform, provider, label } = req.body;
		try {
			const payload = authService.tokenPayload(req) || {};
			const { device, created } = await Device.register({
				userId: req.user.id,
				token,
				platform,
				provider,
				label,
				sessionId: payload.jti || null
			});
			this.#handleSuccess(res, {
				...device.toJSON(),
				created,
				// Whether a push can actually be sent today; the registration is kept either way.
				deliverable: push.available().includes(device.provider)
			});
		} catch (err) {
			this.#fail(res, next, err);
		}
	}

	/** GET /auth/devices (getOne, for the base controller's interface): the caller's devices, without tokens. */
	async getOne(req, res, next) {
		try {
			const devices = await Device.findAll({
				where: { userId: req.user.id },
				order: [['id', 'ASC']]
			});
			this.#handleSuccess(res, devices);
		} catch (err) {
			this.#fail(res, next, err);
		}
	}

	/** PUT /auth/device { id, muted?, label? }: silence or rename one of the caller's devices. */
	async updateDevice(req, res, next) {
		const { id, muted, label } = req.body;
		try {
			if (muted !== undefined && typeof muted !== 'boolean') {
				throw new ValidationError('muted must be true or false.');
			}
			const device = this.requireFound(
				await Device.findOne({ where: { id: id ?? null, userId: req.user.id } }),
				'Device ' + id
			);
			device.set({
				...(muted !== undefined ? { muted } : {}),
				...(label !== undefined ? { label } : {})
			});
			await device.save();
			this.#handleSuccess(res, device);
		} catch (err) {
			this.#fail(res, next, err);
		}
	}

	/**
	 * DELETE /auth/device { id } or { token } (remove): stop pushes to a device.
	 * Signing out does this for the device that signed in; this is for turning
	 * notifications off while staying signed in, or removing a lost phone.
	 */
	async remove(req, res, next) {
		const { id, token } = req.body || {};
		try {
			if (id === undefined && token === undefined) {
				throw new ValidationError('Give the device id or its token.');
			}
			const where = { userId: req.user.id, ...(id !== undefined ? { id } : { token }) };
			const removed = await Device.destroy({ where });
			this.#handleSuccess(res, this.requireAffected(removed, 'Device'));
		} catch (err) {
			this.#fail(res, next, err);
		}
	}

	/**
	 * GET /auth/notifications?since=&unread=&page=&page_size= (getMany): the
	 * caller's feed, newest first, with the unread count beside the page.
	 */
	async getMany(req, res, next) {
		const { since, unread, page, page_size } = req.query;
		try {
			const limits = this.#handleLimits(page, page_size);
			let after;
			if (since !== undefined && since !== '') {
				after = Number(since);
				if (!Number.isInteger(after) || after < 0) {
					throw new ValidationError('since must be the id of the newest entry you already have.');
				}
			}
			const result = await Notification.feed(req.user.id, {
				since: after,
				unread: unread === 'true',
				limit: limits.limit,
				offset: limits.offset
			});
			this.#handleSuccess(res, result.rows, 'par', {
				total: result.count,
				page: limits.page,
				page_size: limits.pageSize,
				unread: await Notification.unreadCount(req.user.id)
			});
		} catch (err) {
			this.#fail(res, next, err);
		}
	}

	/** PUT /auth/notifications/read { ids? | upTo? } (update): mark entries read; with neither, all of them. */
	async update(req, res, next) {
		const { ids, upTo } = req.body || {};
		try {
			if (ids !== undefined && (!Array.isArray(ids) || ids.some((id) => !Number.isInteger(id)))) {
				throw new ValidationError('ids must be an array of notification ids.');
			}
			if (upTo !== undefined && !Number.isInteger(upTo)) {
				throw new ValidationError('upTo must be a notification id.');
			}
			const marked = await Notification.markRead(req.user.id, { ids, upTo });
			this.#handleSuccess(res, {
				marked,
				unread: await Notification.unreadCount(req.user.id)
			});
		} catch (err) {
			this.#fail(res, next, err);
		}
	}
}

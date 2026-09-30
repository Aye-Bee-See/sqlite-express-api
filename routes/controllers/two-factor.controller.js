import { Op } from 'sequelize';
import RouteController from '#rtControllers/route.controller.js';
import User from '#models/user.model.js';
import TwoFactorRecoveryCode, {
	RECOVERY_CODE_COUNT
} from '#models/two-factor-recovery-code.model.js';
import ValidationError from '#services/ValidationError.js';
import { HttpError, NotFoundError } from '#services/HttpError.js';
import { audit } from '#rtServices/audit.services.js';
import * as totp from '#services/totp.js';

/**
 * Two-factor sign-in for one's own account (decided 30 September 2026): an
 * authenticator-app code, and one-time recovery codes for a lost phone. Optional
 * for everyone, writers included. The sign-in step itself is
 * POST /auth/login/two-factor, in the user routes.
 */
export default class TwoFactorController extends RouteController {
	constructor() {
		super('twoFactor');
		this.getOne = this.getOne.bind(this);
		this.setup = this.setup.bind(this);
		this.confirm = this.confirm.bind(this);
		this.remove = this.remove.bind(this);
		this.recoveryCodes = this.recoveryCodes.bind(this);
		this.#handleSuccess = super.handleSuccess;
		this.#handleErr = super.handleErr;
	}

	#handleSuccess;
	#handleErr;

	#fail(res, next, err) {
		if (err && (err.status === 401 || err.status === 403 || err.status === 429)) {
			return next(err);
		}
		this.#handleErr(res, !(err instanceof Error) ? new Error(err) : err);
	}

	/** The refusal for a code that does not fit, on the field it came in. */
	static wrongCode(field = 'code') {
		return new ValidationError({
			message:
				field === 'recoveryCode'
					? "That recovery code is not one of this account's, or was used already."
					: 'That code is not right. Check the time on your phone, and use the newest code.',
			field,
			code: 'not_eligible'
		});
	}

	/**
	 * Accept a code from the authenticator app for this account, once: the time
	 * step it belongs to is recorded, and a code from that step or an earlier one
	 * is refused from then on. Written conditionally, so two requests with the
	 * same code cannot both pass.
	 * @throws {ValidationError}
	 */
	static async acceptCode(user, code, { secret = user.totpSecret } = {}) {
		const step = totp.verify(secret, code, { after: user.totpLastStep });
		if (step === null) {
			throw TwoFactorController.wrongCode('code');
		}
		const [moved] = await User.update(
			{ totpLastStep: step },
			{
				where: {
					id: user.id,
					[Op.or]: [{ totpLastStep: null }, { totpLastStep: { [Op.lt]: step } }]
				},
				hooks: false
			}
		);
		if (moved !== 1) {
			throw TwoFactorController.wrongCode('code');
		}
		return step;
	}

	static async #me(req) {
		return await User.scope('withTwoFactor').findByPk(req.user.id);
	}

	/** GET /auth/two-factor: is it on, since when, and how many recovery codes are left. */
	async getOne(req, res, next) {
		try {
			const me = await TwoFactorController.#me(req);
			this.#handleSuccess(res, {
				enabled: Boolean(me.totpEnabledAt),
				enabledAt: me.totpEnabledAt ?? null,
				settingUp: !me.totpEnabledAt && Boolean(me.totpPendingSecret),
				recoveryCodesLeft: me.totpEnabledAt ? await TwoFactorRecoveryCode.left(me.id) : 0
			});
		} catch (err) {
			this.#fail(res, next, err);
		}
	}

	/**
	 * POST /auth/two-factor/setup: a new secret to put in an authenticator app,
	 * with the link a client shows as a QR code. Nothing changes until it is
	 * confirmed with a code; asking again replaces the secret being set up.
	 */
	async setup(req, res, next) {
		try {
			const me = await TwoFactorController.#me(req);
			if (me.totpEnabledAt) {
				const err = new HttpError(
					409,
					'Two-factor sign-in is on already. Switch it off first to move it to another phone.',
					'TwoFactorError'
				);
				err.condition = 'enabled';
				throw err;
			}
			const secret = totp.newSecret();
			await User.update({ totpPendingSecret: secret }, { where: { id: me.id }, hooks: false });
			this.#handleSuccess(res, {
				secret,
				otpauthUri: totp.otpauthUri(secret, me.username)
			});
		} catch (err) {
			this.#fail(res, next, err);
		}
	}

	/**
	 * POST /auth/two-factor/confirm { code }: the first code from the app, which
	 * proves it was set up. Two-factor sign-in is on from now, and the recovery
	 * codes are answered, the only time they are seen.
	 */
	async confirm(req, res, next) {
		try {
			const me = await TwoFactorController.#me(req);
			if (me.totpEnabledAt) {
				const err = new HttpError(409, 'Two-factor sign-in is on already.', 'TwoFactorError');
				err.condition = 'enabled';
				throw err;
			}
			if (!me.totpPendingSecret) {
				throw new ValidationError({
					message: 'Start with POST /auth/two-factor/setup.',
					field: 'code',
					code: 'not_eligible'
				});
			}
			const step = totp.verify(me.totpPendingSecret, req.body.code);
			if (step === null) {
				throw TwoFactorController.wrongCode('code');
			}
			const enabledAt = new Date();
			const [done] = await User.update(
				{
					totpSecret: me.totpPendingSecret,
					totpPendingSecret: null,
					totpEnabledAt: enabledAt,
					totpLastStep: step
				},
				{
					where: { id: me.id, totpEnabledAt: null, totpPendingSecret: me.totpPendingSecret },
					hooks: false
				}
			);
			if (done !== 1) {
				const err = new HttpError(
					409,
					'Two-factor sign-in changed meanwhile; read it again.',
					'TwoFactorError'
				);
				err.condition = 'changed_meanwhile';
				throw err;
			}
			const recoveryCodes = await TwoFactorRecoveryCode.replaceFor(me.id);
			await audit(req, 'user.two-factor.enable', 'user', me.id);
			this.#handleSuccess(res, { enabled: true, enabledAt, recoveryCodes });
		} catch (err) {
			this.#fail(res, next, err);
		}
	}

	/** A code from the app, or a recovery code, for changing the setting. */
	static async #proveFactor(me, { code, recoveryCode }) {
		if (recoveryCode !== undefined && recoveryCode !== null && recoveryCode !== '') {
			if (!(await TwoFactorRecoveryCode.use(me.id, recoveryCode))) {
				throw TwoFactorController.wrongCode('recoveryCode');
			}
			return 'recovery code';
		}
		if (code === undefined || code === null || code === '') {
			throw new ValidationError({
				message:
					'Send a code from your authenticator app (code), or a recovery code (recoveryCode).',
				field: 'code',
				code: 'required'
			});
		}
		await TwoFactorController.acceptCode(me, code);
		return 'code';
	}

	static #requireOn(me) {
		if (!me.totpEnabledAt) {
			const err = new HttpError(409, 'Two-factor sign-in is not on.', 'TwoFactorError');
			err.condition = 'not_enabled';
			throw err;
		}
	}

	/**
	 * DELETE /auth/two-factor { code } or { recoveryCode }: switch it off. A session
	 * alone is not enough: whoever does it shows the second factor too.
	 */
	async remove(req, res, next) {
		try {
			const me = await TwoFactorController.#me(req);
			TwoFactorController.#requireOn(me);
			const by = await TwoFactorController.#proveFactor(me, req.body);
			await User.update(
				{ totpSecret: null, totpPendingSecret: null, totpEnabledAt: null, totpLastStep: null },
				{ where: { id: me.id }, hooks: false }
			);
			await TwoFactorRecoveryCode.clear(me.id);
			await audit(req, 'user.two-factor.disable', 'user', me.id, { by });
			this.#handleSuccess(res, { enabled: false });
		} catch (err) {
			this.#fail(res, next, err);
		}
	}

	/**
	 * POST /auth/two-factor/recovery-codes { code }: a fresh set of recovery codes;
	 * the old ones stop working.
	 */
	async recoveryCodes(req, res, next) {
		try {
			const me = await TwoFactorController.#me(req);
			TwoFactorController.#requireOn(me);
			await TwoFactorController.#proveFactor(me, { code: req.body.code });
			const recoveryCodes = await TwoFactorRecoveryCode.replaceFor(me.id);
			await audit(req, 'user.two-factor.recovery-codes', 'user', me.id, {
				count: RECOVERY_CODE_COUNT
			});
			this.#handleSuccess(res, { recoveryCodes });
		} catch (err) {
			this.#fail(res, next, err);
		}
	}

	// Not routed: there is one setting per account, read with getOne.
	async getMany(req, res, next) {
		next(
			new NotFoundError('Two-factor sign-in is read one account at a time (GET /auth/two-factor).')
		);
	}
	async create(req, res, next) {
		next(new NotFoundError('Set up with POST /auth/two-factor/setup.'));
	}
	async update(req, res, next) {
		next(new NotFoundError('Two-factor sign-in is switched on and off, not edited.'));
	}
}

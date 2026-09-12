import RouteController from '#rtControllers/route.controller.js';
import AuthzService from '#rtServices/authz.services.js';
import User, { KEY_INPUT } from '#models/user.model.js';
import Chapter from '#models/chapter.model.js';
import OrgMemberKey from '#models/org-member-key.model.js';
import ValidationError from '#services/ValidationError.js';
import { HttpError } from '#services/HttpError.js';
import * as crypto from '#services/crypto.js';
import { audit } from '#rtServices/audit.services.js';

/** How long a recovery challenge stays valid. */
const RECOVERY_CHALLENGE_MS = 10 * 60 * 1000;

/**
 * Key material for end-to-end mode. The server stores public keys and
 * wrapped private keys and never sees a password-derived key, a recovery
 * code, or an unwrapped private key. Every handler here works in either
 * encryption mode so clients can set up keys before the switch.
 */
export default class KeysController extends RouteController {
	constructor() {
		super('keys');
		this.getOne = this.getOne.bind(this);
		this.update = this.update.bind(this);
		this.publicKey = this.publicKey.bind(this);
		this.recoverChallenge = this.recoverChallenge.bind(this);
		this.create = this.create.bind(this);
		this.chapterKeys = this.chapterKeys.bind(this);
		this.putMemberKey = this.putMemberKey.bind(this);
		this.remove = this.remove.bind(this);
		this.getMany = this.getMany.bind(this);

		this.#handleErr = super.handleErr;
		this.#handleSuccess = super.handleSuccess;
	}

	#handleSuccess;
	#handleErr;

	#fail(res, next, err) {
		if (err && err.status === 403) {
			return next(err);
		}
		const errorVar = !(err instanceof Error) ? new Error(err) : err;
		this.#handleErr(res, errorVar);
	}

	/** The key fields a client sent, validated for shape. */
	static #keyFields(body, { requireAll = false } = {}) {
		const out = {};
		for (const field of KEY_INPUT) {
			if (body[field] !== undefined) {
				out[field] = body[field];
			}
		}
		if (out.publicKey !== undefined && !crypto.isPublicKey(out.publicKey)) {
			throw new ValidationError('publicKey must be a base64 X25519 public key (32 bytes).');
		}
		for (const field of [
			'wrappedPrivateKey',
			'kdfSalt',
			'recoveryWrappedPrivateKey',
			'recoverySalt'
		]) {
			if (out[field] !== undefined && (typeof out[field] !== 'string' || out[field] === '')) {
				throw new ValidationError(field + ' must be a non-empty string.');
			}
		}
		for (const field of ['kdfParams', 'recoveryKdfParams']) {
			if (out[field] !== undefined && (typeof out[field] !== 'object' || out[field] === null)) {
				throw new ValidationError(field + ' must be an object.');
			}
		}
		const wrapped = ['wrappedPrivateKey', 'kdfSalt', 'kdfParams'];
		const present = wrapped.filter((f) => out[f] !== undefined);
		if (present.length > 0 && present.length < wrapped.length) {
			throw new ValidationError('wrappedPrivateKey, kdfSalt, and kdfParams go together.');
		}
		const recovery = ['recoveryWrappedPrivateKey', 'recoverySalt', 'recoveryKdfParams'];
		const recoveryPresent = recovery.filter((f) => out[f] !== undefined);
		if (recoveryPresent.length > 0 && recoveryPresent.length < recovery.length) {
			throw new ValidationError(
				'recoveryWrappedPrivateKey, recoverySalt, and recoveryKdfParams go together.'
			);
		}
		if (requireAll) {
			const missing = [...wrapped, 'publicKey'].filter((f) => out[f] === undefined);
			if (missing.length > 0) {
				throw new ValidationError('Missing key material: ' + missing.join(', ') + '.');
			}
		}
		return out;
	}

	static keyFields(body, options) {
		return KeysController.#keyFields(body, options);
	}

	/** The caller's own key material plus, for group members, their wrapped group key. */
	static async keyBundle(userId) {
		const user = await User.getUserWithKeys({ id: userId });
		if (!user) {
			return null;
		}
		const bundle = {
			publicKey: user.publicKey,
			wrappedPrivateKey: user.wrappedPrivateKey,
			kdfSalt: user.kdfSalt,
			kdfParams: user.kdfParams,
			hasRecovery: Boolean(user.recoveryWrappedPrivateKey),
			orgKey: null
		};
		if (user.chapterId) {
			const [chapter, memberKey] = await Promise.all([
				Chapter.findByPk(user.chapterId, { attributes: ['id', 'name', 'publicKey'] }),
				OrgMemberKey.forMember(user.chapterId, user.id)
			]);
			if (chapter) {
				bundle.orgKey = {
					chapterId: chapter.id,
					chapterName: chapter.name,
					chapterPublicKey: chapter.publicKey,
					wrappedOrgPrivateKey: memberKey ? memberKey.wrappedOrgPrivateKey : null
				};
			}
		}
		return bundle;
	}

	/** GET /auth/keys: the caller's key bundle. (getOne, for the base controller's interface.) */
	async getOne(req, res, next) {
		try {
			this.#handleSuccess(res, await KeysController.keyBundle(req.user.id));
		} catch (err) {
			this.#fail(res, next, err);
		}
	}

	/**
	 * PUT /auth/keys (update): set or re-wrap the caller's keys. The public key can be
	 * set once; changing it would orphan every envelope sealed to it.
	 */
	async update(req, res, next) {
		try {
			const fields = KeysController.#keyFields(req.body);
			if (Object.keys(fields).length === 0) {
				throw new ValidationError('Send at least one key field.');
			}
			const user = await User.getUserWithKeys({ id: req.user.id });
			if (fields.publicKey !== undefined && user.publicKey && fields.publicKey !== user.publicKey) {
				throw new HttpError(
					409,
					'The public key is already set and cannot change; envelopes are sealed to it.',
					'KeyChangeError'
				);
			}
			if (
				fields.publicKey === undefined &&
				!user.publicKey &&
				fields.wrappedPrivateKey !== undefined
			) {
				throw new ValidationError('Send publicKey together with the first wrapped private key.');
			}
			const where = { id: req.user.id };
			if (fields.publicKey !== undefined && !user.publicKey) {
				// First set: only if nobody set it in the meantime.
				where.publicKey = null;
			}
			const [count] = await User.update(fields, { where });
			if (count === 0) {
				throw new HttpError(
					409,
					'The public key was set by another request; reload your keys.',
					'KeyChangeError'
				);
			}
			await audit(req, 'user.keys', 'user', req.user.id, { fields: Object.keys(fields) });
			this.#handleSuccess(res, await KeysController.keyBundle(req.user.id));
		} catch (err) {
			this.#fail(res, next, err);
		}
	}

	/** GET /auth/public-key?user=|chapter=: a public key to seal an envelope to. */
	async publicKey(req, res, next) {
		const { user, chapter } = req.query;
		try {
			if (user !== undefined) {
				const target = this.requireFound(
					await User.findByPk(user, { attributes: ['id', 'publicKey'] }),
					'User ' + user
				);
				return this.#handleSuccess(res, { user: target.id, publicKey: target.publicKey });
			}
			if (chapter !== undefined) {
				const target = this.requireFound(
					await Chapter.findByPk(chapter, { attributes: ['id', 'publicKey'] }),
					'Chapter ' + chapter
				);
				return this.#handleSuccess(res, { chapter: target.id, publicKey: target.publicKey });
			}
			throw new ValidationError('Give user or chapter.');
		} catch (err) {
			this.#fail(res, next, err);
		}
	}

	/**
	 * GET /auth/recover?username=: start recovery. Returns the recovery-wrapped
	 * private key and a challenge sealed to the account's public key; only
	 * the holder of the recovery code can open both.
	 */
	async recoverChallenge(req, res, next) {
		const { username } = req.query;
		try {
			const user = await User.getUserWithKeys({ username: String(username || '') });
			if (!user || !user.publicKey || !user.recoveryWrappedPrivateKey) {
				throw new HttpError(404, 'No recoverable account with that username.', 'NotFoundError');
			}
			const challenge = crypto.randomToken(32);
			await User.update(
				{
					recoveryChallengeHash: crypto.fingerprint(challenge),
					recoveryChallengeExpiresAt: new Date(Date.now() + RECOVERY_CHALLENGE_MS)
				},
				{ where: { id: user.id } }
			);
			this.#handleSuccess(res, {
				user: user.id,
				publicKey: user.publicKey,
				recoveryWrappedPrivateKey: user.recoveryWrappedPrivateKey,
				recoverySalt: user.recoverySalt,
				recoveryKdfParams: user.recoveryKdfParams,
				sealedChallenge: crypto.sealTo(user.publicKey, crypto.decode(challenge)),
				expiresIn: RECOVERY_CHALLENGE_MS / 1000
			});
		} catch (err) {
			this.#fail(res, next, err);
		}
	}

	/**
	 * POST /auth/recover (create) { username, challenge, password, wrappedPrivateKey,
	 * kdfSalt, kdfParams, recovery* }: finish recovery. The opened challenge
	 * proves possession of the private key; the new password wraps it again.
	 */
	async create(req, res, next) {
		const { username, challenge, password } = req.body;
		try {
			const user = await User.getUserWithKeys({ username: String(username || '') });
			const valid =
				user &&
				user.recoveryChallengeHash &&
				user.recoveryChallengeExpiresAt &&
				user.recoveryChallengeExpiresAt.getTime() > Date.now() &&
				typeof challenge === 'string' &&
				crypto.fingerprint(challenge) === user.recoveryChallengeHash;
			if (!valid) {
				throw new HttpError(
					401,
					'Recovery challenge is missing, wrong, or expired.',
					'RecoveryError'
				);
			}
			if (typeof password !== 'string' || password.length < 7) {
				throw new ValidationError('password must be at least 7 characters.');
			}
			const fields = KeysController.#keyFields(req.body);
			if (fields.wrappedPrivateKey === undefined) {
				throw new ValidationError('Send the private key re-wrapped under the new password.');
			}
			if (fields.publicKey !== undefined && fields.publicKey !== user.publicKey) {
				throw new HttpError(409, 'The public key cannot change during recovery.', 'KeyChangeError');
			}
			delete fields.publicKey;
			// Consume the challenge atomically: a second request with the same
			// challenge finds it already cleared.
			const [count] = await User.update(
				{ ...fields, password, recoveryChallengeHash: null, recoveryChallengeExpiresAt: null },
				{
					where: { id: user.id, recoveryChallengeHash: user.recoveryChallengeHash },
					individualHooks: true
				}
			);
			if (count === 0) {
				throw new HttpError(
					401,
					'Recovery challenge is missing, wrong, or expired.',
					'RecoveryError'
				);
			}
			await User.revokeSessions(user.id);
			await audit(null, 'user.recover', 'user', user.id);
			this.#handleSuccess(res, { user: user.id, username: user.username });
		} catch (err) {
			this.#fail(res, next, err);
		}
	}

	/** May this caller manage the group's keys: an admin, or a member holding a wrapped group key. */
	async #keyHolder(req, chapterId) {
		if (AuthzService.isAdmin(req)) {
			return true;
		}
		if (String(AuthzService.chapterOf(req)) !== String(chapterId)) {
			return false;
		}
		return Boolean(await OrgMemberKey.forMember(chapterId, req.user.id));
	}

	/**
	 * PUT /auth/chapter-keys { chapter, publicKey, wrappedOrgPrivateKey, user? }:
	 * give a group its keypair. The first member (or an admin, naming the
	 * member) wraps the new group private key to that member.
	 */
	async chapterKeys(req, res, next) {
		const { chapter: chapterId, publicKey, wrappedOrgPrivateKey } = req.body;
		try {
			const chapter = this.requireFound(await Chapter.findByPk(chapterId), 'Chapter ' + chapterId);
			const memberId = AuthzService.isAdmin(req) ? (req.body.user ?? req.user.id) : req.user.id;
			if (
				!AuthzService.isAdmin(req) &&
				String(AuthzService.chapterOf(req)) !== String(chapter.id)
			) {
				throw AuthzService.forbidden('Only a member of the group or an admin can set its keys.');
			}
			if (chapter.publicKey) {
				throw new HttpError(
					409,
					'This group already has a public key; add members with /auth/member-key.',
					'KeyChangeError'
				);
			}
			if (!crypto.isPublicKey(publicKey)) {
				throw new ValidationError('publicKey must be a base64 X25519 public key (32 bytes).');
			}
			if (typeof wrappedOrgPrivateKey !== 'string' || wrappedOrgPrivateKey === '') {
				throw new ValidationError('wrappedOrgPrivateKey is required.');
			}
			const member = this.requireFound(await User.findByPk(memberId), 'User ' + memberId);
			if (String(member.chapterId) !== String(chapter.id)) {
				throw new ValidationError(
					'User ' + memberId + ' is not a member of chapter ' + chapter.id + '.'
				);
			}
			if (!member.publicKey) {
				throw new HttpError(
					409,
					'User ' +
						memberId +
						' has no public key yet; the first holder needs one to open the group key.',
					'KeyChangeError'
				);
			}
			// Bootstrap once: the write succeeds only while the key is still unset.
			const [count] = await Chapter.update(
				{ publicKey },
				{ where: { id: chapter.id, publicKey: null } }
			);
			if (count === 0) {
				throw new HttpError(
					409,
					'This group already has a public key; add members with /auth/member-key.',
					'KeyChangeError'
				);
			}
			await OrgMemberKey.put({
				chapterId: chapter.id,
				userId: member.id,
				wrappedOrgPrivateKey,
				addedBy: req.user.id
			});
			await audit(req, 'chapter.keys', 'chapter', chapter.id, { firstMember: member.id });
			this.#handleSuccess(res, { chapter: chapter.id, publicKey, member: member.id });
		} catch (err) {
			this.#fail(res, next, err);
		}
	}

	/**
	 * PUT /auth/member-key { chapter, user, wrappedOrgPrivateKey }: an
	 * existing key holder (or an admin) hands the group key to a member.
	 */
	async putMemberKey(req, res, next) {
		const { chapter: chapterId, user: userId, wrappedOrgPrivateKey } = req.body;
		try {
			const chapter = this.requireFound(await Chapter.findByPk(chapterId), 'Chapter ' + chapterId);
			if (!(await this.#keyHolder(req, chapter.id))) {
				throw AuthzService.forbidden(
					'Only a member holding the group key, or an admin, can add members.'
				);
			}
			if (!chapter.publicKey) {
				throw new HttpError(
					409,
					'Set the group keys first with /auth/chapter-keys.',
					'KeyChangeError'
				);
			}
			if (typeof wrappedOrgPrivateKey !== 'string' || wrappedOrgPrivateKey === '') {
				throw new ValidationError('wrappedOrgPrivateKey is required.');
			}
			const member = this.requireFound(await User.findByPk(userId), 'User ' + userId);
			if (String(member.chapterId) !== String(chapter.id)) {
				throw new ValidationError(
					'User ' + userId + ' is not a member of chapter ' + chapter.id + '.'
				);
			}
			if (!member.publicKey) {
				throw new HttpError(409, 'User ' + userId + ' has no public key yet.', 'KeyChangeError');
			}
			await OrgMemberKey.put({
				chapterId: chapter.id,
				userId: member.id,
				wrappedOrgPrivateKey,
				addedBy: req.user.id
			});
			await audit(req, 'chapter.member-key', 'chapter', chapter.id, { member: member.id });
			this.#handleSuccess(res, { chapter: chapter.id, member: member.id });
		} catch (err) {
			this.#fail(res, next, err);
		}
	}

	/**
	 * DELETE /auth/member-key { chapter, user } (remove): stop handing the group
	 * key to this member. It does not revoke a key the member already opened;
	 * that needs group key rotation, which is not built yet.
	 */
	async remove(req, res, next) {
		const { chapter: chapterId, user: userId } = req.body;
		try {
			if (!(await this.#keyHolder(req, chapterId))) {
				throw AuthzService.forbidden(
					'Only a member holding the group key, or an admin, can remove members.'
				);
			}
			const holders = await OrgMemberKey.count({ where: { chapterId } });
			const target = await OrgMemberKey.forMember(chapterId, userId);
			if (target && holders <= 1) {
				throw new HttpError(
					409,
					'This is the last holder of the group key; removing it would lock the group out (key rotation is not available yet).',
					'KeyChangeError'
				);
			}
			const removed = await OrgMemberKey.remove(chapterId, userId);
			await audit(req, 'chapter.member-key.remove', 'chapter', chapterId, { member: userId });
			this.#handleSuccess(res, this.requireAffected(removed, 'Member key for user ' + userId));
		} catch (err) {
			this.#fail(res, next, err);
		}
	}

	/** GET /auth/member-keys?chapter= (getMany): which members hold the group key. */
	async getMany(req, res, next) {
		const { chapter: chapterId } = req.query;
		try {
			const chapter = this.requireFound(await Chapter.findByPk(chapterId), 'Chapter ' + chapterId);
			if (
				!AuthzService.isAdmin(req) &&
				String(AuthzService.chapterOf(req)) !== String(chapter.id)
			) {
				throw AuthzService.forbidden();
			}
			const members = await User.findAll({
				where: { chapterId: chapter.id, role: 'chapter' },
				attributes: ['id', 'username', 'name', 'publicKey'],
				order: [['id', 'ASC']]
			});
			const keys = await OrgMemberKey.findAll({ where: { chapterId: chapter.id } });
			const holders = new Set(keys.map((k) => k.userId));
			this.#handleSuccess(res, {
				chapter: chapter.id,
				publicKey: chapter.publicKey,
				members: members.map((m) => ({
					id: m.id,
					username: m.username,
					name: m.name,
					publicKey: m.publicKey,
					holdsGroupKey: holders.has(m.id)
				}))
			});
		} catch (err) {
			this.#fail(res, next, err);
		}
	}
}

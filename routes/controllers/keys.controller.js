import RouteController from '#rtControllers/route.controller.js';
import AuthzService from '#rtServices/authz.services.js';
import User, { KEY_INPUT } from '#models/user.model.js';
import Chapter from '#models/chapter.model.js';
import OrgMemberKey from '#models/org-member-key.model.js';
import LetterKey from '#models/letter-key.model.js';
import { Op } from 'sequelize';
import ValidationError from '#services/ValidationError.js';
import { HttpError } from '#services/HttpError.js';
import * as crypto from '#services/crypto.js';
import { audit } from '#rtServices/audit.services.js';
import { withGroupKeyLock } from '#rtServices/groupkey.services.js';
import { inTransaction } from '#services/serial.js';
import { catchUpReader } from '#db/rewrap-e2e.js';

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
		this.rotationMaterial = this.rotationMaterial.bind(this);
		this.rotate = this.rotate.bind(this);
		this.readiness = this.readiness.bind(this);

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
			if (out[field] !== undefined && !crypto.isKdfParams(out[field])) {
				throw new ValidationError(field + ' ' + crypto.KDF_PARAMS_HINT);
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
				Chapter.findByPk(user.chapterId, {
					attributes: ['id', 'name', 'publicKey', 'keyVersion']
				}),
				OrgMemberKey.forMember(user.chapterId, user.id)
			]);
			if (chapter) {
				bundle.orgKey = {
					chapterId: chapter.id,
					chapterName: chapter.name,
					chapterPublicKey: chapter.publicKey,
					keyVersion: chapter.keyVersion,
					wrappedOrgPrivateKey: memberKey ? memberKey.wrappedOrgPrivateKey : null
				};
			}
		}
		return bundle;
	}

	/**
	 * A reader has just got a public key: seal their server-held letters to
	 * them. The keys are saved already, so a failure here is logged, not
	 * returned; `npm run encryption:rewrap` does the same work later.
	 * @returns {Promise<{letters: number, sealed: number, dropped: number}|null>}
	 */
	static async catchUp(readerType, readerId) {
		try {
			// In the rotation queue: a group key read here cannot be rotated away before
			// the envelope sealed to it is stored and the server's copy dropped.
			return await withGroupKeyLock(() => catchUpReader({ readerType, readerId }));
		} catch (err) {
			console.error('[keys] catch-up failed for ' + readerType + ' ' + readerId, err);
			return null;
		}
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
			if (
				fields.publicKey !== undefined &&
				!user.publicKey &&
				fields.wrappedPrivateKey === undefined
			) {
				// A public key nobody could ever use the private half of: letters sealed to
				// it (old ones, at once, by the catch-up below) would be lost to everyone.
				throw new ValidationError(
					'Send wrappedPrivateKey, kdfSalt, and kdfParams together with the first publicKey.'
				);
			}
			const where = { id: req.user.id };
			if (fields.publicKey !== undefined && !user.publicKey) {
				// First set: only if nobody set it in the meantime.
				where.publicKey = null;
			}
			// The moment the account can first open what is sealed to it: a first key, or
			// the wrapped private key arriving for a public key stored without one.
			const becameUsable = !user.wrappedPrivateKey && fields.wrappedPrivateKey !== undefined;
			const [count] = await User.update(fields, { where });
			if (count === 0) {
				throw new HttpError(
					409,
					'The public key was set by another request; reload your keys.',
					'KeyChangeError'
				);
			}
			await audit(req, 'user.keys', 'user', req.user.id, { fields: Object.keys(fields) });
			const bundle = await KeysController.keyBundle(req.user.id);
			if (becameUsable) {
				// Letters the server still holds a key for become theirs now.
				bundle.caughtUp = await KeysController.catchUp('user', req.user.id);
			}
			this.#handleSuccess(res, bundle);
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
					await Chapter.findByPk(chapter, { attributes: ['id', 'publicKey', 'keyVersion'] }),
					'Chapter ' + chapter
				);
				return this.#handleSuccess(res, {
					chapter: target.id,
					publicKey: target.publicKey,
					keyVersion: target.keyVersion
				});
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
				{ publicKey, keyVersion: 1 },
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
			this.#handleSuccess(res, {
				chapter: chapter.id,
				publicKey,
				keyVersion: 1,
				member: member.id,
				// Letters the server still holds a key for, and this group relays or manages.
				caughtUp: await KeysController.catchUp('chapter', chapter.id)
			});
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
	 * for that, rotate the group key (POST /auth/chapter-rotation) and leave
	 * the member out.
	 */
	async remove(req, res, next) {
		const { chapter: chapterId, user: userId } = req.body;
		try {
			if (!(await this.#keyHolder(req, chapterId))) {
				throw AuthzService.forbidden(
					'Only a member holding the group key, or an admin, can remove members.'
				);
			}
			// Count and delete as one step: two removals at once must not both
			// find a holder to spare and leave the group with none.
			const removed = await withGroupKeyLock(async () => {
				const holders = await OrgMemberKey.count({ where: { chapterId } });
				const target = await OrgMemberKey.forMember(chapterId, userId);
				if (target && holders <= 1) {
					throw new HttpError(
						409,
						'This is the last holder of the group key; removing it would lock the group out. Rotate the key to another member instead (POST /auth/chapter-rotation).',
						'KeyChangeError'
					);
				}
				return await OrgMemberKey.remove(chapterId, userId);
			});
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
				keyVersion: chapter.keyVersion,
				keyRotatedAt: chapter.keyRotatedAt,
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

	/**
	 * Anything sealed to a group's public key names the key version it was
	 * sealed to, because the server cannot look inside a sealed box.
	 * @throws {ValidationError} no version, or a group without keys; {HttpError} 409 for a rotated-away key
	 */
	static requireCurrentGroupKey(chapter, version, field = 'orgKeyVersion') {
		if (!chapter.publicKey) {
			throw new HttpError(
				409,
				'Set the group keys first with /auth/chapter-keys.',
				'KeyChangeError'
			);
		}
		if (!Number.isInteger(version)) {
			throw new ValidationError(
				field + ' is required: the keyVersion of the group key this was sealed to.'
			);
		}
		if (version !== chapter.keyVersion) {
			throw new HttpError(
				409,
				'The group rotated its key (now version ' +
					chapter.keyVersion +
					'); fetch it again and re-seal.',
				'KeyVersionError'
			);
		}
	}

	/** Everything sealed to the group's current public key. */
	static async #sealedToGroup(chapterId, options = {}) {
		const [envelopes, writers] = await Promise.all([
			LetterKey.findAll({
				where: { readerType: 'chapter', readerId: chapterId },
				attributes: ['id', 'message', 'wrappedKey', 'keyVersion'],
				order: [['id', 'ASC']],
				...options
			}),
			User.scope('withKeys').findAll({
				where: {
					[Op.or]: [{ managedBy: chapterId }, { anonymousForChapter: chapterId }],
					orgWrappedPrivateKey: { [Op.ne]: null }
				},
				attributes: ['id', 'name', 'publicKey', 'orgWrappedPrivateKey'],
				order: [['id', 'ASC']],
				...options
			})
		]);
		return { envelopes, writers };
	}

	/** Only a member who holds the group key can rotate it: an admin cannot open what must be re-sealed. */
	async #requireRotator(req, chapter) {
		const holder =
			String(AuthzService.chapterOf(req)) === String(chapter.id) &&
			(await OrgMemberKey.forMember(chapter.id, req.user.id));
		if (!holder) {
			throw AuthzService.forbidden(
				'Only a member holding the group key can rotate it; nobody else can open what has to be re-sealed.'
			);
		}
		if (!chapter.publicKey) {
			throw new HttpError(
				409,
				'Set the group keys first with /auth/chapter-keys.',
				'KeyChangeError'
			);
		}
	}

	/**
	 * GET /auth/chapter-rotation?chapter=: what a rotation must re-seal. The
	 * caller's client opens each item with the old group key, seals it to
	 * the new one, and posts the lot back.
	 */
	async rotationMaterial(req, res, next) {
		const { chapter: chapterId } = req.query;
		try {
			const chapter = this.requireFound(await Chapter.findByPk(chapterId), 'Chapter ' + chapterId);
			await this.#requireRotator(req, chapter);
			const { envelopes, writers } = await KeysController.#sealedToGroup(chapter.id);
			const members = await User.findAll({
				where: { chapterId: chapter.id, role: 'chapter' },
				attributes: ['id', 'username', 'name', 'publicKey'],
				order: [['id', 'ASC']]
			});
			const holders = new Set(
				(await OrgMemberKey.findAll({ where: { chapterId: chapter.id } })).map((k) => k.userId)
			);
			this.#handleSuccess(res, {
				chapter: chapter.id,
				publicKey: chapter.publicKey,
				keyVersion: chapter.keyVersion,
				envelopes: envelopes.map((e) => ({
					id: e.id,
					message: e.message,
					wrappedKey: e.wrappedKey
				})),
				writers: writers.map((w) => ({
					id: w.id,
					name: w.name,
					publicKey: w.publicKey,
					orgWrappedPrivateKey: w.orgWrappedPrivateKey
				})),
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

	/** A list of { id|user, <field> } pairs from a rotation body, as a Map keyed by number. */
	static #sealedList(list, idField, valueField, label, { allowEmpty = true } = {}) {
		if (!Array.isArray(list) || (!allowEmpty && list.length === 0)) {
			throw new ValidationError(
				label + ' must be an array of { ' + idField + ', ' + valueField + ' }.'
			);
		}
		const map = new Map();
		for (const item of list) {
			const id = Number(item && item[idField]);
			const value = item && item[valueField];
			if (!Number.isInteger(id) || id <= 0 || typeof value !== 'string' || value === '') {
				throw new ValidationError(
					'Each of ' + label + ' needs a numeric ' + idField + ' and a ' + valueField + '.'
				);
			}
			if (map.has(id)) {
				throw new ValidationError('Duplicate ' + idField + ' ' + id + ' in ' + label + '.');
			}
			map.set(id, value);
		}
		return map;
	}

	/** Ids on one side only, for the "fetch again" refusal. */
	static #difference(sent, stored) {
		return {
			missing: stored.filter((id) => !sent.has(id)),
			unknown: [...sent.keys()].filter((id) => !stored.includes(id))
		};
	}

	/**
	 * POST /auth/chapter-rotation { chapter, keyVersion, publicKey, envelopes,
	 * writers, members }: replace the group's keypair. The body must re-seal
	 * every envelope and every managed writer's key the group holds, and name
	 * the members who get the new group key; a holder left out loses access,
	 * which is what revokes them. All of it lands in one transaction or none.
	 */
	async rotate(req, res, next) {
		const { chapter: chapterId, keyVersion, publicKey } = req.body;
		try {
			const chapter = this.requireFound(await Chapter.findByPk(chapterId), 'Chapter ' + chapterId);
			await this.#requireRotator(req, chapter);
			if (!crypto.isPublicKey(publicKey)) {
				throw new ValidationError('publicKey must be a base64 X25519 public key (32 bytes).');
			}
			if (publicKey === chapter.publicKey) {
				throw new ValidationError('publicKey is the current key; a rotation needs a new keypair.');
			}
			KeysController.requireCurrentGroupKey(chapter, keyVersion, 'keyVersion');
			const envelopes = KeysController.#sealedList(
				req.body.envelopes,
				'id',
				'wrappedKey',
				'envelopes'
			);
			const writers = KeysController.#sealedList(
				req.body.writers,
				'id',
				'orgWrappedPrivateKey',
				'writers'
			);
			const members = KeysController.#sealedList(
				req.body.members,
				'user',
				'wrappedOrgPrivateKey',
				'members',
				{ allowEmpty: false }
			);
			const eligible = await User.findAll({
				where: { id: [...members.keys()], chapterId: chapter.id, role: 'chapter' },
				attributes: ['id', 'publicKey']
			});
			for (const id of members.keys()) {
				const member = eligible.find((m) => m.id === id);
				if (!member) {
					throw new ValidationError(
						'User ' + id + ' is not a member of chapter ' + chapter.id + '.'
					);
				}
				if (!member.publicKey) {
					throw new HttpError(409, 'User ' + id + ' has no public key yet.', 'KeyChangeError');
				}
			}

			const nextVersion = chapter.keyVersion + 1;
			// One at a time, so the loser of a race fails its version check rather than a BEGIN.
			const result = await withGroupKeyLock(() =>
				inTransaction(Chapter.sequelize, async (transaction) => {
					// Claim the rotation first: only one request can move this version on.
					const [claimed] = await Chapter.update(
						{ publicKey, keyVersion: nextVersion, keyRotatedAt: new Date() },
						{
							where: {
								id: chapter.id,
								keyVersion: chapter.keyVersion,
								publicKey: chapter.publicKey
							},
							transaction
						}
					);
					if (claimed === 0) {
						throw new HttpError(
							409,
							'The group key changed while you were rotating; fetch the rotation material again.',
							'KeyVersionError'
						);
					}
					// Completeness is judged inside the transaction, against what is stored now.
					const stored = await KeysController.#sealedToGroup(chapter.id, { transaction });
					const envelopeGap = KeysController.#difference(
						envelopes,
						stored.envelopes.map((e) => e.id)
					);
					const writerGap = KeysController.#difference(
						writers,
						stored.writers.map((w) => w.id)
					);
					const gaps =
						envelopeGap.missing.length +
						envelopeGap.unknown.length +
						writerGap.missing.length +
						writerGap.unknown.length;
					if (gaps > 0) {
						throw new HttpError(
							409,
							'The rotation does not match what the group holds (envelopes missing: ' +
								envelopeGap.missing.length +
								", not the group's: " +
								envelopeGap.unknown.length +
								'; writers missing: ' +
								writerGap.missing.length +
								", not the group's: " +
								writerGap.unknown.length +
								'). Letters or writers changed since you fetched; fetch the rotation material again.',
							'RotationIncompleteError'
						);
					}
					for (const [id, wrappedKey] of envelopes) {
						await LetterKey.update(
							{ wrappedKey, keyVersion: nextVersion },
							{ where: { id, readerType: 'chapter', readerId: chapter.id }, transaction }
						);
					}
					for (const [id, orgWrappedPrivateKey] of writers) {
						// Only while still unclaimed: a claim in the meantime cleared the group's copy.
						const [count] = await User.update(
							{ orgWrappedPrivateKey },
							{ where: { id, orgWrappedPrivateKey: { [Op.ne]: null } }, transaction }
						);
						if (count === 0) {
							throw new HttpError(
								409,
								'Writer ' +
									id +
									' was claimed during the rotation; fetch the rotation material again.',
								'RotationIncompleteError'
							);
						}
					}
					const before = await OrgMemberKey.findAll({
						where: { chapterId: chapter.id },
						attributes: ['userId'],
						transaction
					});
					await OrgMemberKey.destroy({ where: { chapterId: chapter.id }, transaction });
					await OrgMemberKey.bulkCreate(
						[...members].map(([userId, wrappedOrgPrivateKey]) => ({
							chapterId: chapter.id,
							userId,
							wrappedOrgPrivateKey,
							addedBy: req.user.id
						})),
						{ transaction }
					);
					return {
						removed: before.map((k) => k.userId).filter((id) => !members.has(id))
					};
				})
			);

			await audit(req, 'chapter.keys.rotate', 'chapter', chapter.id, {
				keyVersion: nextVersion,
				envelopes: envelopes.size,
				writers: writers.size,
				members: [...members.keys()],
				removed: result.removed
			});
			this.#handleSuccess(res, {
				chapter: chapter.id,
				publicKey,
				keyVersion: nextVersion,
				envelopes: envelopes.size,
				writers: writers.size,
				members: [...members.keys()],
				removed: result.removed
			});
		} catch (err) {
			this.#fail(res, next, err);
		}
	}

	/**
	 * GET /auth/encryption-readiness (admin): who still has to set up keys.
	 * The switch to e2e needs every active group that relays mail to have a
	 * key, because nothing can be sealed to a group without one; everybody
	 * else can catch up afterwards, at their next sign-in.
	 */
	async readiness(req, res, next) {
		try {
			const { sequelize } = Chapter;
			const one = async (sql) => {
				const [[row]] = await sequelize.query(sql);
				return row;
			};
			const [groups] = await sequelize.query(
				`SELECT c.id, c.name, c.networkRole, c.publicKey IS NOT NULL AS hasKey,
					(SELECT COUNT(*) FROM PrisonRelay r WHERE r.chapter = c.id) AS relayFacilities,
					(SELECT COUNT(*) FROM User u WHERE u.chapterId = c.id AND u.role = 'chapter') AS members,
					(SELECT COUNT(*) FROM User u WHERE u.chapterId = c.id AND u.role = 'chapter' AND u.publicKey IS NOT NULL) AS membersWithKeys,
					(SELECT COUNT(*) FROM OrgMemberKeys k WHERE k.chapterId = c.id) AS holders,
					(SELECT COUNT(*) FROM User w WHERE w.managedBy = c.id AND w.anonymousForChapter IS NULL AND w.publicKey IS NULL) AS unclaimedWritersWithoutKeys
				FROM Chapters c WHERE c.accountStatus = 'active' ORDER BY c.id`
			);
			const relays = (g) => g.networkRole !== 'collecting' || g.relayFacilities > 0;
			const brief = (g) => ({
				id: g.id,
				name: g.name,
				networkRole: g.networkRole,
				relayFacilities: g.relayFacilities,
				members: g.members,
				membersWithKeys: g.membersWithKeys
			});
			const withoutKey = groups.filter((g) => !g.hasKey);
			const blocking = withoutKey.filter(relays);
			const users = await one(
				`SELECT COUNT(*) AS total,
					SUM(publicKey IS NOT NULL) AS withKeys,
					SUM(publicKey IS NULL AND EXISTS (SELECT 1 FROM Messages m WHERE m.user = User.id)) AS withoutKeysWithLetters
				FROM User WHERE role = 'user' AND managedBy IS NULL AND anonymousForChapter IS NULL`
			);
			const letters = await one(
				`SELECT COUNT(*) AS serverHeld,
					COUNT(DISTINCT CASE WHEN u.publicKey IS NULL AND u.anonymousForChapter IS NULL THEN u.id END) AS writersWaited,
					COUNT(DISTINCT CASE WHEN c.id IS NOT NULL AND c.publicKey IS NULL THEN c.id END) AS groupsWaited
				FROM LetterKeys k
				JOIN Messages m ON m.id = k.message
				LEFT JOIN User u ON u.id = m.user
				LEFT JOIN Chapters c ON c.id = m.relayChapter
				WHERE k.readerType = 'server'`
			);
			let serverKeyConfigured = true;
			try {
				crypto.masterKey();
			} catch {
				serverKeyConfigured = false;
			}
			const blockers = blocking.map(
				(g) =>
					'Group ' +
					g.id +
					' (' +
					g.name +
					') relays mail and has no group key: after the switch nobody could send through it.'
			);
			this.#handleSuccess(res, {
				mode: crypto.isE2E() ? 'e2e' : 'server',
				// Without it the server cannot seal old letters to readers who turn up late.
				serverKeyConfigured,
				ready: blockers.length === 0,
				blockers,
				groups: {
					active: groups.length,
					withKey: groups.length - withoutKey.length,
					withoutKey: withoutKey.map((g) => ({ ...brief(g), blocksTheSwitch: relays(g) })),
					// Members who have their own keys and are still waiting for a holder to hand them the group's.
					membersWaitingForGroupKey: groups
						.filter((g) => g.hasKey && g.membersWithKeys > g.holders)
						.map((g) => ({ ...brief(g), holders: g.holders })),
					unclaimedWritersWithoutKeys: groups
						.filter((g) => g.unclaimedWritersWithoutKeys > 0)
						.map((g) => ({ id: g.id, name: g.name, writers: g.unclaimedWritersWithoutKeys }))
				},
				writers: {
					total: Number(users.total),
					withKeys: Number(users.withKeys || 0),
					withoutKeys: Number(users.total) - Number(users.withKeys || 0),
					// The ones with something at stake; the rest lose nothing by turning up late.
					withoutKeysWithLetters: Number(users.withoutKeysWithLetters || 0)
				},
				letters: {
					serverHeld: Number(letters.serverHeld),
					waitingForWriters: Number(letters.writersWaited),
					waitingForGroups: Number(letters.groupsWaited)
				}
			});
		} catch (err) {
			this.#fail(res, next, err);
		}
	}
}

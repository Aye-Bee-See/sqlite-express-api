import { Op } from 'sequelize';
import { sequelize } from './connection.js';
import * as Models from '#models/all.model.js';
import { inTransaction } from '#services/serial.js';
import { HttpError } from '#services/HttpError.js';

/**
 * Delete an account and everything the person wrote or received through it.
 *
 * Somebody who asks to be gone is gone: every letter of theirs whatever its
 * status (queued, printed, mailed), every reply recorded for them, the
 * attachments and their files, the envelopes, the status history, and the
 * threads. Devices, notifications, claim tokens, idempotency keys, and the
 * group key handed to them go with the row (ON DELETE CASCADE); what they did
 * as staff stays, without their name on it (SET NULL): audit entries,
 * proposals, invitations, status changes on other people's letters.
 *
 * One transaction: a failure leaves the account exactly as it was. Files are
 * removed after the commit, as everywhere else.
 */

/** Rows read per step, so an account with years of letters does not become one huge IN list. */
const BATCH = 500;

/** The conditions an AccountDeleteError carries, for clients that word their own sentences. */
export const DELETE_REFUSALS = ['anonymous', 'only_admin', 'group_owner', 'last_key_holder'];

function refusal(condition, message) {
	const err = new HttpError(409, message, 'AccountDeleteError');
	err.condition = condition;
	return err;
}

/**
 * Why this account cannot be deleted right now, or null.
 * @param {import('sequelize').Model} user
 * @returns {Promise<HttpError|null>}
 */
export async function eraseRefusal(user) {
	const { User } = Models;
	if (user.anonymousForChapter) {
		return refusal(
			'anonymous',
			"This is a group's shared anonymous account: it holds the anonymous letters of everyone the group wrote for, and goes when the group does."
		);
	}
	if (user.role === 'admin' && (await User.count({ where: { role: 'admin' } })) <= 1) {
		return refusal(
			'only_admin',
			'This is the only admin account. Make another admin first, or nobody could run the site.'
		);
	}
	return await staffRefusal(user, null, refusal);
}

/**
 * What stands in the way of this account no longer being a group admin of the
 * given chapters (all of them when `chapterIds` is null), or null: it owns one
 * that has other group admins, it is the last of a chapter's group admins to
 * hold the chapter's key, or (no longer a group admin there) it holds the only
 * copy of that key left anywhere. Shared by deleting an account and by changing its
 * role or chapter, so neither can leave a group with nobody to hand the key on.
 *
 * @param {import('sequelize').Model} user
 * @param {number[]|null} chapterIds
 * @param {(condition: string, message: string) => Error} refuse makes the error
 * @returns {Promise<Error|null>}
 */
export async function staffRefusal(user, chapterIds, refuse) {
	const { User, OrgMemberKey, Chapter } = Models;
	const scope = chapterIds === null ? {} : { chapterId: chapterIds };
	const owned = await Chapter.findAll({
		where: { ownerId: user.id, ...(chapterIds === null ? {} : { id: chapterIds }) },
		attributes: ['id', 'name']
	});
	for (const group of owned) {
		const others = await User.count({
			where: { chapterId: group.id, role: 'chapter', id: { [Op.ne]: user.id } }
		});
		if (others > 0) {
			return refuse(
				'group_owner',
				'This account is the group-owner admin of ' +
					group.name +
					'. Hand ownership to another group admin first (PUT /auth/chapter-owner).'
			);
		}
	}
	const held = await OrgMemberKey.findAll({ where: { userId: user.id, ...scope } });
	for (const row of held) {
		const others = await OrgMemberKey.findAll({
			where: { chapterId: row.chapterId, userId: { [Op.ne]: user.id } },
			attributes: ['userId']
		});
		// A copy is usable only by one of the chapter's group admins: anyone else
		// cannot open the chapter's letters with it or hand it on.
		const usable =
			others.length === 0
				? 0
				: await User.count({
						where: {
							id: others.map((h) => h.userId),
							chapterId: row.chapterId,
							role: 'chapter'
						}
					});
		const group = async () =>
			(await Chapter.findByPk(row.chapterId, { attributes: ['name'] }))?.name ?? 'its group';
		if (user.role === 'chapter' && String(user.chapterId) === String(row.chapterId)) {
			if (usable === 0) {
				return refuse(
					'last_key_holder',
					'This account is the last holder of the key of ' +
						(await group()) +
						'. Hand the key to another member first (PUT /auth/member-key), or the group could never read its letters again.'
				);
			}
		} else if (others.length === 0) {
			// Not one of the chapter's group admins any more, so this copy is not in use,
			// but it is the only one left anywhere: making the account a group admin of
			// the chapter again is the only way the chapter gets its key back.
			return refuse(
				'last_key_holder',
				'This account holds the only remaining copy of the key of ' +
					(await group()) +
					'. Make it a group admin of that group again and hand the key on first, or the group could never read its letters again.'
			);
		}
	}
	return null;
}

/**
 * @param {number} userId
 * @returns {Promise<null | {deleted: 1, letters: number, replies: number, attachments: number, threads: number}>}
 *   null when there is no such account
 */
export async function eraseAccount(userId) {
	const { User, Message, Chat, Attachment, LetterKey } = Models;
	let files = [];
	const report = await inTransaction(sequelize, async (transaction) => {
		const user = await User.findByPk(userId, { attributes: ['id'], transaction });
		if (!user) {
			return null;
		}
		const counts = { deleted: 1, letters: 0, replies: 0, attachments: 0, threads: 0 };
		for (;;) {
			const rows = await Message.findAll({
				where: { user: user.id },
				attributes: ['id', 'sender'],
				limit: BATCH,
				hooks: false,
				transaction
			});
			if (rows.length === 0) {
				break;
			}
			const ids = rows.map((row) => row.id);
			const names = await Attachment.storedNamesFor(ids, { transaction });
			files = files.concat(names);
			counts.attachments += names.length;
			counts.replies += rows.filter((row) => row.sender === 'prisoner').length;
			counts.letters += rows.filter((row) => row.sender !== 'prisoner').length;
			// Envelopes, history, attachment rows, and notifications about these letters cascade.
			await Message.destroy({ where: { id: ids }, force: true, transaction });
		}
		counts.threads = await Chat.destroy({ where: { user: user.id }, transaction });
		// Envelopes sealed to this person on anything else (none today; no key of theirs stays).
		await LetterKey.destroy({ where: { readerType: 'user', readerId: user.id }, transaction });
		await User.destroy({ where: { id: user.id }, transaction });
		return counts;
	});
	if (report) {
		await Attachment.removeFiles(files);
	}
	return report;
}

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

/**
 * Why this account cannot be deleted right now, or null.
 * @param {import('sequelize').Model} user
 * @returns {Promise<HttpError|null>}
 */
export async function eraseRefusal(user) {
	const { User, OrgMemberKey, Chapter } = Models;
	if (user.anonymousForChapter) {
		return new HttpError(
			409,
			"This is a group's shared anonymous account: it holds the anonymous letters of everyone the group wrote for, and goes when the group does.",
			'AccountDeleteError'
		);
	}
	if (user.role === 'admin' && (await User.count({ where: { role: 'admin' } })) <= 1) {
		return new HttpError(
			409,
			'This is the only admin account. Make another admin first, or nobody could run the site.',
			'AccountDeleteError'
		);
	}
	const owned = await Chapter.findAll({ where: { ownerId: user.id }, attributes: ['id', 'name'] });
	for (const group of owned) {
		const others = await User.count({
			where: { chapterId: group.id, role: 'chapter', id: { [Op.ne]: user.id } }
		});
		if (others > 0) {
			return new HttpError(
				409,
				'This account is the group-owner admin of ' +
					group.name +
					'. Hand ownership to another group admin first (PUT /auth/chapter-owner).',
				'AccountDeleteError'
			);
		}
	}
	const held = await OrgMemberKey.findAll({ where: { userId: user.id } });
	for (const row of held) {
		const others = await OrgMemberKey.count({
			where: { chapterId: row.chapterId, userId: { [Op.ne]: user.id } }
		});
		if (others === 0) {
			const group = await Chapter.findByPk(row.chapterId, { attributes: ['id', 'name'] });
			return new HttpError(
				409,
				'This account is the last holder of the key of ' +
					(group ? group.name : 'its group') +
					'. Hand the key to another member first (PUT /auth/member-key), or the group could never read its letters again.',
				'AccountDeleteError'
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

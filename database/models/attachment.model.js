import { Model } from 'sequelize';
import Schemas from '#schemas/all.schema.js';
import { removeFile, storeFile } from '#services/files.js';

/**
 * A file attached to a message. Rows hide `storedName` by default; use the
 * `withStoredName` scope (or Attachment.withFile) when serving the bytes.
 */
export default class Attachment extends Model {
	static init(sequelize) {
		return super.init(Schemas.attachment, {
			sequelize,
			modelName: 'Attachment',
			tableName: 'Attachments',
			defaultScope: { attributes: { exclude: ['storedName'] } },
			scopes: { withStoredName: {} }
		});
	}

	static associate(models) {
		this.belongsTo(models.Message, {
			as: 'message_details',
			foreignKey: 'message',
			onDelete: 'CASCADE',
			onUpdate: 'CASCADE'
		});
		this.belongsTo(models.User, {
			as: 'uploaded_by',
			foreignKey: 'uploadedBy',
			onDelete: 'SET NULL',
			onUpdate: 'CASCADE'
		});
	}

	/**
	 * Store the bytes and create the row.
	 * @param {{message: number, buffer: Buffer, mimeType: string, originalName?: string, uploadedBy?: number|null}} file
	 * @returns {Promise<Attachment>} the row without storedName
	 */
	static async attach({ message, buffer, mimeType, originalName, uploadedBy = null }) {
		const storedName = await storeFile(buffer, mimeType);
		try {
			const row = await this.create({
				message,
				storedName,
				originalName: originalName || null,
				mimeType,
				size: buffer.length,
				uploadedBy
			});
			return await this.findByPk(row.id);
		} catch (err) {
			await removeFile(storedName);
			throw err;
		}
	}

	/** One attachment including its stored file name, or null. */
	static async withFile(id) {
		return await this.scope('withStoredName').findByPk(id);
	}

	/** Attachments of one message, oldest first. */
	static async listForMessage(messageId) {
		return await this.findAll({ where: { message: messageId }, order: [['id', 'ASC']] });
	}

	/** Delete one attachment and its file. */
	static async remove(id) {
		const row = await this.withFile(id);
		if (!row) {
			return 0;
		}
		await row.destroy();
		await removeFile(row.storedName);
		return 1;
	}

	/**
	 * Delete every attachment of the given messages, files included. Called
	 * before the messages themselves go, since the database cascade cannot
	 * unlink files.
	 * @param {number[]} messageIds
	 * @returns {Promise<number>} rows removed
	 */
	static async purgeForMessages(messageIds) {
		if (messageIds.length === 0) {
			return 0;
		}
		const rows = await this.scope('withStoredName').findAll({ where: { message: messageIds } });
		for (const row of rows) {
			await row.destroy();
			await removeFile(row.storedName);
		}
		return rows.length;
	}
}

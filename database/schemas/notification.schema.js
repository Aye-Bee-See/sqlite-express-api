import { DataTypes } from 'sequelize';

/**
 * What can be notified.
 * - letter.reply: a prisoner's reply was recorded on the writer's thread.
 * - letter.status: the writer's letter was printed or mailed.
 * - letter.queued: a letter arrived for a group to print (its members are told).
 * - submission.decided: a proposal the person made was approved or rejected.
 */
export const NOTIFICATION_EVENTS = [
	'letter.reply',
	'letter.status',
	'letter.queued',
	'submission.decided',
	// Somebody you write to was moved to another facility, or their status changed (freed).
	'prisoner.moved',
	'prisoner.status',
	// Group admins: the chapter key was set, handed to somebody, taken away, or
	// rotated (detail.action); the group-owner admin changed; a group admin has
	// keys and is waiting to be handed the chapter's.
	'group.key',
	'group.owner',
	'group.waiting'
];

/** One entry of an account's feed. Holds ids and states, never letter content. */
const notificationSchema = {
	userId: {
		type: DataTypes.INTEGER,
		allowNull: false
	},
	event: {
		type: DataTypes.STRING,
		allowNull: false,
		validate: {
			isIn: { args: [NOTIFICATION_EVENTS], msg: 'Unknown notification event.' }
		}
	},
	chat: {
		type: DataTypes.INTEGER
	},
	message: {
		type: DataTypes.INTEGER
	},
	submission: {
		type: DataTypes.INTEGER
	},
	/** Small, non-secret facts a client needs to word the notification, such as `{ "status": "mailed" }`. */
	detail: {
		type: DataTypes.JSON
	},
	readAt: {
		type: DataTypes.DATE
	}
};

export default notificationSchema;

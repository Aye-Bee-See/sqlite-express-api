import chatSchema from '#schemas/chat.schema.js';
import messageSchema from '#schemas/message.schema.js';
import prisonSchema from '#schemas/prison.schema.js';
import prisonerSchema from '#schemas/prisoner.schema.js';
import ruleSchema from '#schemas/rule.schema.js';
import userSchema from '#schemas/user.schema.js';
import chapterSchema from '#schemas/chapter.schema.js';
import prisonerSupportSchema from '#schemas/prisoner-support.schema.js';
import claimTokenSchema from '#schemas/claim-token.schema.js';
import messageStatusSchema from '#schemas/message-status.schema.js';
import attachmentSchema from '#schemas/attachment.schema.js';
import letterKeySchema from '#schemas/letter-key.schema.js';
import submissionSchema from '#schemas/submission.schema.js';
import auditLogSchema from '#schemas/audit-log.schema.js';

export default class Schemas {
	static chat = chatSchema;
	static message = messageSchema;
	static prison = prisonSchema;
	static prisoner = prisonerSchema;
	static rule = ruleSchema;
	static user = userSchema;
	static chapter = chapterSchema;
	static prisonerSupport = prisonerSupportSchema;
	static claimToken = claimTokenSchema;
	static messageStatus = messageStatusSchema;
	static attachment = attachmentSchema;
	static letterKey = letterKeySchema;
	static submission = submissionSchema;
	static auditLog = auditLogSchema;
}

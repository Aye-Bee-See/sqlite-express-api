import chatSchema from '#schemas/chat.schema.js';
import messageSchema from '#schemas/message.schema.js';
import prisonSchema from '#schemas/prison.schema.js';
import prisonerSchema from '#schemas/prisoner.schema.js';
import ruleSchema from '#schemas/rule.schema.js';
import userSchema from '#schemas/user.schema.js';
import chapterSchema from '#schemas/chapter.schema.js'

export default class Schemas {
    static chat = chatSchema;
    static message = messageSchema;
    static prison = prisonSchema;
    static prisoner = prisonerSchema;
    static rule = ruleSchema;
    static user = userSchema;
    static chapter = chapterSchema;
};



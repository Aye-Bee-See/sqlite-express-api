import {ChatSchema as chatSchema} from '#schemas/chat.schema.js';
import messageSchema from '#schemas/message.schema.cjs';
import prisonSchema from '#schemas/prison.schema.cjs';
import prisonerSchema from '#schemas/prisoner.schema.cjs';
import ruleSchema from '#schemas/rule.schema.cjs';
import userSchema from '#schemas/user.schema.cjs';

export default class Schemas {
    static chat = chatSchema;
    static message = messageSchema;
    static prison = prisonSchema;
    static prisoner = prisonerSchema;
    static rule = ruleSchema;
    static user = userSchema;
};



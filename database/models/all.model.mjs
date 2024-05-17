import chatSchema from './chat.model.js';
import messageSchema from './message.model.js';
import prisonSchema from './prison.model.js';
import prisonerSchema from './prisoner.model.js';
import ruleSchema from './rule.model.js';
import userSchema from '#database/models/user.model.js';

export default class Schemas {
    static chat = chatSchema;
    static message = messageSchema;
    static prison = prisonSchema;
    static prisoner = prisonerSchema;
    static rule = ruleSchema;
    static user = userSchema;
};



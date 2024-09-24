import userHooks from '#hooks/user.hooks.mjs';
import messageHooks from '#hooks/message.hooks.js';

export default class Hooks{
        static user=userHooks;
        static message=messageHooks;
}

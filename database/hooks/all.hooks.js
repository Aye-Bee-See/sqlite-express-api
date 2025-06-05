import userHooks from '#hooks/user.hooks.js';
import messageHooks from '#hooks/message.hooks.js';

export default class Hooks{
        static user=userHooks;
        static message=messageHooks;
}

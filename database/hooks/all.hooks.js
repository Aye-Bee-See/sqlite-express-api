import userHooks from '#hooks/user.hooks.js';
import messageHooks from '#hooks/message.hooks.js';
import chatHooks from '#hooks/chat.hooks.js';

export default class Hooks {
	static user = userHooks;
	static message = messageHooks;
	static chat = chatHooks;
}

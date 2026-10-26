import { bot } from '#lib';
import { Chatbot, clearChatbotMemory } from '#bot';
import { getChatbot, setChatbot } from '#sql';

const word = value => (value ? 'on' : 'off');
const asSwitch = value => (value === 'on' ? true : value === 'off' ? false : null);

const statusText = (settings, prefix) =>
	`*Chatbot*\n` +
	`Status: \`\`\`${word(settings.enabled)}\`\`\`\n` +
	`Groups (gc): \`\`\`${word(settings.gc)}\`\`\` _answers when someone mentions me or replies to my message_\n` +
	`Private chats (dm): \`\`\`${word(settings.dm)}\`\`\` _answers every message that is not a command_\n\n` +
	`_${prefix}chatbot on | off_\n` +
	`_${prefix}chatbot gc on | off_\n` +
	`_${prefix}chatbot dm on | off_`;

bot(
	{
		pattern: 'chatbot',
		public: false,
		desc: 'AI chatbot: chatbot on/off, chatbot gc on/off, chatbot dm on/off',
		type: 'ai'
	},
	async (message, match) => {
		const prefix = message.prefix;
		const [target, value] = (match || '').trim().toLowerCase().split(/\s+/);

		if (!target) return await message.send(statusText(await getChatbot(), prefix));

		if (target === 'on' || target === 'off') {
			const on = target === 'on';
			const before = await getChatbot();
			if (before.enabled === on) return await message.send(`_Chatbot is already ${target}._`);
			await setChatbot('enabled', on);
			if (!on) clearChatbotMemory();
			return await message.send(
				on
					? `_Chatbot is on._\n_Groups: ${word(before.gc)}, private chats: ${word(before.dm)}_`
					: '_Chatbot is off._'
			);
		}

		if (target === 'gc' || target === 'dm') {
			const on = asSwitch(value);
			if (on === null) return await message.send(`_Use ${prefix}chatbot ${target} on or ${prefix}chatbot ${target} off_`);
			const before = await getChatbot();
			const where = target === 'gc' ? 'groups' : 'private chats';
			if (before[target] === on) return await message.send(`_Chatbot is already ${word(on)} in ${where}._`);
			await setChatbot(target, on);
			return await message.send(
				`_Chatbot is ${word(on)} in ${where}._` +
					(before.enabled ? '' : `\n_The chatbot itself is still off, turn it on with ${prefix}chatbot on_`)
			);
		}

		return await message.send(statusText(await getChatbot(), prefix));
	}
);

// Every message that is not a command lands here, the handler decides whether the chatbot answers it.
bot(
	{
		on: 'text',
		dontAddCommandList: true
	},
	async message => {
		try {
			await Chatbot(message);
		} catch (err) {
			console.log('[chatbot]', err?.message || err);
		}
	}
);

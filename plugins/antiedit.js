import { bot } from '#lib';
import { getAntiEdit, setAntiEdit, initializeAntiEditSettings } from '#sql';
initializeAntiEditSettings();

const where = scope => (scope === 'gc' ? 'Group Chats' : 'Direct Messages');

bot(
	{
		pattern: 'antiedit',
		public: false,
		desc: 'Show the original and the new text when someone edits a message',
		type: 'user'
	},
	async (message, match) => {
		const command = (match || '').toLowerCase().replace(/\s+/g, ' ').trim();

		if (command === 'on' || command === 'set all') {
			await setAntiEdit('gc', true);
			await setAntiEdit('dm', true);
			return await message.send('_AntiEdit set for all chats_');
		}

		if (command === 'off') {
			await setAntiEdit('gc', false);
			await setAntiEdit('dm', false);
			return await message.send('_AntiEdit is now off for all chats_');
		}

		if (command === 'on gc' || command === 'on dm' || command === 'off gc' || command === 'off dm') {
			const [state, scope] = command.split(' ');
			await setAntiEdit(scope, state === 'on');
			return await message.send(`_AntiEdit for ${where(scope)} ${state === 'on' ? 'enabled' : 'disabled'}_`);
		}

		if (command === 'set gc' || command === 'set dm') {
			const scope = command.split(' ')[1];
			const newStatus = !(await getAntiEdit(scope));
			await setAntiEdit(scope, newStatus);
			return await message.send(`_AntiEdit for ${where(scope)} ${newStatus ? 'enabled' : 'disabled'}_`);
		}

		if (command === 'status') {
			const dmStatus = await getAntiEdit('dm');
			const gcStatus = await getAntiEdit('gc');

			let statusMessage = '_AntiEdit Status_\n\n';
			statusMessage += `*DM AntiEdit:* ${dmStatus ? 'Enabled' : 'Disabled'}\n`;
			statusMessage += `*Group Chat AntiEdit:* ${gcStatus ? 'Enabled' : 'Disabled'}\n`;
			return await message.send(statusMessage);
		}

		const helpMessage = `*AntiEdit Command Guide:*
• \`\`.antiedit on\`\` - Enable AntiEdit for all chats
• \`\`.antiedit off\`\` - Disable AntiEdit for all chats
• \`\`.antiedit on gc\`\` / \`\`.antiedit off gc\`\` - Group Chats only
• \`\`.antiedit on dm\`\` / \`\`.antiedit off dm\`\` - Direct Messages only
• \`\`.antiedit set gc\`\` / \`\`.antiedit set dm\`\` - Toggle one of them
• \`\`.antiedit set all\`\` - Enable AntiEdit for all chats
• \`\`.antiedit status\`\` - Check current AntiEdit status

In groups the original and the new text are sent in the group, for private chats they go to your own inbox.`;
		return await message.send(helpMessage);
	}
);

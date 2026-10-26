import { bot } from '#lib';
import { setAntiTagSwStatus, isAntiTagSwEnabled } from '#sql';

bot(
	{
		pattern: 'antitagsw',
		public: true,
		isGroup: true,
		desc: 'Warn/kick members who tag or mention a status in this group',
		type: 'group'
	},
	async (message, match) => {
		if (!(await message.isUserAdmin())) return message.send('_Only group admins can use this._');

		const arg = (match || '').trim().toLowerCase();
		if (!['on', 'off'].includes(arg)) {
			const enabled = await isAntiTagSwEnabled(message.jid);
			return await message.send(
				`\`\`\`Antitagsw is currently ${enabled ? 'ON' : 'OFF'} for this group.\n\nUse ${message.prefix}antitagsw on | off\`\`\``
			);
		}

		const enable = arg === 'on';
		const current = await isAntiTagSwEnabled(message.jid);
		if (current === enable) {
			return await message.send(`_Antitagsw is already ${enable ? 'on' : 'off'} for this group._`);
		}

		await setAntiTagSwStatus(message.jid, enable);
		return await message.send(
			`_Antitagsw turned ${enable ? 'on' : 'off'}._${
				enable ? ' Members who tag/mention a status here will be warned, then removed after 3 warnings.' : ''
			}`
		);
	}
);

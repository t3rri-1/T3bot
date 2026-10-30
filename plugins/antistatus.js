import { bot } from '#lib';
import { getAntiStatus, setAntiStatus } from '#sql';

bot(
	{
		pattern: 'antistatus',
		public: false,
		desc: 'Send the statuses people delete to your inbox (antistatus on / off)',
		type: 'user'
	},
	async (message, match) => {
		const option = (match || '').trim().toLowerCase();

		if (option === 'on' || option === 'off') {
			await setAntiStatus(option === 'on');
			return message.send(
				option === 'on'
					? '_AntiStatus is ON: a status that someone deletes is sent to your inbox_'
					: '_AntiStatus is OFF_'
			);
		}

		const on = await getAntiStatus();
		const prefix = Array.from(message.prefix || '.')[0] || '.';
		return message.send(
			[
				`*AntiStatus* is ${on ? 'ON' : 'OFF'}`,
				'',
				`• \`\`${prefix}antistatus on\`\` - send deleted statuses to your inbox`,
				`• \`\`${prefix}antistatus off\`\` - stop`,
				'',
				'_Only statuses the bot saw before they were deleted can be shown (it keeps them for 12 hours)._'
			].join('\n')
		);
	}
);

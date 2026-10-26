import { bot, devs } from '#lib';
import { toJid } from '#utils';
import { readFileSync } from 'fs';

bot(
	{
		pattern: 'report',
		public: true,
		desc: 'Request Feature or Report Bugs',
		type: 'help',
	},
	async (message, match) => {
		if (!match || match.split(' ').length < 5) return message.send('```Please provide a reason with at least 5 words to report a bug.```');
		const errorReport = `\`\`\`
BUG REPORT
FROM: @${message.sender.split('@')[0]}
MESSAGE: \n${match}
\`\`\``;
		for (const dev of devs) {
			await message.send(errorReport, {
				jid: toJid(dev),
				mentions: [message.sender],
			});
		}
	},
);
import { bot } from '#lib';
import { getConfig, updateConfig } from '#sql';
import { FONT_LIST, applyFont, DEFAULT_FONT_ID } from '../bot/fontlist.js';

bot(
	{
		pattern: 'font',
		public: false,
		desc: 'List available fonts, or set the font used for all bot replies',
		type: 'settings'
	},
	async (message, match) => {
		const arg = (match || '').trim();

		if (!arg) {
			const { fontStyle } = await getConfig();
			const current = fontStyle || DEFAULT_FONT_ID;
			const lines = FONT_LIST.map((entry, id) => {
				if (!entry) return null;
				const marker = id === current ? ' ✅' : '';
				return `${id}. ${entry.name}: ${applyFont('Sample', id)}${marker}`;
			}).filter(Boolean);

			return await message.send(
				`\`\`\`FONT LIST (current: ${current})\`\`\`\n\n${lines.join('\n')}\n\n_Use ${message.prefix}font <number> to set the font for all bot replies._`
			);
		}

		const id = parseInt(arg, 10);
		if (!Number.isInteger(id) || !FONT_LIST[id]) {
			return await message.send(`_Invalid font number. Use ${message.prefix}font to see the list._`);
		}

		await updateConfig('fontStyle', id);
		return await message.send(applyFont(`Font set to ${id}. ${FONT_LIST[id].name}`, id));
	}
);

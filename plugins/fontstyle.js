import { bot, Button } from '#lib';
import { getConfig, updateConfig } from '#sql';
import { FONT_LIST, applyFont, DEFAULT_FONT_ID } from '../bot/fontlist.js';

const PAGE_SIZE = 30; // fonts in one list message (the same size the group picker uses)
const SECTION_SIZE = 10; // rows in one section of the list
const SAMPLE = 'Hello World 123';

const clip = (text, max) => {
	const chars = [...String(text)];
	return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : chars.join('');
};

const fontIds = () => FONT_LIST.map((entry, id) => (entry ? id : null)).filter(Boolean);

/** The old plain list, still there as `font list` and as the fallback when a list message cannot be sent. */
async function sendTextList(message) {
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

/**
 * The font picker: one list message, every row is a font. A row's id is the command that sets it, so tapping a
 * row comes back as a normal command (`.font 12`). The 54 fonts continue on a second page.
 */
async function sendFontList(message, page = 0) {
	const { fontStyle } = await getConfig();
	const current = fontStyle || DEFAULT_FONT_ID;
	const ids = fontIds();
	const pages = Math.ceil(ids.length / PAGE_SIZE);
	page = Math.min(Math.max(0, page), pages - 1);

	const start = page * PAGE_SIZE;
	const slice = ids.slice(start, start + PAGE_SIZE);
	const command = Array.from(message.prefix || '.')[0] + 'font'; // the id of a row has to be a real command

	const list = new Button(message.client)
		.setBody(
			`*Pick a font*\n\nNow: ${current}. ${FONT_LIST[current]?.name || 'Normal'}\n${applyFont(SAMPLE, current)}\n\n` +
				`The bot writes all its replies in the font you choose.` +
				(pages > 1 ? `\n\nPage ${page + 1} of ${pages}` : '')
		)
		.setFooter('Tap "Select font" and choose one')
		.addSelection('Select font');

	for (let i = 0; i < slice.length; i += SECTION_SIZE) {
		const chunk = slice.slice(i, i + SECTION_SIZE);
		list.makeSection(`Fonts ${chunk[0]}-${chunk[chunk.length - 1]}`);
		for (const id of chunk) {
			const sample = applyFont(SAMPLE, id) + (id === current ? '  ✅' : '');
			list.makeRow('', clip(`${id}. ${FONT_LIST[id].name}`, 24), clip(sample, 72), `${command} ${id}`);
		}
	}
	if (start + PAGE_SIZE < ids.length) {
		list.makeSection('More');
		list.makeRow('', 'More fonts ➡️', `Fonts from ${ids[start + PAGE_SIZE]}`, `${command} page ${page + 2}`);
	}
	return await list.send(message.jid);
}

bot(
	{
		pattern: 'font',
		public: false,
		desc: 'Pick the font used for all bot replies from a list (or set it with a number)',
		type: 'settings'
	},
	async (message, match) => {
		const arg = (match || '').trim();

		if (!arg) {
			try {
				return await sendFontList(message);
			} catch {
				// list messages did not go through here, the plain list still does the job
				return await sendTextList(message);
			}
		}

		if (/^list$/i.test(arg)) return await sendTextList(message);

		const more = arg.match(/^page\s+(\d+)$/i); // the "More fonts" row of the list
		if (more) {
			try {
				return await sendFontList(message, parseInt(more[1], 10) - 1);
			} catch {
				return await sendTextList(message);
			}
		}

		const id = parseInt(arg, 10);
		if (!Number.isInteger(id) || !FONT_LIST[id]) {
			return await message.send(`_Invalid font number. Use ${message.prefix}font to pick from the list._`);
		}

		await updateConfig('fontStyle', id);
		return await message.send(applyFont(`Font set to ${id}. ${FONT_LIST[id].name}`, id));
	}
);

import { bot } from '#lib';
import { getConfig, getNoPrefix, setNoPrefix } from '#sql';

bot(
	{
		pattern: 'prefix',
		public: false,
		desc: 'Prefix on/off: with the prefix off, commands also work without it (menu, Menu)',
		type: 'settings'
	},
	async (message, match) => {
		const arg = (match || '').trim().toLowerCase();
		const { PREFIX } = await getConfig();
		const first = Array.from(PREFIX)[0] || '.';

		if (arg === 'on' || arg === 'off') {
			const noPrefix = arg === 'off';
			if ((await getNoPrefix()) === noPrefix) return await message.send(`_Prefix is already ${arg}._`);
			await setNoPrefix(noPrefix);
			return await message.send(
				noPrefix
					? `_Prefix is off. Commands work without it now: menu, Menu, ping ..._\n_${first}menu still works too. Use ${first}prefix on to bring the prefix back._`
					: `_Prefix is on. Commands need the prefix again, e.g. ${first}menu._`
			);
		}

		if (arg) return await message.send(`_Use ${first}prefix on or ${first}prefix off_`);

		const noPrefix = await getNoPrefix();
		return await message.send(
			`*Prefix*\n` +
				`Status: \`\`\`${noPrefix ? 'off' : 'on'}\`\`\`\n` +
				`Prefix: \`\`\`${PREFIX}\`\`\`\n\n` +
				`_${first}prefix off: commands also work without the prefix (menu, Menu)_\n` +
				`_${first}prefix on: commands need the prefix_\n` +
				`_${first}setprefix <char>: change the prefix itself_`
		);
	}
);

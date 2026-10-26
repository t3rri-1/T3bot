import { extractUrlFromString, getJson } from '#utils';
import { bot, Button, devs, getUsers } from '#lib';
import { config } from '#config';
import { T3 } from '#utils';

bot(
	{
		pattern: 'pair',
		public: true,
		desc: 'Get Your Pairing Code Now',
		type: 'help'
	},
	async (message, match) => {
		const jid = await message.getUserJid(match);
		if (!jid) return message.send('_Give me the number that needs pairing code_');
		if (typeof jid !== 'string') return; // getUserJid already asked for a reply or a tag
		const number = jid.split('@')[0];

		await message.react('⏳');
		const res = await getJson(`https://t3rri-id.onrender.com/pair?phone=${number}`).catch(() => null);
		const code = String(res?.code || '').replace(/[^a-z0-9]/gi, ''); // the 8 characters, a dash is only there for reading
		if (!code) return message.send('*unable to get a pairing code, try again!*');
		const shown = code.match(/.{1,4}/g).join('-');

		try {
			await new Button(message.client)
				.setBody(
					`*Pairing code for +${number}*\n\n\`` +
					`WhatsApp > Linked devices > Link a device > Link with phone number instead, then enter the code.`
				)
				.setFooter('Tap the button to copy the code')
				.addCopy('📋 Copy code', code, { id: 'copy_pairing_code' })
				.send(message.jid);
		} catch {
			
			return message.send('```Pairing CODE:\n' + shown + '```');
		}
	}
);

bot(
	{
		pattern: 'support',
		public: true,
		desc: 'Sends developer support information',
		type: 'help'
	},
	async message => {
		const contacts = devs.map(dev => {
			return {
				vcard: `BEGIN:VCARD
VERSION:3.0
FN:Developer ${dev}
ORG:${config.BOT_INFO.split(';')[0]}
TEL;type=CELL;type=VOICE;waid=${dev}:${dev}
END:VCARD`
			};
		});
		return await message.client.sendMessage(message.jid, {
			contacts: {
				displayName: 'Developer Support',
				contacts: contacts
			}
		});
	}
);

bot(
	{
		pattern: 'users',
		public: true,
		desc: 'Get Total Users',
		type: 'help'
	},
	async message => {
		return await message.send(`\`\`\`T3 Current Users:\n ${(await getUsers()).users}\`\`\``);
	}
);

bot(
	{
		pattern: 'readmore',
		public: true,
		desc: 'Adds *readmore* in given text.',
		type: 'tools'
	},
	async (message, match) => {
		if (!match) return await message.send('*Give me text!*');
		const [text1, text2] = match.split(';');
		if (!text2) return await message.send('*Format: text1;text2*');
		return await message.send(text1 + String.fromCharCode(8206).repeat(4001) + `\n${text2}`);
	}
);

bot(
	{
		pattern: 'fliptext',
		public: true,
		desc: 'Flips given text upside down',
		type: 'misc'
	},
	async (message, match) => {
		if (!match) return await message.send('*Give me text to flip!*');
		const flip = match
			.split('')
			.map(char => {
				const flipped =
					{
						a: 'ɐ',
						b: 'q',
						c: 'ɔ',
						d: 'p',
						e: 'ǝ',
						f: 'ɟ',
						g: 'ƃ',
						h: 'ɥ',
						i: 'ᴉ',
						j: 'ɾ',
						k: 'ʞ',
						l: 'l',
						m: 'ɯ',
						n: 'u',
						o: 'o',
						p: 'd',
						q: 'b',
						r: 'ɹ',
						s: 's',
						t: 'ʇ',
						u: 'n',
						v: 'ʌ',
						w: 'ʍ',
						x: 'x',
						y: 'ʎ',
						z: 'z'
					}[char.toLowerCase()] || char;
				return flipped;
			})
			.reverse()
			.join('');
		return await message.send(flip);
	}
);

bot(
	{
		pattern: 'mp4url',
		public: true,
		desc: 'Get direct mp4 url from video message',
		type: 'misc'
	},
	async (message, match) => {
		if (!match || !/^https?:\/\/[^\s$.?#].[^\s]*$/.test(match))
			return message.send('*Please provide a valid URL*');
		const img = await message.getProfileImage(message.sender);
		const url = extractUrlFromString(match);
		return await message.client.sendMessage(message.jid, {
			video: { url: url },
			caption: '*HERE WE GO*',
			contextInfo: {
				externalAdReply: {
					title: config.BOT_INFO.split(';')[0],
					body: message.pushName,
					thumbnail: img || null,
					mediaType: 2,
					mediaUrl: null
				}
			}
		});
	}
);

bot(
	{
		pattern: 'math',
		public: true,
		desc: 'Solve a Maths Expression',
		type: 'misc'
	},
	async (message, match) => {
		if (!match) {
			return await message.send(
				'Please provide a mathematical expression to solve. Example: `.math 2 + 2`'
			);
		}
		const msg = await message.send('*Calculating...*');
		try {
			const { evaluate } = await import('mathjs'); // large library, loaded on first use
			const result = evaluate(match);
			return await msg.edit(`Result: ${result}`);
		} catch {
			return await msg.edit(`_Invaild Math Operation_`);
		}
	}
);

bot(
	{
		pattern: 'link',
		public: true,
		desc: 'Shortens a url',
		type: 'tools'
	},
	async (message, match) => {
		if (!match || !/^https?:\/\/[^\s$.?#].[^\s]*$/.test(match))
			return message.send('*Please provide a valid URL*');
		const msg = await message.send('*Shortening URL...*');
		const url = extractUrlFromString(match);
		const res = await T3.short(url);
		if (!res) return await msg.edit('*Failed to shorten URL*');
		return await msg.edit(`*Shortened URL:* ${res}`);
	}
);

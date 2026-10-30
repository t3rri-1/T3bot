import { bot } from '#lib';
import {
	FeelBetter,
	GPT5,
	Img2Img,
	Qwen3,
	TXT2IMG_STYLES,
	Txt2Img,
	Txt2Img2,
	UNLIMITEDAI_CHARACTERS,
	UnlimitedAI,
	detectType,
	findMediaUrl,
	getBuffer
} from '#utils';
import { getSharp } from '../utils/sharp.js';

const prefixOf = message => Array.from(message.prefix || '.')[0] || '.';

const clip = (text, max) => {
	const clean = String(text ?? '')
		.replace(/\s+/g, ' ')
		.trim();
	return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
};

// A service that is down, or a prompt it refuses, is not a bug: say so instead of sending an error report to the owner.
const attempt = async (message, work) => {
	try {
		return await work();
	} catch (err) {
		console.log('[aichat]', err?.message || err);
		return message.send(`_${clip(err?.message || 'Something went wrong, try again', 200)}_`);
	}
};

// One question, one answer: the "thinking" message turns into the answer.
const ask = async (message, prompt, usage, run) => {
	if (!prompt) return message.send(`_${usage}_`);
	const status = await message.send('_Thinking..._');
	const res = await run(prompt);
	const answer = res.answer?.trim();
	if (!res.status || !answer) return status.edit(`_${clip(res.error, 160) || 'The AI gave no answer, try again'}_`);
	return status.edit(answer);
};

const promptOf = (message, match) => (match || message.reply_message?.text || '').trim();

bot(
	{ pattern: 'gpt5', public: true, desc: 'Chat with GPT (gpt-4.1 nano)', type: 'ai' },
	async (message, match) =>
		attempt(message, () =>
			ask(message, promptOf(message, match), `Ask me something, eg. ${prefixOf(message)}gpt5 what is a black hole?`, GPT5)
		)
);

bot(
	{ pattern: 'qwen3', public: true, desc: 'Chat with Qwen3', type: 'ai' },
	async (message, match) =>
		attempt(message, () =>
			ask(message, promptOf(message, match), `Ask me something, eg. ${prefixOf(message)}qwen3 explain recursion simply`, Qwen3)
		)
);

bot(
	{ pattern: 'feelbetter', public: true, desc: 'Talk it out with FeelBetterBot, a listening bot', type: 'ai' },
	async (message, match) =>
		attempt(message, () =>
			ask(
				message,
				promptOf(message, match),
				`Tell me what is on your mind, eg. ${prefixOf(message)}feelbetter I had a rough day`,
				prompt =>
					FeelBetter(prompt, {
						system: 'Follow the language the user writes in. Reply in a warm, natural and clear way, and keep it short.'
					})
			)
		)
);

bot(
	{ pattern: 'unlimitedai', public: true, desc: 'Chat with UnlimitedAI as a character (unlimitedai list)', type: 'ai' },
	async (message, match) =>
		attempt(message, async () => {
			const prefix = prefixOf(message);
			const text = promptOf(message, match);
			const [first = '', ...rest] = text.split(/\s+/);

			if (first.toLowerCase() === 'list') {
				const lines = Object.entries(UNLIMITEDAI_CHARACTERS).map(([key, char]) => `• ${key} (${char.name})`);
				return message.send(`*Characters*\n\n${lines.join('\n')}\n\n_${prefix}unlimitedai kobo-ai hello_`);
			}

			const character = UNLIMITEDAI_CHARACTERS[first.toLowerCase()] ? first.toLowerCase() : 'ourin-ai';
			const prompt = character === first.toLowerCase() ? rest.join(' ').trim() || message.reply_message?.text || '' : text;
			return ask(
				message,
				prompt.trim(),
				`Ask me something, eg. ${prefix}unlimitedai hello. Pick a character with ${prefix}unlimitedai kobo-ai hello (${prefix}unlimitedai list)`,
				question => UnlimitedAI(question, character)
			);
		})
);

// A webp picture is sent as a jpeg: phones show a webp that went out as a photo badly
const asPhoto = async buffer => {
	try {
		if ((await detectType(buffer)).mime === 'image/jpeg') return buffer;
		const sharp = await getSharp();
		return await sharp(buffer).jpeg({ quality: 92 }).toBuffer();
	} catch {
		return buffer;
	}
};

// source: a link, a data: URI or a Buffer
const sendPicture = async (message, source, caption) => {
	let image = source;
	if (typeof source === 'string') {
		image = source.startsWith('data:') ? Buffer.from(source.split(',')[1], 'base64') : await getBuffer(source);
	}
	return message.send(await asPhoto(image), { type: 'image', caption });
};

bot(
	{
		pattern: 'txt2img',
		public: true,
		desc: `Draw a picture from a text (styles: ${TXT2IMG_STYLES.join(', ')})`,
		type: 'ai'
	},
	async (message, match) =>
		attempt(message, async () => {
			const words = promptOf(message, match).split(/\s+/).filter(Boolean);
			const style = TXT2IMG_STYLES.includes(words[0]?.toLowerCase()) ? words.shift().toLowerCase() : 'anime';
			const prompt = words.join(' ');
			if (!prompt) {
				return message.send(
					`_Say what to draw, eg. ${prefixOf(message)}txt2img a cat on the moon_\n_Styles: ${TXT2IMG_STYLES.join(', ')} (put one first: ${prefixOf(message)}txt2img fantasy a castle)_`
				);
			}
			const status = await message.send('_Drawing..._');
			const picture = await Txt2Img(prompt, style);
			await sendPicture(message, picture, `_${style}_`);
			return status.delete().catch(() => {});
		})
);

bot(
	{ pattern: 'flux', public: true, desc: 'Draw a picture from a text (FLUX.2 klein)', type: 'ai' },
	async (message, match) =>
		attempt(message, async () => {
			const prompt = promptOf(message, match);
			if (!prompt) return message.send(`_Say what to draw, eg. ${prefixOf(message)}flux a lighthouse at dawn, watercolor_`);
			const status = await message.send('_Drawing..._');
			const res = await Txt2Img2(prompt);
			if (!res.status) return status.edit(`_${clip(res.error, 160) || 'Could not draw that'}_`);
			await sendPicture(message, res.url, `_${clip(prompt, 100)}_`);
			return status.delete().catch(() => {});
		})
);

bot(
	{ pattern: 'img2img', public: true, desc: 'Change a photo with a text (reply to the photo)', type: 'ai' },
	async (message, match) =>
		attempt(message, async () => {
			const prompt = (match || '').trim();
			if (!message.reply_message?.image || !prompt) {
				return message.send(`_Reply to a photo with what to change, eg. ${prefixOf(message)}img2img make it a watercolor painting_`);
			}
			const status = await message.send('_Working on it, this can take a minute..._');
			const res = await Img2Img(prompt, await message.download());
			if (!res.status) return status.edit(`_${clip(res.error, 160) || 'Could not change that photo'}_`);

			const url = findMediaUrl(res.result, ['url', 'image', 'output', 'result']);
			if (!url) return status.edit('_The service finished without giving a picture_');
			await sendPicture(message, url, `_${clip(prompt, 100)}_`);
			return status.delete().catch(() => {});
		})
);

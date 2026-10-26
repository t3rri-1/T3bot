import yts from 'yt-search';
import { bot, Button, Carousel } from '#lib';
import { T3, convertToMp3, extractUrl, getBuffer, getFileAndSave } from '#utils';

const MAX_CARDS = 10; // WhatsApp shows at most 10 cards in one carousel
const numbers = new Intl.NumberFormat('en-US');

const clip = (text, max) => {
	const clean = String(text ?? '')
		.replace(/\s+/g, ' ')
		.trim();
	return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
};

const prefixOf = message => Array.from(message.prefix || '.')[0] || '.';

const cardText = video =>
	[
		clip(video.title, 70),
		'',
		'╭──────────┈⊷',
		'│☆ ╭─────────',
		`│☆│ 🎧 ${clip(video.title, 40)}`,
		`│☆│ 📺 ${clip(video.author?.name, 30) || '—'}`,
		`│☆│ ⏱️ ${video.timestamp || '—'}`,
		`│☆│ 👁️ ${Number.isFinite(video.views) ? numbers.format(video.views) : '—'} views`,
		'│☆ ╰──────────',
		'╰───────────┈⊷'
	].join('\n');

const makeCard = (client, video, prefix, thumb) =>
	new Button(client)
		.setImage(thumb)
		.setBody(cardText(video))
		.addReply('AUDIO', `${prefix}ytmp3 ${video.videoId}`)
		.addReply('VIDEO', `${prefix}ytmp4 ${video.videoId}`);

// The thumbnail from the search goes first, YouTube's plain 16:9 one is the backup.
const thumbsOf = video => [
	...new Set(
		[video.thumbnail, video.image, `https://i.ytimg.com/vi/${video.videoId}/mqdefault.jpg`].filter(Boolean)
	)
];

const uploadCard = async (client, video, prefix) => {
	let failure;
	for (const thumb of thumbsOf(video)) {
		try {
			return await makeCard(client, video, prefix, thumb).toCard();
		} catch (err) {
			failure = err;
		}
	}
	throw failure;
};

bot(
	{
		pattern: 'yts',
		public: true,
		desc: 'Search YouTube, results come as cards with Audio and Video buttons',
		type: 'search'
	},
	async (message, match) => {
		const prefix = prefixOf(message);
		const query = (match || message.reply_message?.text || '').trim();
		if (!query) return message.send(`_Give me something to search, eg. ${prefix}yts Carla Morrison Disfruto_`);

		const { videos } = await yts(query);
		const results = videos.filter(video => video.videoId).slice(0, MAX_CARDS);
		if (!results.length) return message.send(`_No results found for "${query}"_`);

		// a carousel needs at least two cards, so a lone result goes out as a single card
		if (results.length === 1) {
			return await makeCard(message.client, results[0], prefix, thumbsOf(results[0])[0]).send(message.jid);
		}

		const built = await Promise.allSettled(results.map(video => uploadCard(message.client, video, prefix)));
		const cards = built.filter(result => result.status === 'fulfilled').map(result => result.value);
		if (cards.length < 2) throw new Error('Could not load the video thumbnails, try again');

		return await new Carousel(message.client)
			.setBody(`🔎 YouTube results for "${clip(query, 60)}"`)
			.setFooter('Tap AUDIO or VIDEO to download')
			.addCard(cards)
			.send(message.jid);
	}
);

const YT_ID = /^[\w-]{11}$/;
const getVideoId = input => {
	const text = String(input || '').trim();
	if (YT_ID.test(text)) return text;
	const link = extractUrl(text);
	if (!link) return null;
	try {
		const url = new URL(link);
		const host = url.hostname.replace(/^(www|m|music)\./, '');
		let id = null;
		if (host === 'youtu.be') id = url.pathname.split('/')[1];
		else if (host === 'youtube.com') {
			id = url.searchParams.get('v') || url.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{11})/)?.[1];
		}
		return YT_ID.test(id || '') ? id : null;
	} catch {
		return null;
	}
};

// Stops a double tap on a button from starting the same download twice.
const busy = new Set();

const download = async (message, input, kind) => {
	const id = getVideoId(input) || getVideoId(message.reply_message?.text);
	if (!id) return message.send(`_Send a YouTube link, or find one with ${prefixOf(message)}yts_`);

	const lock = `${message.jid}:${id}:${kind}`;
	if (busy.has(lock)) return;
	busy.add(lock);
	try {
		await message.react('⏳').catch(() => {});
		const url = `https://www.youtube.com/watch?v=${id}`;

		if (kind === 'mp3') {
			const res = await T3.youtube(url, { mp3: true });
			const file = await getFileAndSave(res.url);
			if (!file) return await message.send('_Could not download that audio, try again_');
			const audio = await convertToMp3(file);
			const thumbnail = await getBuffer(`https://i.ytimg.com/vi/${id}/mqdefault.jpg`).catch(() => undefined);
			return await message.send(audio, {
				type: 'audio',
				mimetype: 'audio/mpeg',
				ptt: false,
				contextInfo: {
					externalAdReply: {
						title: res.title || 'YouTube audio',
						body: 'YouTube',
						thumbnail,
						sourceUrl: url,
						renderLargerThumbnail: false,
						showAdAttribution: true
					}
				}
			});
		}

		const res = await T3.youtube(url, { mp4: true });
		const video = await getBuffer(res.url);
		return await message.send(video, { type: 'video', mimetype: 'video/mp4', caption: res.title });
	} finally {
		busy.delete(lock);
	}
};

bot(
	{
		pattern: 'ytmp3',
		public: true,
		desc: 'Download YouTube audio from a link',
		type: 'download'
	},
	(message, match) => download(message, match, 'mp3')
);

bot(
	{
		pattern: 'ytmp4',
		public: true,
		desc: 'Download YouTube video from a link',
		type: 'download'
	},
	(message, match) => download(message, match, 'mp4')
);

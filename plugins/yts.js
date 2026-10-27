import { bot, Button, Carousel } from '#lib';
import { getBuffer, getVideoId, ytSearch, ytmp3, ytmp4 } from '#utils';

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

		const results = (await ytSearch(query)).slice(0, MAX_CARDS);
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

const watchUrl = id => `https://www.youtube.com/watch?v=${id}`;

// A file name phones accept: no path or reserved characters, no doubled extension.
const fileName = (title, ext) => {
	const name = String(title || '')
		.replace(/\.(mp3|mp4)$/i, '')
		.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 100);
	return `${name || 'YouTube'}.${ext}`;
};

// Stops a double tap on a button from starting the same download twice.
const busy = new Set();

// source: a YouTube link, or a search text (the first result is used)
const sendYouTube = async (message, source, kind) => {
	const lock = `${message.jid}:${source}:${kind}`;
	if (busy.has(lock)) return;
	busy.add(lock);
	try {
		await message.react('⏳').catch(() => {});

		if (kind === 'mp3') {
			// 256 kbps. It comes as mp3 already, so it goes out as it is, as a document
			const { video, download } = await ytmp3(source);
			const audio = await getBuffer(download.downloadUrl);
			const thumbnail = await getBuffer(`https://i.ytimg.com/vi/${video.id}/mqdefault.jpg`).catch(() => undefined);
			return await message.send(audio, {
				type: 'document',
				mimetype: 'audio/mpeg',
				fileName: fileName(video.title || download.title, 'mp3'),
				contextInfo: {
					externalAdReply: {
						title: video.title || download.title || 'YouTube audio',
						body: video.author || 'YouTube',
						thumbnail,
						sourceUrl: watchUrl(video.id),
						renderLargerThumbnail: false,
						showAdAttribution: true
					}
				}
			});
		}

		// 720p, sent as it is
		const { video, download } = await ytmp4(source);
		const file = await getBuffer(download.downloadUrl);
		return await message.send(file, {
			type: 'video',
			mimetype: 'video/mp4',
			caption: video.title || download.title
		});
	} catch (err) {
		if (err?.tooLarge) return await message.send('_That file is too large to send from this host_');
		throw err;
	} finally {
		busy.delete(lock);
	}
};

// ytmp3 / ytmp4: a link or a video id (the Audio / Video buttons send the id)
const byLink = kind => async (message, match) => {
	const id = getVideoId(match) || getVideoId(message.reply_message?.text);
	if (!id) return message.send(`_Send a YouTube link, or find one with ${prefixOf(message)}yts_`);
	return sendYouTube(message, watchUrl(id), kind);
};

// play / video: a name to search for, or a link
const byName = (kind, what) => async (message, match) => {
	if (!match) return message.send(`_Give me ${what} name to search for!_`);
	return sendYouTube(message, match, kind);
};

bot(
	{
		pattern: 'ytmp3',
		public: true,
		desc: 'Download YouTube audio from a link',
		type: 'download'
	},
	byLink('mp3')
);

bot(
	{
		pattern: 'ytmp4',
		public: true,
		desc: 'Download YouTube video from a link',
		type: 'download'
	},
	byLink('mp4')
);

bot(
	{
		pattern: 'play',
		public: true,
		desc: 'Searchs and Downloads Audio',
		type: 'download'
	},
	byName('mp3', 'song')
);

bot(
	{
		pattern: 'video',
		public: true,
		desc: 'Searchs and Downloads Video',
		type: 'download'
	},
	byName('mp4', 'video')
);

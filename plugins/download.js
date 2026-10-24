import { bot } from '#lib';
import { Button } from '../lib/button.js';
import {
	convertToMp3,
	extractUrl,
	getFileAndSave,
	isfacebook,
	isInsta,
	isReddit,
	isRumble,
	isTikTok,
	isUrl,
	toTwitter,
	T3
} from '#utils';
import { getBuffer, getJson } from '#utils';

const API = `https://api.nexoracle.com`;
const KEY = `free_key@maher_apis`;

bot(
	{
		pattern: 'apk',
		public: true,
		desc: 'Downloads Apk files',
		type: 'download'
	},
	async (message, match) => {
		if (!match) return message.send('_Give me Apk, eg. WhatsApp_');
		const data = (await getJson(`${API}/downloader/apk?apikey=${KEY}&q=${match}`)).result;
		const app = await getBuffer(data.dllink);
		return message.sendFile(app, data.name, data.name);
	}
);

bot(
	{
		pattern: 'facebook',
		public: true,
		desc: 'Downloads facebook Videos & Reels',
		type: 'download'
	},
	async (message, match) => {
		let url;
		url = match || message.reply_message.text;
		if (!url) return message.send('_No facebook link found!_');
		url = extractUrl(url);
		if (!isfacebook(url)) return message.send('_Provide facebook link!_');
		const data = (await getJson(`${API}/downloader/facebook2?apikey=${KEY}&url=${url}`)).result;
		return await message.sendFromUrl(data.videoUrl, true, { caption: data.title });
	}
);

bot(
	{
		pattern: 'instagram',
		public: true,
		desc: 'Downloads Instagram, video & reels',
		type: 'download'
	},
	async (message, match) => {
		let url;
		url = match || message.reply_message.text;
		if (!url) return message.send('_No Instagram link found!_');
		url = extractUrl(url);
		url = url.replace(/https:\/\/www\.instagram\.com\/([^\/]+)\//, 'https://www.instagram.com/');
		if (!isInsta(url)) return message.send('_Provide Instagram link!_');
		const data = (await getJson(`${API}/downloader/insta2?apikey=${KEY}&url=${url}`)).result;
		return await message.sendFromUrl(data.video);
	}
);

bot(
	{
		pattern: 'story',
		public: true,
		desc: 'Downloads Instagram Stories',
		type: 'download'
	},
	async (message, match) => {
		if (!match) return message.send('_Give me IG username_');
		const data = await fetch(`${API}/downloader/insta-story?apikey=${KEY}&username=${match}`)
			.then(r => r.json())
			.then(json => (json.status === 200 && json.result ? json.result : false))
			.catch(() => false);
		if (!data) return message.send(`_${match} has no stories at the moment_`);
		for (const story of data) {
			await message.sendFromUrl(story.url);
		}
	}
);

bot(
	{
		pattern: 'twitter',
		public: true,
		desc: 'Download X Videos',
		type: 'download'
	},
	async (message, match) => {
		let url;
		url = match || message.reply_message.text;
		if (!url) return message.send('_No twitter link found!_');
		url = extractUrl(url);
		if (!toTwitter(url)) return message.send('_Provide Twitter link!_');
		url = toTwitter(url);
		const data = (await getJson(`${API}/downloader/twitter?apikey=${KEY}&url=${url}`)).result;
		return await message.sendFromUrl(data.video, true, { caption: data.caption });
	}
);

bot(
	{
		pattern: 'reddit',
		public: true,
		desc: 'Downloads Reddit Videos',
		type: 'download'
	},
	async (message, match) => {
		let url;
		url = match || message.reply_message.text;
		if (!url) return message.send('_No Reddit link found!_');
		url = extractUrl(url);
		if (!isReddit(url)) return message.send('_Provide Reddit link!_');
		const data = (await getJson(`${API}/downloader/reddit?apikey=${KEY}&url=${url}`)).result;
		return message.sendFromUrl(data.url, true, { caption: data.title });
	}
);

const TIKTOK_API = 'https://aj-ibra.zone.id/api/tiktok';
const TIKTOK_CACHE_MS = 10 * 60_000;
const tiktokCache = new Map();

const clip = (text, max) => {
	const clean = String(text ?? '')
		.replace(/\s+/g, ' ')
		.trim();
	return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
};

const prefixOf = message => Array.from(message.prefix || '.')[0] || '.';

const cleanTikTokLink = input => {
	const link = extractUrl(String(input || ''));
	if (!link || !isTikTok(link)) return null;
	try {
		const url = new URL(link);
		return `${url.origin}${url.pathname}`;
	} catch {
		return null;
	}
};

const getTikTok = async link => {
	const hit = tiktokCache.get(link);
	if (hit && Date.now() - hit.at < TIKTOK_CACHE_MS) return hit.data;
	const res = await getJson(`${TIKTOK_API}?url=${encodeURIComponent(link)}`).catch(() => null);
	if (!res?.success || !res.result) return null;
	tiktokCache.set(link, { at: Date.now(), data: res.result });
	if (tiktokCache.size > 30) tiktokCache.delete(tiktokCache.keys().next().value);
	return res.result;
};

const row = (icon, value) => (value ? `│☆│ ${icon} ${value}` : null);

const tiktokInfo = data => {
	const author = [data.author?.name, data.author?.username && `(${data.author.username})`].filter(Boolean).join(' ');
	const photos = Array.isArray(data.images) && data.images.length ? `${data.images.length} photos` : '';
	return [
		'╭──────────┈⊷',
		'│☆ ╭─────────',
		row('🎬', clip(data.title, 80)),
		row('👤', author),
		row('📅', data.create_at),
		row('📸', photos),
		row('▶️', data.stats?.play && `${data.stats.play} views`),
		row('❤️', data.stats?.like && `${data.stats.like} likes`),
		row('💬', data.stats?.comment && `${data.stats.comment} comments`),
		row('🔁', data.stats?.share && `${data.stats.share} shares`),
		row('🎵', clip(data.music_info?.title, 50)),
		'│☆ ╰─────────',
		'╰──────────┈⊷'
	]
		.filter(Boolean)
		.join('\n');
};

bot(
	{
		pattern: 'tiktok',
		public: true,
		desc: 'Tiktok info with Audio and Video buttons',
		type: 'download'
	},
	async (message, match) => {
		const input = match || message.reply_message?.text;
		if (!input) return message.send('_No Tiktok link found!_');
		const link = cleanTikTokLink(input);
		if (!link) return message.send('_Provide Tiktok link!_');

		const data = await getTikTok(link);
		if (!data) return message.send('_Could not get that Tiktok, check the link and try again_');

		const prefix = prefixOf(message);
		const cover = data.cover ? await getBuffer(data.cover).catch(() => null) : null;
		const card = new Button(message.client)
			.setBody(tiktokInfo(data))
			.setFooter('Tap AUDIO or VIDEO to download')
			.addReply('AUDIO', `${prefix}ttmp3 ${link}`)
			.addReply('VIDEO', `${prefix}ttmp4 ${link}`);
		if (cover) card.setImage(cover);
		return await card.send(message.jid);
	}
);

// Stops a double tap on a button from starting the same download twice.
const busyTikTok = new Set();

const sendTikTok = async (message, input, kind) => {
	const link = cleanTikTokLink(input) || cleanTikTokLink(message.reply_message?.text);
	if (!link) return message.send(`_Send a Tiktok link, eg. ${prefixOf(message)}tt${kind} <link>_`);

	const lock = `${message.jid}:${link}:${kind}`;
	if (busyTikTok.has(lock)) return;
	busyTikTok.add(lock);
	try {
		await message.react('⏳').catch(() => {});
		const data = await getTikTok(link);
		if (!data) return await message.send('_Could not get that Tiktok, check the link and try again_');

		if (kind === 'mp3') {
			if (!data.musicUrl) return await message.send('_This Tiktok has no audio_');
			const audio = await getBuffer(data.musicUrl);
			return await message.send(audio, { type: 'audio', mimetype: 'audio/mpeg', ptt: false });
		}

		if (data.videoUrl) {
			const video = await getBuffer(data.videoUrl);
			return await message.send(video, {
				type: 'video',
				mimetype: 'video/mp4',
				caption: clip(data.title, 500) || undefined
			});
		}

		// photo posts have no video, their pictures come in "images"
		const pictures = (Array.isArray(data.images) ? data.images : [])
			.map(img => (typeof img === 'string' ? img : img?.url))
			.filter(isUrl)
			.slice(0, 10);
		if (!pictures.length) return await message.send('_No video found in this Tiktok_');
		for (const [i, picture] of pictures.entries()) {
			await message.send(await getBuffer(picture), {
				type: 'image',
				caption: i === 0 ? clip(data.title, 500) || undefined : undefined
			});
		}
	} catch (err) {
		if (err?.tooLarge) return await message.send('_That file is too large to send from this host_');
		throw err;
	} finally {
		busyTikTok.delete(lock);
	}
};

bot(
	{
		pattern: 'ttmp3',
		public: true,
		desc: 'Download Tiktok audio from a link',
		type: 'download'
	},
	(message, match) => sendTikTok(message, match, 'mp3')
);

bot(
	{
		pattern: 'ttmp4',
		public: true,
		desc: 'Download Tiktok video from a link',
		type: 'download'
	},
	(message, match) => sendTikTok(message, match, 'mp4')
);

bot(
	{
		pattern: 'play',
		public: true,
		desc: 'Searchs and Downloads Audio',
		type: 'download'
	},
	async (message, match) => {
		if (!match) return message.send('_Give me song name to search for!_');
		if (isUrl(match)) return message.send('_No urls allowed, just name of your song_');
		const url = (await getJson(`${API}/downloader/yt-search?apikey=${KEY}&q=${match}`)).result[0]
			.url;
		const data = (await getJson(`${API}/downloader/yt-audio?apikey=${KEY}&url=${url}`)).result;
		const { title, desc, thumb } = data;
		const video = await T3.youtube(url, { mp3: true });
		const mp3 = await getFileAndSave(video.url);
		const song = await convertToMp3(mp3);
		return await message.send(song, {
			mimetype: 'audio/mpeg',
			ptt: false,
			contextInfo: {
				externalAdReply: {
					title: title,
					body: desc,
					thumbnail: await getBuffer(thumb),
					renderLargerThumbnail: false,
					showAdAttribution: true
				}
			}
		});
	}
);

bot(
	{
		pattern: 'video',
		public: true,
		desc: 'Searchs and Downloads Video',
		type: 'download'
	},
	async (message, match) => {
		if (!match) return message.send('_Give me video name to search for!_');
		if (isUrl(match)) return message.send('_No urls allowed, just name of your video_');
		const url = (await getJson(`${API}/downloader/yt-search?apikey=${KEY}&q=${match}`)).result[0]
			.url;
		const data = (await getJson(`${API}/downloader/yt-audio?apikey=${KEY}&url=${url}`)).result;
		const { title, desc, thumb } = data;
		const res = await T3.youtube(url, { mp4: true });
		const video = await getBuffer(res.url);
		return await message.send(video, {
			mimetype: 'video/mp4',
			contextInfo: {
				externalAdReply: {
					title: title,
					body: desc,
					thumbnail: await getBuffer(thumb),
					renderLargerThumbnail: false,
					showAdAttribution: true
				}
			}
		});
	}
);

const rumble = new Map();

bot(
	{
		pattern: 'rumble',
		public: true,
		desc: 'Download Rumble Videos',
		type: 'download'
	},
	async (message, match) => {
		let url;
		url = match || message.reply_message.text;
		if (!url) return message.send('_No Rumble link found!_');
		url = extractUrl(url);
		if (!isRumble(url)) return message.send('_Provide a valid Rumble link!_');

		const data = (await getJson(`${API}/downloader/rumble?apikey=${KEY}&url=${url}`)).result;

		const { title, medias } = data;
		if (!medias || medias.length === 0) return message.send('_No downloadable media found!_');

		let optionsMessage = `*${title}*\n\nChoose a quality to download:\n`;
		const options = {};
		medias.forEach((media, index) => {
			const qualityOption = `${index + 1}`;
			options[qualityOption] = media.url;
			optionsMessage += `${qualityOption}. ${media.quality} (${media.formattedSize})\n`;
		});

		const msg = await message.send(optionsMessage);
		rumble.set(msg.id, { chatId: message.jid, options });
	}
);

bot(
	{
		on: 'reply',
		dontAddCommandList: true
	},
	async message => {
		const rumbleDL = message.reply_message?.id;
		if (!rumbleDL || !rumble.has(rumbleDL)) return;

		const replyContext = rumble.get(rumbleDL);
		if (replyContext.chatId !== message.jid) return;

		const userReply = message.text.trim();
		const mediaUrl = replyContext.options[userReply];
		if (!mediaUrl) {
			const validOptions = Object.keys(replyContext.options).join(', ');
			return message.send(`_Invalid reply. Please choose from: ${validOptions}_`);
		}
		await message.send(`wait...`);
		await message.sendFromUrl(mediaUrl);
		rumble.delete(rumbleDL);
	}
);

import { bot, Button, Carousel, logo } from '#lib';
import {
	RedNoteDL,
	RedditDL,
	TeraBoxDL,
	cleanSpotifyLink,
	detectType,
	downloadSpotify,
	extractUrl,
	fbdown,
	findMediaUrl,
	getBuffer,
	getVideoId,
	likee,
	reelsvideo,
	scdl,
	scrapePinterest,
	searchSoundCloud,
	sfile,
	ssyoutube,
	x2twitterDl
} from '#utils';
import { MAX_MEDIA_MB } from '../lib/resources.js';

const numbers = new Intl.NumberFormat('en-US');

const prefixOf = message => Array.from(message.prefix || '.')[0] || '.';

const clip = (text, max) => {
	const clean = String(text ?? '')
		.replace(/\s+/g, ' ')
		.trim();
	return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
};

// The text of the command, or of the message it replies to
const inputOf = (message, match) => (match || message.reply_message?.text || '').trim();

// The same download does not start twice (a double tap on a button, a command sent twice)
const running = new Set();

// A service that is down, or a link it cannot read, is not a bug: say so instead of sending an error report to the owner.
const job = async (message, name, input, work) => {
	const lock = `${message.jid}:${name}:${input}`;
	if (running.has(lock)) return;
	running.add(lock);
	try {
		await message.react('⏳').catch(() => {});
		return await work();
	} catch (err) {
		if (err?.tooLarge) return message.send(`_That file is too large to send from this host (limit ${MAX_MEDIA_MB} MB)_`);
		console.log(`[${name}]`, err?.message || err);
		return message.send(`_${clip(err?.message || 'Something went wrong, try again', 200)}_`);
	} finally {
		running.delete(lock);
	}
};

// A link, a photo, a video or a sound: it is sent as whatever it turns out to be
const sendMedia = (message, url, caption) => message.sendFromUrl(url, true, caption ? { caption } : {});

// Sends the first of the links that can be sent: a link can be too big for the host, or have gone stale
const sendFirst = async (message, urls, caption) => {
	let failure;
	for (const url of urls.filter(Boolean).slice(0, 3)) {
		try {
			return await sendMedia(message, url, caption);
		} catch (err) {
			failure = err;
		}
	}
	throw failure || new Error('Nothing to send');
};

const usage = (message, text) => message.send(`_${text.replaceAll('{p}', prefixOf(message))}_`);

const hostOf = link => {
	try {
		return new URL(link).hostname.replace(/^www\./, '').toLowerCase();
	} catch {
		return '';
	}
};

// Is the link on one of these sites (or a subdomain of it)?
const onSite = (link, ...sites) => {
	const host = hostOf(link);
	return !!host && sites.some(site => host === site || host.endsWith(`.${site}`));
};

/* ───────────────────────────── Spotify ───────────────────────────── */

bot(
	{ pattern: 'spotify', public: true, desc: 'Download a Spotify song from its link', type: 'download' },
	async (message, match) => {
		const link = cleanSpotifyLink(match) || cleanSpotifyLink(message.reply_message?.text);
		if (!link) return usage(message, 'Send a Spotify track link, eg. {p}spotify https://open.spotify.com/track/...');

		return job(message, 'spotify', link, async () => {
			const song = await downloadSpotify(link);
			const audio = await getBuffer(song.downloadUrl);
			return message.send(audio, {
				type: 'audio',
				mimetype: song.mime || 'audio/mpeg',
				contextInfo: {
					externalAdReply: {
						title: clip(song.title, 60) || 'Spotify',
						body: clip(song.artist, 60) || 'Spotify',
						sourceUrl: link,
						mediaType: 1,
						renderLargerThumbnail: false
					}
				}
			});
		});
	}
);

/* ───────────────────────────── SoundCloud ───────────────────────────── */

const MAX_CARDS = 10;

const trackCardText = track =>
	[
		`🎵 *${clip(track.title, 70)}*`,
		`👤 ${clip(track.artist, 40) || '—'}`,
		`⏱️ ${track.duration || '—'}   ▶️ ${numbers.format(track.plays || 0)} plays`
	].join('\n');

// SoundCloud serves artwork small by default; the bigger one is tried first, the bot's logo is the last resort
const artworkOf = track =>
	[track.artwork?.replace('-large.', '-t500x500.'), track.artwork, logo].filter(Boolean);

const trackCard = (client, track, prefix, picture) =>
	new Button(client)
		.setImage(picture)
		.setBody(trackCardText(track))
		.addReply('DOWNLOAD', `${prefix}soundcloud ${track.url}`);

const uploadTrackCard = async (client, track, prefix) => {
	let failure;
	for (const picture of artworkOf(track)) {
		try {
			return await trackCard(client, track, prefix, picture).toCard();
		} catch (err) {
			failure = err;
		}
	}
	throw failure;
};

const soundcloudAudio = async (message, link) => {
	const song = await scdl(link);
	const audio = await getBuffer(song.download_url);
	const thumbnail = song.thumbnail ? await getBuffer(song.thumbnail).catch(() => undefined) : undefined;
	return message.send(audio, {
		type: 'audio',
		mimetype: song.format === 'mp3' || !song.format ? 'audio/mpeg' : `audio/${song.format}`,
		contextInfo: {
			externalAdReply: {
				title: clip(song.title, 60) || 'SoundCloud',
				body: `${clip(song.uploader, 40)} • ${song.duration}`,
				thumbnail,
				sourceUrl: link,
				mediaType: 1,
				renderLargerThumbnail: false
			}
		}
	});
};

bot(
	{
		pattern: 'soundcloud',
		public: true,
		desc: 'Search SoundCloud (cards with a Download button), or download a track from its link',
		type: 'download'
	},
	async (message, match) => {
		const input = inputOf(message, match);
		if (!input) return usage(message, 'Give me a song to search, or a SoundCloud link, eg. {p}soundcloud lofi beats');

		const prefix = prefixOf(message);
		const link = extractUrl(input);
		if (link && /(^|\.)soundcloud\.com\//i.test(link.replace(/^https?:\/\//i, ''))) {
			return job(message, 'soundcloud', link, () => soundcloudAudio(message, link));
		}

		return job(message, 'soundcloud', input, async () => {
			const res = await searchSoundCloud(input);
			if (!res.success) throw new Error(res.message || 'SoundCloud search failed');
			const tracks = res.results.filter(track => track.url).slice(0, MAX_CARDS);
			if (!tracks.length) return message.send(`_No results found for "${clip(input, 60)}"_`);

			// a carousel needs at least two cards, so a lone result goes out as a single card
			if (tracks.length === 1) return trackCard(message.client, tracks[0], prefix, artworkOf(tracks[0])[0]).send(message.jid);

			const built = await Promise.allSettled(tracks.map(track => uploadTrackCard(message.client, track, prefix)));
			const cards = built.filter(result => result.status === 'fulfilled').map(result => result.value);
			if (cards.length < 2) throw new Error('Could not load the cover pictures, try again');

			return new Carousel(message.client)
				.setBody(`🔎 SoundCloud results for "${clip(input, 60)}"`)
				.setFooter('Tap DOWNLOAD to get the song')
				.addCard(cards)
				.send(message.jid);
		});
	}
);

/* ───────────────────────────── social video links ───────────────────────────── */

bot(
	{ pattern: 'likee', public: true, desc: 'Download a Likee video', type: 'download' },
	async (message, match) => {
		const link = extractUrl(inputOf(message, match));
		if (!link || !onSite(link, 'likee.video', 'likee.com')) return usage(message, 'Send a Likee link, eg. {p}likee https://likee.video/...');

		return job(message, 'likee', link, async () => {
			const res = await likee(link);
			const url = res.without_watermark || res.with_watermark;
			if (!url) throw new Error('Could not find the video in that link');
			return sendMedia(message, url, res.stats ? `_${clip(res.stats, 60)}_` : '');
		});
	}
);

bot(
	{ pattern: 'rednote|xhs', public: true, desc: 'Download a RedNote (Xiaohongshu) post', type: 'download' },
	async (message, match) => {
		const link = extractUrl(inputOf(message, match));
		if (!link) return usage(message, 'Send a RedNote link, eg. {p}rednote https://xhslink.com/...');

		return job(message, 'rednote', link, async () => {
			const res = await RedNoteDL(link);
			if (!res.status || !res.results?.length) throw new Error(res.error || 'Could not find any media in that post');
			const caption = [`*${clip(res.title, 120)}*`, res.author ? `_${clip(res.author, 60)}_` : ''].filter(Boolean).join('\n');

			if (res.type === 'video') return sendMedia(message, res.results[0], caption);
			let first = true;
			for (const url of res.results.slice(0, 10)) {
				await sendMedia(message, url, first ? caption : '');
				first = false;
			}
		});
	}
);

bot(
	{ pattern: 'redvid', public: true, desc: 'Download the photos or videos of a Reddit post', type: 'download' },
	async (message, match) => {
		const link = extractUrl(inputOf(message, match));
		if (!link || !onSite(link, 'reddit.com', 'redd.it')) return usage(message, 'Send a Reddit link, eg. {p}redvid https://www.reddit.com/r/.../comments/...');

		return job(message, 'redvid', link, async () => {
			const res = await RedditDL(link);
			if (!res.status) throw new Error(res.error);
			if (!res.results.length) throw new Error('Could not find any media in that post');

			let first = true;
			for (const item of res.results.slice(0, 5)) {
				await sendMedia(message, item.download_url, first && res.title ? `*${clip(res.title, 150)}*` : '');
				first = false;
			}
		});
	}
);

bot(
	{ pattern: 'fbdown', public: true, desc: 'Download a Facebook video (second source)', type: 'download' },
	async (message, match) => {
		const link = extractUrl(inputOf(message, match));
		if (!link || !onSite(link, 'facebook.com', 'fb.watch', 'fb.com')) return usage(message, 'Send a Facebook video link, eg. {p}fbdown https://www.facebook.com/watch?v=...');

		return job(message, 'fbdown', link, async () => {
			const res = await fbdown(link);
			if (!res.status) throw new Error(res.message || 'Could not get that video');
			const url = findMediaUrl(res, ['hd', 'sd', 'video', 'url', 'download', 'link']);
			if (!url) throw new Error('The service answered without a video link');
			return sendMedia(message, url, '');
		});
	}
);

bot(
	{ pattern: 'reels', public: true, desc: 'Download an Instagram reel or post (second source)', type: 'download' },
	async (message, match) => {
		const link = extractUrl(inputOf(message, match));
		if (!link || !onSite(link, 'instagram.com')) return usage(message, 'Send an Instagram link, eg. {p}reels https://www.instagram.com/reel/...');

		return job(message, 'reels', link, async () => {
			const res = await reelsvideo(link);
			if (!res.videos.length && !res.images.length) throw new Error('Could not find any media in that post');
			const caption = res.username ? `_@${clip(res.username, 40)}_` : '';

			let first = true;
			for (const url of res.videos.slice(0, 3)) {
				await sendMedia(message, url, first ? caption : '');
				first = false;
			}
			for (const url of res.images.slice(0, 10)) {
				await sendMedia(message, url, first ? caption : '');
				first = false;
			}
		});
	}
);

bot(
	{ pattern: 'pindl', public: true, desc: 'Download the photo or video of a Pinterest pin', type: 'download' },
	async (message, match) => {
		const link = extractUrl(inputOf(message, match));
		if (!link || !(onSite(link, 'pin.it') || /(^|\.)pinterest\./i.test(hostOf(link)))) return usage(message, 'Send a Pinterest pin link, eg. {p}pindl https://pin.it/...');

		return job(message, 'pindl', link, async () => {
			const pin = await scrapePinterest(link);
			if (!pin?.media?.length) throw new Error('Could not read that pin');
			const caption = [pin.title ? `*${clip(pin.title, 100)}*` : '', pin.author?.username ? `_@${pin.author.username}_` : '']
				.filter(Boolean)
				.join('\n');

			if (pin.media[0].type === 'video') return sendFirst(message, pin.media.map(item => item.url), caption); // best quality first
			let first = true;
			for (const item of pin.media.slice(0, 10)) {
				await sendMedia(message, item.url, first ? caption : '');
				first = false;
			}
		});
	}
);

// the highest resolution first: "720x1280" -> its area
const areaOf = video => {
	const [width, height] = String(video.resolution).split('x').map(Number);
	return (width || 0) * (height || 0);
};

bot(
	{ pattern: 'x2twitter', public: true, desc: 'Download a video from an X (Twitter) post (second source)', type: 'download' },
	async (message, match) => {
		const link = extractUrl(inputOf(message, match));
		if (!link || !onSite(link, 'x.com', 'twitter.com')) return usage(message, 'Send a post link, eg. {p}x2twitter https://x.com/user/status/...');

		return job(message, 'x2twitter', link, async () => {
			const res = await x2twitterDl(link);
			if (res.error) throw new Error(res.message || 'Could not get that post');
			if (!res.videos.length) throw new Error('That post has no video');

			// a size that is too big for the host is skipped for the next resolution down
			const best = [...res.videos].sort((a, b) => areaOf(b) - areaOf(a));
			return sendFirst(message, best.map(video => video.url), res.metadata?.duration && res.metadata.duration !== '-' ? `_${res.metadata.duration}_` : '');
		});
	}
);

/* ───────────────────────────── files ───────────────────────────── */

// "spotify-premium_9.1.14.864.apk" out of the download link, the page title has no extension
const nameFromLink = (url, fallback) => {
	try {
		const name = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
		return /\.[A-Za-z0-9]{1,6}$/.test(name) ? name : fallback;
	} catch {
		return fallback;
	}
};

bot(
	{ pattern: 'sfile', public: true, desc: 'Download a file from sfile.co / sfile.mobi', type: 'download' },
	async (message, match) => {
		const link = extractUrl(inputOf(message, match));
		if (!link || !onSite(link, 'sfile.co', 'sfile.mobi')) return usage(message, 'Send an sfile link, eg. {p}sfile https://sfile.co/...');

		return job(message, 'sfile', link, async () => {
			const info = await sfile(link);
			const details = [
				`*${clip(info.file_name, 100) || 'File'}*`,
				info.size_from_text ? `📦 ${info.size_from_text}` : '',
				info.author_name ? `👤 ${clip(info.author_name, 40)}` : '',
				info.upload_date ? `📅 ${info.upload_date}` : '',
				info.download_count ? `⬇️ ${info.download_count} downloads` : ''
			]
				.filter(Boolean)
				.join('\n');

			if (!info.download_url) return message.send(`${details}\n\n_Could not get a download link for it_`);
			await message.send(details);
			try {
				const file = await getBuffer(info.download_url);
				return await message.sendFile(file, nameFromLink(info.download_url, info.file_name || 'file'));
			} catch (err) {
				if (!err?.tooLarge) throw err;
				return message.send(`_Too big to send from this host (limit ${MAX_MEDIA_MB} MB). Direct link:_\n${info.download_url}`);
			}
		});
	}
);

const VIDEO_EXTENSIONS = new Set(['mp4', 'mkv', 'mov', 'webm', 'avi', 'm4v']);

// TeraBox has many domains (terabox, 1024terabox, teraboxapp, mirrobox, nephobox, 4funbox ...)
const isTeraBox = link => /tera|mirrobox|nephobox|4funbox|momerybox|tibibox/i.test(hostOf(link));

bot(
	{ pattern: 'terabox', public: true, desc: 'Download a file from a TeraBox link', type: 'download' },
	async (message, match) => {
		const link = extractUrl(inputOf(message, match));
		if (!link || !isTeraBox(link)) return usage(message, 'Send a TeraBox link, eg. {p}terabox https://terabox.com/s/...');

		return job(message, 'terabox', link, async () => {
			const file = await TeraBoxDL(link);
			if (!file.status) throw new Error(file.error || 'Could not read that link');

			const details = [
				`*${clip(file.file_name, 100) || 'File'}*`,
				file.file_size ? `📦 ${file.file_size}` : '',
				file.duration ? `⏱️ ${file.duration}` : ''
			]
				.filter(Boolean)
				.join('\n');
			const links = [file.download_url && `⬇️ ${file.download_url}`, file.stream_url && `▶️ ${file.stream_url}`].filter(Boolean).join('\n');

			const big = Number(file.file_size_bytes) > MAX_MEDIA_MB * 1024 * 1024;
			if (!file.download_url || big) {
				return message.send(`${details}\n\n_${big ? `Too big to send from this host (limit ${MAX_MEDIA_MB} MB)` : 'No direct download'}._\n${links}`);
			}

			await message.send(details);
			try {
				const data = await getBuffer(file.download_url);
				const name = file.file_name || `terabox.${file.extension || 'bin'}`;
				if (VIDEO_EXTENSIONS.has(String(file.extension).toLowerCase())) {
					return await message.send(data, { type: 'video', mimetype: 'video/mp4', caption: clip(name, 100) });
				}
				return await message.sendFile(data, name);
			} catch (err) {
				if (!err?.tooLarge) throw err;
				return message.send(`_Too big to send from this host (limit ${MAX_MEDIA_MB} MB)._\n${links}`);
			}
		});
	}
);

/* ───────────────────────────── YouTube by quality ───────────────────────────── */

bot(
	{
		pattern: 'ssyt',
		public: true,
		desc: 'Download YouTube by quality: ssyt <link> [360|480|720|audio]',
		type: 'download'
	},
	async (message, match) => {
		const words = inputOf(message, match).split(/\s+/).filter(Boolean);
		const option = /^(audio|mp3|\d{3,4})$/i.test(words.at(-1) || '') ? words.pop().toLowerCase() : '360';
		const link = extractUrl(words.join(' '));
		const id = link && getVideoId(link);
		if (!id) return usage(message, 'Send a YouTube link, eg. {p}ssyt https://youtu.be/... 480 (360, 480, 720 or audio)');

		return job(message, 'ssyt', `${id}:${option}`, async () => {
			const res = await ssyoutube(`https://www.youtube.com/watch?v=${id}`);
			if (res.error) throw new Error(res.error);

			const wantAudio = option === 'audio' || option === 'mp3';
			const height = item => Number.parseInt(item.quality, 10) || 0;
			const title = res.meta?.title || 'YouTube';
			let pick;

			if (wantAudio) {
				pick = res.downloads.find(item => item.audio && /^(m4a|mp3)$/i.test(item.format));
			} else {
				const videos = res.downloads.filter(item => !item.audio && /^mp4$/i.test(item.format));
				const wanted = Number(option);
				pick = videos.filter(item => height(item) <= wanted).sort((a, b) => height(b) - height(a))[0] || videos.sort((a, b) => height(a) - height(b))[0];
			}
			if (!pick) throw new Error(`No ${wantAudio ? 'audio' : 'video'} format was offered for that video`);

			const file = await getBuffer(pick.url);
			const kind = (await detectType(file)).mime.split('/')[0];
			if (kind !== (wantAudio ? 'audio' : 'video')) {
				throw new Error(wantAudio ? 'The service did not give an audio file' : `The ${pick.quality}p link did not give a video, try ${prefixOf(message)}ssyt <link> 360`);
			}
			if (wantAudio) {
				return message.send(file, { type: 'audio', mimetype: 'audio/mp4' });
			}
			return message.send(file, { type: 'video', mimetype: 'video/mp4', caption: `${clip(title, 120)}\n_${pick.quality}p_` });
		});
	}
);

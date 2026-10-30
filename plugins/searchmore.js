import { bot, Button, Carousel, logo } from '#lib';
import { GoogleSearch, detectType, getBuffer, tiktokSearchVideo, wallpaperScraper } from '#utils';
import { MAX_MEDIA_MB } from '../lib/resources.js';

const numbers = new Intl.NumberFormat('en-US', { notation: 'compact' });

const prefixOf = message => Array.from(message.prefix || '.')[0] || '.';

const clip = (text, max) => {
	const clean = String(text ?? '')
		.replace(/\s+/g, ' ')
		.trim();
	return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
};

const queryOf = (message, match) => (match || message.reply_message?.text || '').trim();

// A service that is down is not a bug: say so instead of sending an error report to the owner.
const attempt = async (message, work) => {
	try {
		return await work();
	} catch (err) {
		if (err?.tooLarge) return message.send(`_That file is too large to send from this host (limit ${MAX_MEDIA_MB} MB)_`);
		console.log('[search]', err?.message || err);
		return message.send(`_${clip(err?.message || 'Something went wrong, try again', 200)}_`);
	}
};

/* ───────────────────────────── Google News ───────────────────────────── */

const shortDate = text => {
	const date = new Date(text);
	return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

bot(
	{ pattern: 'gnews', public: true, desc: 'Search the news on Google News', type: 'search' },
	async (message, match) =>
		attempt(message, async () => {
			const query = queryOf(message, match);
			if (!query) return message.send(`_What news? eg. ${prefixOf(message)}gnews world cup_`);

			const res = await GoogleSearch(query, { lang: 'en', region: 'US' });
			if (!res.status) throw new Error(res.error || 'The news search failed');
			if (!res.results.length) return message.send(`_No news found for "${clip(query, 60)}"_`);

			const lines = res.results.slice(0, 8).map(item =>
				[
					`${item.index}. *${clip(item.title, 140)}*`,
					[item.source, shortDate(item.published)].filter(Boolean).join(' • '),
					item.link
				]
					.filter(Boolean)
					.join('\n')
			);
			return message.send(`📰 *News for "${clip(query, 60)}"*\n\n${lines.join('\n\n')}`);
		})
);

/* ───────────────────────────── wallpapers ───────────────────────────── */

bot(
	{ pattern: 'wallflare', public: true, desc: 'Search wallpapers on wallpaperflare', type: 'search' },
	async (message, match) =>
		attempt(message, async () => {
			const query = queryOf(message, match);
			if (!query) return message.send(`_What wallpaper? eg. ${prefixOf(message)}wallflare mountain sunrise_`);

			const res = await wallpaperScraper(query);
			if (!res.success) throw new Error(res.message || res.error || 'No wallpapers found');

			let sent = 0;
			for (const wallpaper of res.results.slice(0, 5)) {
				const caption = [clip(wallpaper.title, 100), wallpaper.resolution, wallpaper.page].filter(Boolean).join('\n');
				try {
					await message.sendFromUrl(wallpaper.image, true, { caption });
					sent += 1;
				} catch (err) {
					console.log('[wallflare]', err?.message || err);
				}
			}
			if (!sent) throw new Error('Could not load the wallpapers, try again');
		})
);


/* ───────────────────────────── TikTok search ───────────────────────────── */

const MAX_CARDS = 10;

const videoCardText = video =>
	[
		`🎬 *${clip(video.title, 80) || 'TikTok'}*`,
		`👤 ${clip(video.author.nickname, 40) || '—'}`,
		`▶️ ${numbers.format(video.stats.plays)}   ❤️ ${numbers.format(video.stats.likes)}   💬 ${numbers.format(video.stats.comments)}`
	].join('\n');

const videoCard = (client, video, prefix, picture) =>
	new Button(client)
		.setImage(picture)
		.setBody(videoCardText(video))
		.addReply('VIDEO', `${prefix}ttget ${video.link}`);

const uploadVideoCard = async (client, video, prefix) => {
	let failure;
	for (const picture of [video.cover, video.originCover, logo].filter(Boolean)) {
		try {
			return await videoCard(client, video, prefix, picture).toCard();
		} catch (err) {
			failure = err;
		}
	}
	throw failure;
};

bot(
	{ pattern: 'ttsearch', public: true, desc: 'Search TikTok videos, results come as cards with a Video button', type: 'search' },
	async (message, match) =>
		attempt(message, async () => {
			const query = queryOf(message, match);
			if (!query) return message.send(`_What video? eg. ${prefixOf(message)}ttsearch funny cats_`);

			const prefix = prefixOf(message);
			const videos = (await tiktokSearchVideo(query)).slice(0, MAX_CARDS);
			if (!videos.length) return message.send(`_No videos found for "${clip(query, 60)}"_`);

			// a carousel needs at least two cards, so a lone result goes out as the video itself
			if (videos.length === 1) return message.sendFromUrl(videos[0].link, true, { caption: clip(videos[0].title, 150) });

			const built = await Promise.allSettled(videos.map(video => uploadVideoCard(message.client, video, prefix)));
			const cards = built.filter(result => result.status === 'fulfilled').map(result => result.value);
			if (cards.length < 2) throw new Error('Could not load the video covers, try again');

			return new Carousel(message.client)
				.setBody(`🔎 TikTok results for "${clip(query, 60)}"`)
				.setFooter('Tap VIDEO to get it')
				.addCard(cards)
				.send(message.jid);
		})
);

// what the VIDEO button of a ttsearch card runs
bot(
	{ pattern: 'ttget', public: true, desc: 'Send the video of a ttsearch card', type: 'search', dontAddCommandList: true },
	async (message, match) =>
		attempt(message, async () => {
			const link = (match || '').trim();
			if (!/^https?:\/\/\S+$/i.test(link)) return;
			await message.react('⏳').catch(() => {});
			const video = await getBuffer(link);
			if (!(await detectType(video)).mime.startsWith('video/')) throw new Error('That link did not give a video');
			return message.send(video, { type: 'video', mimetype: 'video/mp4' });
		})
);

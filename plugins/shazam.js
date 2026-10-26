import { bot } from '#lib';
import { identifyAudio, toAudioSample } from '#utils';

// Spotify gives a ready image url, Apple Music a template with {w} and {h}
const coverOf = song =>
	song.spotify?.album?.images?.[0]?.url ||
	song.apple_music?.artwork?.url?.replace('{w}', '600').replace('{h}', '600') ||
	null;

const songText = song =>
	[
		`🎵 *${song.title}*`,
		`👤 ${song.artist}`,
		song.album ? `💿 ${song.album}` : null,
		song.release_date ? `📅 ${song.release_date}` : null,
		song.label ? `🏷️ ${song.label}` : null,
		song.timecode ? `⏱️ Matched at ${song.timecode}` : null,
		'',
		song.song_link ? `🔗 ${song.song_link}` : null,
		song.spotify?.external_urls?.spotify ? `🟢 Spotify: ${song.spotify.external_urls.spotify}` : null,
		song.apple_music?.url ? `🍎 Apple Music: ${song.apple_music.url}` : null
	]
		.filter(line => line !== null)
		.join('\n')
		.trim();

bot(
	{
		pattern: 'shazam',
		public: true,
		desc: 'Find out which song is playing: reply to an audio or a video',
		type: 'tools'
	},
	async message => {
		const quoted = message.reply_message;
		if (!quoted || !(quoted.audio || quoted.video)) {
			return await message.send(`_Reply to an audio or a video with ${message.prefix}shazam_`);
		}

		const status = await message.send('_Listening..._');
		try {
			const media = await message.download();
			// a 30 second mono mp3 is enough to recognise a song, if ffmpeg cannot make one the original goes as it is
			const sample = await toAudioSample(media).catch(() => media);
			const song = await identifyAudio(sample);

			if (!song) {
				return await status.edit('_I could not recognise that song. Try a clearer or a longer part of it._');
			}

			const text = songText(song);
			const cover = coverOf(song);
			if (cover) {
				try {
					await message.client.sendMessage(
						message.jid,
						{ image: { url: cover }, caption: text },
						{ quoted: { key: message.key, message: message.message } }
					);
					return await status.delete();
				} catch {
					// the cover could not be sent, the text alone is still the answer
				}
			}
			return await status.edit(text);
		} catch (err) {
			return await status.edit(`_Shazam failed: ${err?.message || err}_`);
		}
	}
);

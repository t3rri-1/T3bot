import fs from 'fs';
import os from 'os';
import path from 'path';
import { bot } from '#lib';
import { toPTT } from '#utils';
import { config } from '#config';

bot(
	{
		pattern: 'upch|uploadch',
		public: false,
		desc: 'Post text, or a quoted image/video/audio, to a WhatsApp channel',
		type: 'tools'
	},
	async (message, match) => {
		const args = (match || '').trim().split(/\s+/).filter(Boolean);
		const chId = args[0]?.includes('@newsletter') ? args.shift() : config.CHANNEL_JID;
		const caption = args.join(' ').trim();

		if (!chId) {
			return message.send(
				`_No channel configured. Either set CHANNEL_JID in your .env, or run:_\n${message.prefix}upch 12345xxx@newsletter <text>`
			);
		}

		const quoted = message.reply_message;
		const isImage = quoted?.image;
		const isVideo = quoted?.video;
		const isAudio = quoted?.audio;
		const isMedia = isImage || isVideo || isAudio;

		if (!isMedia && !caption) {
			return message.send(
				`📤 *UPLOAD TO CHANNEL*\n\nSend/reply media with a caption:\n${message.prefix}upch [channelJid] <optional text>\n\nSupports: 🖼️ image, 🎥 video, 🎵 audio/VN, 📝 text only`
			);
		}

		await message.react('🕕');

		try {
			if (!isMedia && caption) {
				await message.client.sendMessage(chId, { text: caption });
				await message.react('✅');
				return message.send('_Text sent to the channel._');
			}

			const mediaBuf = await message.download();
			if (!mediaBuf || mediaBuf.length < 1000) throw new Error('Media too small or failed to download');

			if (isImage) {
				await message.client.sendMessage(chId, { image: mediaBuf, caption: caption || undefined });
				await message.react('✅');
				return message.send('_Image sent to the channel._');
			}

			if (isVideo) {
				await message.client.sendMessage(chId, { video: mediaBuf, caption: caption || undefined });
				await message.react('✅');
				return message.send('_Video sent to the channel._');
			}

			if (isAudio) {
				const tmpIn = path.join(os.tmpdir(), `upch_in_${Date.now()}`);
				await fs.promises.writeFile(tmpIn, mediaBuf);
				let opusBuf;
				try {
					opusBuf = await toPTT(tmpIn);
				} finally {
					fs.promises.unlink(tmpIn).catch(() => {});
				}
				if (!opusBuf || opusBuf.length < 5000) throw new Error('Audio conversion failed');

				await message.client.sendMessage(chId, { audio: opusBuf, mimetype: 'audio/ogg; codecs=opus', ptt: true });
				await message.react('✅');
				return message.send('_Audio sent to the channel._');
			}

			return message.send('_Unsupported media type._');
		} catch (err) {
			await message.react('☢️');
			return message.send(`_Upload failed: ${err?.message || err}_`);
		}
	}
);

import { bot } from '#lib';
import { isJidGroup } from 'baileys';

bot(
	{
		pattern: 'tostatus',
		public: false,
		desc: 'Post text, or a quoted image/video/audio, to your WhatsApp Status',
		type: 'tools'
	},
	async (message, match) => {
		await message.react('📤');

		const quoted = message.reply_message;
		const textInput = (match || '').trim();

		let statusJidList = [];
		if (isJidGroup(message.jid)) {
			try {
				const groupMetadata = await message.client.groupMetadata(message.jid);
				statusJidList = groupMetadata.participants.map(p => p.id);
			} catch {
				// if metadata fails just fall back to the default (empty) audience
			}
		}

		const statusOptions = { statusJidList, backgroundColor: '#25D366', font: 2 };

		try {
			if (quoted && (quoted.image || quoted.video || quoted.audio)) {
				const mediaBuffer = await message.download();
				if (!mediaBuffer?.length) throw new Error('Could not download media');

				if (quoted.image) {
					await message.client.sendMessage('status@broadcast', { image: mediaBuffer, caption: textInput }, statusOptions);
				} else if (quoted.video) {
					await message.client.sendMessage('status@broadcast', { video: mediaBuffer, caption: textInput }, statusOptions);
				} else {
					const audioNode = quoted.message?.audioMessage;
					await message.client.sendMessage(
						'status@broadcast',
						{ audio: mediaBuffer, mimetype: audioNode?.mimetype || 'audio/ogg; codecs=opus', ptt: audioNode?.ptt || false },
						{ ...statusOptions, backgroundColor: '#000000' }
					);
				}

				const mediaType = quoted.image ? '🖼️ Image' : quoted.video ? '📹 Video' : '🎵 Audio';
				return message.send(`_Posted to status._\nType: ${mediaType}\nAudience: ${statusJidList.length || 'All'}`);
			}

			if (!textInput && quoted?.text) {
				await message.client.sendMessage('status@broadcast', { text: quoted.text }, statusOptions);
				return message.send(`_Posted to status._\nType: 📝 Text\nAudience: ${statusJidList.length || 'All'}`);
			}

			if (!textInput) {
				return message.send(`_Usage: ${message.prefix}tostatus <text>, or reply to an image/video/audio._`);
			}

			await message.client.sendMessage('status@broadcast', { text: textInput }, statusOptions);
			return message.send(`_Posted to status._\nType: 📝 Text\nAudience: ${statusJidList.length || 'All'}`);
		} catch (err) {
			return message.send(`_Status post failed: ${err?.message || err}_`);
		}
	}
);

bot(
	{
		pattern: 'save',
		public: true,
		desc: 'Save a quoted status (image/video) into this chat',
		type: 'tools'
	},
	async message => {
		const quoted = message.reply_message;
		if (!quoted) return message.send('_Reply to a status to save it._');
		if (!quoted.isStatus) return message.send('_You did not tag a status media to save._');
		if (!quoted.image && !quoted.video) return message.send('_Only image or video statuses can be saved._');

		const buffer = await message.download();
		return message.send(buffer, { type: quoted.image ? 'image' : 'video', caption: quoted.text || '' });
	}
);

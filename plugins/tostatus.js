import { bot, postStatus, toStatusAudio } from '#lib';
import { isJidGroup } from 'baileys';

const STATUS_STYLE = { backgroundColor: '#25D366', font: 2 };

bot(
	{
		pattern: 'tostatus',
		public: false,
		desc: 'Post text, or a quoted image/video/audio, to your WhatsApp Status',
		type: 'tools'
	},
	async (message, match) => {
		const quoted = message.reply_message;
		const textInput = (match || '').trim();
		const hasMedia = quoted && (quoted.image || quoted.video || quoted.audio);
		if (!hasMedia && !textInput && !quoted?.text) {
			return message.send(`_Usage: ${message.prefix}tostatus <text>, or reply to an image/video/audio._`);
		}

		await message.react('📤');
		try {
			// what to post, worked out first so a failure here never looks like a post
			let content;
			let options = {};
			let label;
			if (hasMedia) {
				const mediaBuffer = await message.download();
				if (!mediaBuffer?.length) throw new Error('Could not download media');
				if (quoted.image) {
					content = { image: mediaBuffer, caption: textInput };
					label = '🖼️ Image';
				} else if (quoted.video) {
					content = { video: mediaBuffer, caption: textInput };
					label = '📹 Video';
				} else {
					content = await toStatusAudio(mediaBuffer, quoted.message?.audioMessage);
					label = '🎵 Audio';
				}
			} else {
				content = { text: textInput || quoted.text };
				options = STATUS_STYLE;
				label = '📝 Text';
			}

			// inside a group the status goes to that group's members, anywhere else to everyone the bot knows
			let members = [];
			if (isJidGroup(message.jid)) {
				const meta = await message.client.groupMetadata(message.jid).catch(() => null);
				if (!meta?.participants?.length) throw new Error("Could not read this group's members, try again");
				members = meta.participants.map(p => message.client.participantJid(p));
			}

			const { audience, confirmed } = await postStatus(message.client, content, options, { members, chat: message.jid });

			const people = members.length
				? `${audience} people (this group's members)`
				: audience > 1
					? `${audience} people`
					: 'only you, the bot has not seen any other contacts yet';
			const details = `Type: ${label}\nAudience: ${people}`;
			return message.send(
				confirmed
					? `_Posted to your status._\n${details}`
					: `_Sent to your status, but WhatsApp has not confirmed it yet._\n${details}\n_Check your status in a minute and send it again if it is missing._`
			);
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

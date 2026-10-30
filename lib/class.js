import fs from 'fs';
import os from 'os';
import path from 'path';
import { detectType, FileTypeFromBuffer, getBuffer, getMimeType, detectMessageType } from '#utils';
import {
	getContentType,
	generateForwardMessageContent,
	generateWAMessageFromContent,
	downloadMediaMessage,
	generateMessageID
} from 'baileys';
import { isUrl, toJid } from '#utils';
import { applyFont } from '../bot/fontlist.js';
import { MAX_MEDIA_MB } from './resources.js';
import { useClient, sendRich } from './rich.js';
import { getConfig } from '../sql/config.js';

// The card every message of the bot quotes, unless a real `quoted` message is passed in opts.
const verifiedQuote = () => ({
	key: {
		fromMe: false,
		participant: '0@s.whatsapp.net',
		remoteJid: '0@s.whatsapp.net',
		id: generateMessageID()
	},
	message: {
		extendedTextMessage: {
			text: 'T3rri Verified'
		}
	}
});

// What Baileys reads from the third argument of sendMessage. send, sendFile and sendFromUrl all build it here,
// so a message goes out the same way whichever one sent it: with the `quoted` that was given, or the verified card.
const OPTION_KEYS = [
	'quoted',
	'messageId',
	'ephemeralExpiration',
	'statusJidList',
	'additionalNodes',
	'additionalAttributes',
	'broadcast',
	'timestamp',
	'useCachedGroupMetadata'
];

const sendOptions = (opts = {}) => {
	const options = { quoted: opts.quoted ?? verifiedQuote() };
	for (const key of OPTION_KEYS) if (key !== 'quoted' && opts[key] !== undefined) options[key] = opts[key];
	return options;
};

// opts without the keys that belong to the options argument, what is left is message content
const contentOf = (opts = {}) => {
	const content = { ...opts };
	for (const key of OPTION_KEYS) delete content[key];
	return content;
};

class Message {
	constructor(client, data) {
		useClient(client); // lets `new Button()` / `new AIRich()` find the socket without being handed it
		Object.defineProperties(this, {
			client: { value: client, writable: true, configurable: true },
			data: { value: data, writable: true, configurable: true },
			sendMessage: { value: data?.send, writable: true, configurable: true }
		});
		if (data) this._events(data);
	}

	_events(data) {
		const {
			key,
			isGroup,
			pushName,
			prefix,
			sender,
			messageTimestamp,
			body,
			message,
			quoted,
			mention,
			isAdmin,
			isBotAdmin,
			send,
			type
		} = data;
		this.data = data;
		this.key = key;
		this.id = key.id;
		this.jid = key.remoteJid;
		this.isAdmin = isAdmin;
		this.isBotAdmin = isBotAdmin;
		this.isGroup = isGroup;
		this.fromMe = key.fromMe;
		this.pushName = pushName;
		this.message = message;
		this.prefix = prefix;
		this.sender = sender;
		this.mtype = data.type;
		this.user = toJid(this.client.user.id);
		this.timestamp = messageTimestamp?.low || messageTimestamp || Date.now();
		this.text = body || '';
		this.bot = /^(BAE5|3EB0)/.test(key.id);
		this.mention = mention;
		this.sendMessage = send;

		this.reply_message = data?.quoted
			? {
					id: quoted.key.id,
					fromMe: quoted.key?.fromMe,
					sender: quoted.sender || toJid(quoted.key?.participant || quoted.key?.remoteJid),
					key: quoted.key,
					bot: /^(BAE5|3EB0)/.test(quoted.key.id),
					message: quoted?.message,
					text: quoted.body,
					image: quoted?.type === 'imageMessage',
					video: quoted?.type === 'videoMessage',
					audio: quoted?.type === 'audioMessage',
					sticker: quoted?.type === 'stickerMessage',
					document: quoted?.type === 'documentMessage',
					viewonce: quoted?.viewonce,
					isStatus: !!quoted?.isStatus
			  }
			: false;
	}

	async isUserAdmin() {
		if (!this.isAdmin) {
			await this.send('```You are not an Admin```');
			return false;
		}
		if (!this.isBotAdmin) {
			await this.send('```Make me an Admin```');
			return false;
		}
		return true;
	}

	async edit(content) {
		const msg = await this.client.sendMessage(this.jid, {
			text: content,
			edit: this.reply_message?.key || this.key
		});
		return new Message(this.client, msg);
	}

	async react(emoji, opts = {}) {
		const msg = await this.client.sendMessage(this.jid, {
			react: { text: emoji, key: opts.key || this.key }
		});
		return new Message(this.client, msg);
	}

	async delete() {
		const msg = await this.client.sendMessage(this.jid, {
			delete: this.reply_message?.key || this.key
		});
		return new Message(this.client, msg);
	}

	async clearChat() {
		const msg = await this.client.chatModify(
			{
				delete: true,
				lastMessages: [
					{
						key: this.key,
						messageTimestamp: this.timestamp
					}
				]
			},
			this.jid
		);
		return new Message(this.client, msg);
	}

	async archiveChat(opts = true) {
		const lstMsg = {
			message: this.message,
			key: this.key,
			messageTimestamp: this.timestamp
		};
		const msg = await this.client.chatModify(
			{
				archive: opts,
				lastMessages: [lstMsg]
			},
			this.jid
		);
		return new Message(this.client, msg);
	}

	async updateName(name) {
		return await this.client.updateProfileName(this.user, name);
	}

	async updatePP(imageBuffer) {
		return await this.client.updateProfilePicture(this.user, imageBuffer);
	}

	async rPP() {
		return await this.client.removeProfilePicture(this.user);
	}

	async Block(jid) {
		this.send(`_@${jid.split('@')[0]} Blocked_`, { mentions: [jid] });
		return await this.client.updateBlockStatus(jid, 'block');
	}

	async Unblock(jid) {
		this.send(`_@${jid.split('@')[0]} Unblocked_`, { mentions: [jid] });
		return await this.client.updateBlockStatus(jid, 'unblock');
	}

	async getUserJid(match) {
		let jid;
		if (!match && !this.isGroup) {
			jid = this.data.chat || this.data.key.remoteJid || this.reply_message?.sender;
		} else if (!match && this.isGroup) {
			jid = this.reply_message?.sender || this.mention[0];
		} else {
			jid = toJid(match);
		}
		if (!jid) return this.send('```Reply Or Tag User```');
		return jid;
	}

	async getProfileImage(jid) {
		const picture = await this.client.profilePictureUrl(jid, 'image');
		const buffer = await getBuffer(picture);
		return buffer || '_No Profile Photo_';
	}

	async send(content, opts = {}) {
		const jid = opts.jid || this.jid;
		let type = opts.type;
		if (!type) {
			// If content is a URL, we need to fetch and detect
			if (typeof content === 'string' && (content.startsWith('http://') || content.startsWith('https://'))) {
				try {
					const buffer = await getBuffer(content);
					const detected = await detectType(buffer);
					type = detected.mime.startsWith('image/') ? 'image' :
						   detected.mime.startsWith('video/') ? 'video' :
						   detected.mime.startsWith('audio/') ? 'audio' :
						   detected.ext === 'webp' ? 'sticker' : 'document';
				} catch {
					type = 'text';
				}
			} else {
				// For non-URL content, detect properly
				type = await detectMessageType(content);
			}
		}
		
		const mentions = opts.mentions || [];
		const contextInfo = opts.contextInfo || {};

		if (type === 'text' && typeof content === 'string' && content) {
			try {
				const { fontStyle } = await getConfig();
				if (fontStyle && fontStyle !== 1) content = applyFont(content, fontStyle);
			} catch {
				// if the font lookup fails for any reason, just send the plain text
			}
		}
		
		// For media types, ensure content is a Buffer
		let mediaContent = content;
		if (['image', 'video', 'audio', 'sticker', 'document'].includes(type)) {
			if (typeof content === 'string' && (content.startsWith('http://') || content.startsWith('https://'))) {
				mediaContent = await getBuffer(content);
			} else if (typeof content === 'string' && content.startsWith('data:')) {
				const base64Data = content.split(',')[1];
				mediaContent = Buffer.from(base64Data, 'base64');
			} else if (typeof content === 'string' && !Buffer.isBuffer(content)) {
				// Try to convert string to buffer for media
				try {
					mediaContent = Buffer.from(content, 'base64');
				} catch {
					// If it's not base64, treat as text
					type = 'text';
					mediaContent = content;
				}
			}
		}
		
		const msg = await this.client.sendMessage(
			jid,
			{ [type]: mediaContent, contextInfo: { mentionedJid: mentions, ...contextInfo }, ...contentOf(opts) },
			sendOptions(opts)
		);
		return new Message(this.client, msg);
	}

	async sendFile(file, fileName, caption, opts = {}) {
		if (isUrl(file)) file = await getBuffer(file);
		if (Buffer.isBuffer(file)) file = Buffer.from(file);
		const mime = await getMimeType(file);
		const data = await this.client.sendMessage(
			this.jid,
			{
				document: file,
				mimetype: mime,
				fileName: fileName || 'Terri Verified',
				caption: caption,
				...contentOf(opts)
			},
			sendOptions(opts)
		);
		return new Message(this.client, data);
	}

	/**
	 * One Meta-AI-looking message from markdown: text, code blocks, tables, links (with source chips) and
	 * follow-up pills. In groups it quotes the message it answers, like the chatbot does.
	 *   await message.sendRich('**Hi** there', { suggestions: ['Tell me more'] });
	 */
	async sendRich(markdown, opts = {}) {
		const { jid, quoted, ...rest } = opts;
		const to = jid || this.jid;
		const replyTo = quoted === undefined && this.isGroup && !jid ? { key: this.key, message: this.message } : quoted;
		const sent = await sendRich(this.client, to, markdown, { ...rest, quoted: replyTo });
		return new Message(this.client, sent);
	}

	async sendFromUrl(url, auto = true, opts = {}) {
		if (!isUrl(url)) throw new Error('Invalid URL');
		let buffer;
		if (auto) {
			buffer = await getBuffer(url);
			// detectType gives { ext, mime }, the message type (image, video, audio, sticker, document) comes from detectMessageType
			const detected = await detectType(buffer);
			const kind = await detectMessageType(buffer);
			const name = opts.fileName || 'Terri Verified';
			const content =
				kind === 'document'
					? { document: buffer, mimetype: detected.mime, fileName: name.includes('.') ? name : `${name}.${detected.ext}` }
					: kind === 'audio'
						? { audio: buffer, mimetype: detected.mime }
						: { [kind]: buffer };
			const data = await this.client.sendMessage(
				this.jid,
				{ ...content, ...contentOf(opts) },
				sendOptions(opts)
			);
			return new Message(this.client, data);
		} else {
			const sendType = ['text', 'image', 'sticker', 'video', 'document'];
			if (!opts.type || !sendType.includes(opts.type))
				throw Error('No valid content type specified');
			buffer = await getBuffer(url);
			const data = await this.client.sendMessage(
				this.jid,
				{ [opts.type]: buffer, ...contentOf(opts) },
				sendOptions(opts)
			);
			return new Message(this.client, data);
		}
	}

	async forward(jid, content, options = {}) {
		const forwardContent = generateForwardMessageContent(content, options.force);
		const contentType = getContentType(forwardContent);

		const forwardOptions = {
			...options,
			contextInfo: {
				...(options.contextInfo || {}),
				...(options.mentions ? { mentionedJid: options.mentions } : {}),
				...forwardContent[contentType]?.contextInfo
			}
		};

		const waMessage = generateWAMessageFromContent(jid, forwardContent, forwardOptions);
		return this.client.relayMessage(jid, waMessage.message, {
			messageId: waMessage.key.id
		});
	}

	async download(file = false) {
		// the whole file ends up in memory (and gets copied while it is decoded), so refuse what the host cannot hold
		const quotedContent = this.data?.quoted?.message;
		const declared = quotedContent?.[getContentType(quotedContent)]?.fileLength;
		const bytes =
			declared && typeof declared === 'object' ? (declared.low ?? 0) + (declared.high ?? 0) * 2 ** 32 : Number(declared);
		if (bytes > MAX_MEDIA_MB * 1024 * 1024) {
			throw new Error(`File is too large for this host (limit ${MAX_MEDIA_MB} MB)`);
		}
		const buffer = await downloadMediaMessage(
			{
				key: this.data.quoted.key,
				message: this.data?.quoted?.message
			},
			'buffer',
			{},
			{
				logger: console,
				reuploadRequest: this.client.updateMediaMessage
			}
		);
		if (file) {
			const extension = await FileTypeFromBuffer(buffer);
			const filename = `${Date.now()}.${extension}`;
			const filepath = path.join(os.tmpdir(), filename);
			await fs.promises.writeFile(filepath, buffer);
			return filepath;
		}
		return buffer;
	}
}

export default Message;
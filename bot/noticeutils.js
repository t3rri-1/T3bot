/**
 * What the anti-delete, anti-edit and anti-status notices have in common: the "ad reply" card, names and pictures,
 * reading a stored message, and sending one again. Not a feature of its own, so it is not exported from bot/index.js.
 */
import { generateWAMessageFromContent, getContentType, normalizeMessageContent } from 'baileys';
import { getConfig } from '#sql';
import { applyFont } from './fontlist.js';

const SOURCE_URL = 'https://www.youtube.com/@Terrizev';
const FALLBACK_AVATAR = 'https://i.ibb.co/2kR6bDq/avatar-contact.png';
const AVATAR_TIMEOUT_MS = 5000;

export const TEXT_TYPES = new Set(['conversation', 'extendedTextMessage']);

const withTimeout = (promise, ms) =>
	Promise.race([
		promise,
		new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms).unref?.())
	]);

// the sender's profile picture, or a default one (no picture, hidden by privacy settings, or too slow)
export const profilePicture = async (conn, jid) => {
	try {
		return (await withTimeout(conn.profilePictureUrl(jid, 'image'), AVATAR_TIMEOUT_MS)) || FALLBACK_AVATAR;
	} catch {
		return FALLBACK_AVATAR;
	}
};

export const adReply = (title, body, thumbnailUrl) => ({
	title,
	body,
	thumbnailUrl,
	sourceUrl: SOURCE_URL,
	mediaType: 1,
	renderLargerThumbnail: false
});

export const displayName = async (conn, jid) => {
	try {
		return (await conn.getName(jid)) || jid.split('@')[0];
	} catch {
		return String(jid || '').split('@')[0];
	}
};

export const resolve = async (conn, jid, alt) => {
	if (!jid) return jid;
	try {
		return await conn.resolveJid(jid, alt);
	} catch {
		return jid;
	}
};

// the bot's own wording follows the .font setting (these notices go through the socket, not Message.send)
export const fontStyler = async () => {
	let fontStyle = 1;
	try {
		({ fontStyle } = await getConfig());
	} catch {
		// no config available, send plain text
	}
	return text => (fontStyle && fontStyle !== 1 ? applyFont(text, fontStyle) : text);
};

export const typeOf = stored => stored.type || getContentType(stored.message);

// the text of a message, or the caption of a photo / video / document
export const textOf = content => {
	const message = normalizeMessageContent(content);
	if (!message) return '';
	const inner = message[getContentType(message)];
	if (typeof inner === 'string') return inner;
	return inner?.text || inner?.caption || '';
};

// A messages.update that says a message was deleted (for everyone)
export const isDeletion = update => !!update?.key && !!(update.update?.deleteMessage || update.update?.message === null);

/**
 * Sends a stored message (photo, video, voice note, sticker, document...) again as it was, with `contextInfo` swapped
 * for the ad-reply card. The media is relayed, nothing is downloaded.
 * @param {{quote?: boolean}} [options] - quote: show the original as quoted (default), a status is better left unquoted
 */
export const resend = async (conn, target, original, contextInfo, { quote = true } = {}) => {
	const content = JSON.parse(JSON.stringify(original.message));
	const type = content[typeOf(original)] ? typeOf(original) : getContentType(content);
	if (!type || !content[type] || typeof content[type] !== 'object') throw new Error('nothing to resend');

	delete content[type].viewOnce; // a deleted view-once is kept as a normal photo / video
	content[type].contextInfo = contextInfo;

	const message = generateWAMessageFromContent(target, content, {
		...(quote ? { quoted: original } : {}),
		userJid: conn.user.id
	});
	await conn.relayMessage(target, message.message, { messageId: message.key.id });
};

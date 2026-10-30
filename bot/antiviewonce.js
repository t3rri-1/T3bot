import { getSettings, getVv2, isSudo, loadMessage } from '#sql';
import { downloadMediaMessage, isJidGroup, jidNormalizedUser } from 'baileys';
import { MAX_MEDIA_MB } from '../lib/resources.js';

export async function AntiViewOnce(msg) {
	if (!msg.viewonce) return;

	const settings = await getSettings();
	if (!settings.isEnabled) return;

	const isGroup = isJidGroup(msg.from);
	if (settings.type === 'gc' && !isGroup) return;
	if (settings.type === 'dm' && isGroup) return;

	const modifiedMessage = JSON.parse(JSON.stringify(msg.message));
	const messageType = Object.keys(modifiedMessage)[0];

	if (modifiedMessage[messageType]) {
		delete modifiedMessage[messageType].viewOnce;
		modifiedMessage[messageType].contextInfo = {
			stanzaId: msg.key.id,
			participant: msg.sender,
			quotedMessage: msg.message,
		};
	}

	await msg.client.relayMessage(msg.from, modifiedMessage, {});
}

/**
 * vv2: a view-once message goes to your inbox as a normal photo / video / voice note, either when you react to it
 * with any emoji (ViewOnceReact, switched with `vv2 on` / `vv2 off`) or when you reply to it with `vv2`.
 * Works for the owner and for sudo users, who each get it in their own chat with the bot.
 *
 * The media has to still be on WhatsApp's servers, so do it before the view-once is opened.
 */
const KINDS = { imageMessage: 'image', videoMessage: 'video', audioMessage: 'audio' };
const saved = new Map(); // "inbox:message id" -> time, so a reaction WhatsApp delivers twice sends once

const bytesOf = length =>
	length && typeof length === 'object' ? (length.low ?? 0) + (length.high ?? 0) * 2 ** 32 : Number(length) || 0;

/**
 * The view-once photo / video / voice note inside a stored message (as the bot saved it), or null.
 * @param {object} stored
 */
export function viewOnceOf(stored) {
	const type = stored?.type;
	const media = stored?.message?.[type];
	if (!media || !KINDS[type] || !(stored.viewonce || media.viewOnce)) return null;
	return { type, media, kind: KINDS[type] };
}

/**
 * Downloads a stored view-once message and sends it to `inbox` as a normal photo / video / voice note.
 * @param {object} conn
 * @param {object} stored - the message as the bot saved it
 * @param {string} inbox - the chat to send it to
 * @param {(text: string) => Promise<any>} [tell] - where problems are reported, the inbox by default
 * @returns {Promise<'sent'|'none'|'toolarge'|'failed'>}
 */
export async function sendViewOnceTo(conn, stored, inbox, tell = text => conn.sendMessage(inbox, { text })) {
	const found = viewOnceOf(stored);
	if (!found) return 'none';
	const { media, kind } = found;

	if (bytesOf(media.fileLength) > MAX_MEDIA_MB * 1024 * 1024) {
		await tell(`_That view-once is over this host's ${MAX_MEDIA_MB} MB media limit._`);
		return 'toolarge';
	}

	let buffer;
	try {
		buffer = await downloadMediaMessage(
			{ key: stored.key, message: stored.message },
			'buffer',
			{},
			{ logger: console, reuploadRequest: conn.updateMediaMessage }
		);
	} catch (err) {
		console.log('[viewonce] download failed:', err?.message || err);
		await tell('_Could not get that view-once, it was probably opened already or has expired._');
		return 'failed';
	}

	const content = { [kind]: buffer };
	if (media.caption) content.caption = media.caption;
	if (kind === 'video' && media.gifPlayback) content.gifPlayback = true;
	if (kind === 'audio') {
		content.mimetype = media.mimetype || 'audio/ogg; codecs=opus';
		content.ptt = !!media.ptt;
	}
	await conn.sendMessage(inbox, content);
	return 'sent';
}

export async function ViewOnceReact(msg) {
	try {
		const reaction = msg.message?.reactionMessage;
		const targetId = reaction?.key?.id;
		if (!targetId || !reaction.text) return; // empty text: the reaction was taken back

		const conn = msg.client;
		if (!msg.key.fromMe && !(await isSudo(msg.sender, msg.user))) return;
		if (!(await getVv2())) return; // switched off with `vv2 off`

		const stored = (await loadMessage(targetId))?.message;
		if (!viewOnceOf(stored)) return;

		// the bot's own inbox when the owner reacts, the sudo user's chat with the bot otherwise
		const inbox = msg.key.fromMe ? jidNormalizedUser(conn.user.id) : msg.sender;
		const stamp = `${inbox}:${targetId}`;
		if (saved.has(stamp)) return;
		saved.set(stamp, Date.now());
		if (saved.size > 200) saved.delete(saved.keys().next().value);

		const result = await sendViewOnceTo(conn, stored, inbox);
		if (result === 'failed') saved.delete(stamp); // let a second reaction try again
	} catch (err) {
		console.log('[viewonce-react]', err?.message || err);
	}
}

/**
 * Posting to WhatsApp Status and to a group's status.
 *
 * A Status is not sent "to everyone": the sender lists the people who get it (statusJidList). With an
 * empty list WhatsApp accepts the message and delivers it to nobody, which is what made `tostatus` report
 * a post that never showed up. getStatusAudience() always builds a real list, and everything here goes
 * through lib/ack.js so "posted" means WhatsApp acknowledged it.
 *
 * Optional env var
 *   STATUS_AUDIENCE_MAX  most people a status is sent to (default 1000, every extra person costs memory and time)
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateWAMessageContent, generateWAMessageFromContent, isLidUser, isPnUser, jidNormalizedUser } from 'baileys';
import { sendConfirmed, sendWithAck } from './ack.js';

const AUDIENCE_MAX = Math.max(10, Number(process.env.STATUS_AUDIENCE_MAX) || 1000);

const BACKGROUNDS = ['#0e0e0e', '#b84fce', '#2a52be', '#0f8a5f', '#c9184a', '#614085', '#075e54', '#d4a017'];
const FONTS = [1, 2, 6, 7, 8, 9, 10]; // the text status fonts WhatsApp knows (0 is the plain default)
const pick = list => list[Math.floor(Math.random() * list.length)];

/** A random background colour and font for a text status. */
export const statusStyle = () => ({ backgroundColor: pick(BACKGROUNDS), font: pick(FONTS) });

const argb = hex => parseInt(`FF${String(hex).replace('#', '').padStart(6, '0')}`, 16);

/* ───────────────────────────── who sees a status ───────────────────────────── */

// only real people can be in the list: no groups, broadcasts, channels, or the placeholder number
const audienceJid = (client, jid) => {
	if (!jid || typeof jid !== 'string') return null;
	let id;
	try {
		id = jidNormalizedUser(client.getJid ? client.getJid(jid) : jid);
	} catch {
		return null;
	}
	return id && !id.startsWith('0@') && (isPnUser(id) || isLidUser(id)) ? id : null;
};

// everyone the bot has talked to: recent private chats first, then everybody it has ever seen a message from
const storedJids = async () => {
	const { contactDb, messageDb } = await import('../sql/store.js');
	const [chats, contacts] = await Promise.all([
		messageDb.findAll({ attributes: ['jid'], group: ['jid'], raw: true }),
		contactDb.findAll({ attributes: ['jid'], raw: true })
	]);
	return [...chats, ...contacts].map(row => row.jid);
};

/**
 * The people a status is sent to. Always includes the bot's own number (that is what puts the post in
 * "My status" on the phone).
 *   members  a group's members: when given, the status goes to them only
 *   chat     the chat the command ran in (kept when it is a private chat)
 *   known    where to find everyone else, replaceable for tests
 */
export const getStatusAudience = async (client, { members = [], chat, known = storedJids } = {}) => {
	const audience = new Set();
	const add = jid => {
		const id = audienceJid(client, jid);
		if (id) audience.add(id);
	};

	add(client.user?.id);
	members.forEach(add);
	add(chat);
	if (!members.length && known) {
		try {
			(await known()).forEach(add);
		} catch {
			/* nothing stored yet, the list is still valid */
		}
	}
	return [...audience].slice(0, AUDIENCE_MAX);
};

/**
 * Post to the bot's own Status. content/options are what sendMessage takes (backgroundColor and font go in options).
 * Resolves { audience, confirmed }; throws when WhatsApp refuses it.
 */
export const postStatus = async (client, content, options = {}, scope = {}) => {
	const audience = await getStatusAudience(client, scope);
	const { confirmed } = await sendConfirmed(client, 'status@broadcast', content, { ...options, statusJidList: audience });
	return { audience: audience.length, confirmed };
};

/* ───────────────────────────── audio ───────────────────────────── */

/** Statuses only take voice notes, so anything else is converted to one (opus, like WhatsApp records them). */
export const toStatusAudio = async (buffer, node) => {
	if (node?.ptt) return { audio: buffer, mimetype: node.mimetype || 'audio/ogg; codecs=opus', ptt: true };

	const { toPTT } = await import('#utils');
	const file = path.join(os.tmpdir(), `status_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`);
	await fs.promises.writeFile(file, buffer);
	try {
		const opus = await toPTT(file);
		if (!opus || opus.length < 1000) throw new Error('could not turn that audio into a voice note');
		return { audio: opus, mimetype: 'audio/ogg; codecs=opus', ptt: true };
	} finally {
		fs.promises.unlink(file).catch(() => {});
	}
};

/* ───────────────────────────── group status ───────────────────────────── */

/**
 * Post a status inside a group (the "group status" feature, groupStatusMessageV2).
 *   built  { payload, style }: payload is what sendMessage takes, style is { backgroundColor, font } for text
 * Resolves { confirmed }; throws when the content cannot be prepared or WhatsApp refuses it.
 * There is deliberately no fallback to a different post: a failed image must not turn into a "(status)" text.
 */
export const postGroupStatus = async (client, groupJid, { payload, style = {} }) => {
	const content = await generateWAMessageContent(payload, { upload: client.waUploadToServer, ...style });

	// the text styling has to be on the message itself, make sure it is even if Baileys left it out
	const text = content.extendedTextMessage;
	if (text && style.backgroundColor && !text.backgroundArgb) {
		text.backgroundArgb = argb(style.backgroundColor);
		text.textArgb = 0xffffffff;
		if (style.font) text.font = style.font;
	}

	const messageSecret = crypto.randomBytes(32);
	const message = generateWAMessageFromContent(
		groupJid,
		{
			messageContextInfo: { messageSecret },
			groupStatusMessageV2: { message: { ...content, messageContextInfo: { messageSecret } } }
		},
		{ userJid: client.user.id }
	);

	const { confirmed } = await sendWithAck(client, message.key.id, id => client.relayMessage(groupJid, message.message, { messageId: id }));
	return { confirmed };
};

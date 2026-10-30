/**
 * Anti-status: when a contact deletes a status, it is sent to the bot's own inbox as it was (the text, photo, video
 * or voice note), with an "ad reply" card: Deleted Status / Deleted by ...
 *
 * Switched with the `antistatus` command.
 *
 * A status is stored like any other message, for STATUS_RETENTION_HOURS (12 by default, see lib/maintenance.js), and
 * only while the bot is running and receiving statuses: one posted before that, or older, is not there to be shown.
 */
import { jidNormalizedUser } from 'baileys';
import { getAntiStatus } from '#sql';
import { TEXT_TYPES, adReply, displayName, isDeletion, profilePicture, resend, resolve, textOf, typeOf } from './noticeutils.js';

const STATUS_JID = 'status@broadcast';
const handled = new Set(); // a delete that WhatsApp sends twice is shown once

async function handleStatusDelete(conn, update) {
	if (update.key.fromMe) return; // the owner's own statuses
	if (!(await getAntiStatus())) return;

	const original = (await conn.loadMessage(update.key.id))?.message;
	if (!original?.message || original.key?.fromMe) return;

	const poster = original.sender || (await resolve(conn, original.key.participant, original.key.participantAlt));
	if (!poster) return;

	if (handled.has(update.key.id)) return;
	handled.add(update.key.id);
	if (handled.size > 200) handled.delete(handled.values().next().value);

	const owner = jidNormalizedUser(conn.user.id);
	const contextInfo = {
		mentionedJid: [poster],
		externalAdReply: adReply(
			'Deleted Status',
			`Deleted by ${await displayName(conn, poster)}`,
			await profilePicture(conn, poster)
		)
	};

	if (TEXT_TYPES.has(typeOf(original))) {
		const text = textOf(original.message);
		if (!text) return;
		await conn.sendMessage(owner, { text, contextInfo });
		return;
	}
	// not quoted: quoting a status would show the chat as a reply to it
	await resend(conn, owner, original, contextInfo, { quote: false });
}

export const AntiStatus = async (conn, updates) => {
	for (const update of updates) {
		try {
			if (!isDeletion(update) || update.key.remoteJid !== STATUS_JID) continue;
			await handleStatusDelete(conn, update);
		} catch (err) {
			console.log('[antistatus]', err?.message || err);
		}
	}
};

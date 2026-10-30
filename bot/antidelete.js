/**
 * Anti-delete: a deleted message is resent as it was (no extra text), carrying an "ad reply" card:
 * Deleted Message / Deleted by ...
 *
 * Groups: the notice goes into the group. Private chats: it goes to the bot's own inbox.
 * Switched with the `antidelete` command.
 *
 * Edits are bot/antiedit.js, deleted statuses are bot/antistatus.js: they arrive through the same `messages.update`
 * event, each one handles its own kind.
 */
import { isJidGroup, jidNormalizedUser } from 'baileys';
import { getAnti } from '#sql';
import { TEXT_TYPES, adReply, displayName, isDeletion, profilePicture, resend, resolve, textOf, typeOf } from './noticeutils.js';

async function handleDelete(conn, update) {
	const store = await conn.loadMessage(update.key.id);
	const original = store?.message;
	if (!original?.message) return;

	const isGroup = isJidGroup(store.jid);
	if (!(await getAnti(isGroup ? 'gc' : 'dm'))) return;

	const owner = jidNormalizedUser(conn.user.id);
	const sender = original.sender || (await resolve(conn, original.key.participant || original.key.remoteJid));
	const deletedBy = isGroup
		? await resolve(conn, update.key.participant, update.key.participantAlt)
		: update.key.fromMe
			? owner
			: await resolve(conn, update.key.remoteJid, update.key.remoteJidAlt);

	const contextInfo = {
		mentionedJid: [...new Set([sender, deletedBy].filter(Boolean))],
		externalAdReply: adReply(
			'Deleted Message',
			`Deleted by ${await displayName(conn, deletedBy || sender)}`,
			await profilePicture(conn, sender)
		)
	};
	const target = isGroup ? store.jid : owner;

	if (TEXT_TYPES.has(typeOf(original))) {
		// nothing to show but the words themselves: they are the message, with the card
		const text = textOf(original.message);
		if (!text) return;
		await conn.sendMessage(target, { text, contextInfo }, { quoted: original });
		return;
	}
	await resend(conn, target, original, contextInfo);
}

export const AntiDelete = async (conn, updates) => {
	for (const update of updates) {
		try {
			// a deleted status is antistatus's
			if (!isDeletion(update) || update.key.remoteJid === 'status@broadcast') continue;
			await handleDelete(conn, update);
		} catch (err) {
			console.log('[antidelete]', err?.message || err);
		}
	}
};

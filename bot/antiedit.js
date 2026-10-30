/**
 * Anti-edit: when someone edits a message, the old and the new text go out in one message, with an "ad reply" card:
 * Edited Message / Edited by ...
 *
 * Groups: the notice goes into the group. Private chats: it goes to the bot's own inbox.
 * Switched with the `antiedit` command.
 *
 * The stored copy of the message is kept up to date even while this is off, so a later delete (or edit) works from
 * the latest wording.
 */
import { isJidGroup, jidNormalizedUser } from 'baileys';
import { getAntiEdit, messageDb } from '#sql';
import { adReply, displayName, fontStyler, isDeletion, profilePicture, resolve, textOf, typeOf } from './noticeutils.js';

// Baileys hands an edit over as an update whose message is { editedMessage: { message } }
const readEdit = update => {
	const message = update?.update?.message;
	return message?.editedMessage?.message ?? message?.protocolMessage?.editedMessage ?? null;
};

// Keeps the stored copy up to date, so the next edit (or a delete) works from the latest wording.
const storeNewText = async (store, original, text) => {
	const type = typeOf(original);
	const inner = original.message[type];
	if (type === 'conversation') original.message.conversation = text;
	else if (inner && typeof inner === 'object') inner[type === 'extendedTextMessage' ? 'text' : 'caption'] = text;
	original.body = text;
	await messageDb.update({ message: original }, { where: { id: store.id } });
};

async function handleEdit(conn, update) {
	const edited = readEdit(update);
	if (!edited || !update.key?.id) return;

	const store = await conn.loadMessage(update.key.id);
	const original = store?.message;
	// the bot edits its own messages all the time ("Please wait..." -> the result), and those are not stored
	if (!original?.message || original.key?.fromMe) return;
	if (typeOf(original) === 'protocolMessage') return; // the edit notice itself, not the message that was edited

	const oldText = textOf(original.message);
	const newText = textOf(edited);
	if (!newText || newText === oldText) return;

	const isGroup = isJidGroup(store.jid);
	if (await getAntiEdit(isGroup ? 'gc' : 'dm')) {
		const owner = jidNormalizedUser(conn.user.id);
		const sender = original.sender || (await resolve(conn, original.key.participant || original.key.remoteJid));
		const style = await fontStyler();

		const text =
			`${style('📝 Edited Message (Original):')}\n\n${oldText || '—'}\n\n` +
			`${style('✏️ Edited Message (New):')}\n\n${newText}`;
		const contextInfo = {
			mentionedJid: [sender],
			externalAdReply: adReply(
				'Edited Message',
				`Edited by ${await displayName(conn, sender)}`,
				await profilePicture(conn, sender)
			)
		};
		await conn.sendMessage(isGroup ? store.jid : owner, { text, contextInfo }, { quoted: original });
	}

	await storeNewText(store, original, newText);
}

export const AntiEdit = async (conn, updates) => {
	for (const update of updates) {
		try {
			if (isDeletion(update)) continue;
			await handleEdit(conn, update);
		} catch (err) {
			console.log('[antiedit]', err?.message || err);
		}
	}
};

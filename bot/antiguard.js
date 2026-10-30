/**
 * The group guards: antitag, antisticker, antimedia, antidocument and antigroupstatus. They all work the same way:
 * a message of the kind the guard looks for, from a member who is not an admin, is deleted, and then
 *
 *   delete   nothing more happens (the member is told)
 *   kick     the member is removed
 *   warn     the member is warned, and removed after WARN_COUNT warnings
 *
 * Each guard is switched per group with the command of the same name (on / off / set delete | kick | warn).
 *
 * Admins, sudo users and the bot itself are never touched. The bot has to be an admin to delete or remove anyone,
 * when it is not the guards do nothing. A burst of messages (five stickers sent at once) is deleted in full but
 * counts as one warning and gets one notice.
 */
import { config } from '#config';
import { areJidsSameUser, isJidGroup } from 'baileys';
import { addGuardWarn, getGroupGuards, isSudo, resetGuardWarn } from '#sql';

/** From this many members tagged in one message, it counts as mass tagging (ANTITAG_LIMIT changes it). */
export const TAG_LIMIT = Number(process.env.ANTITAG_LIMIT) || 5;

const BURST_MS = 10_000;

const STICKER_TYPES = new Set(['stickerMessage', 'stickerPackMessage', 'lottieStickerMessage']);
const MEDIA_TYPES = new Set(['imageMessage', 'videoMessage', 'audioMessage', 'ptvMessage']);
const GROUP_STATUS_TYPES = new Set(['groupStatusMessageV2', 'groupStatusMessage']);

// What each guard looks for. When a message is of more than one kind (a photo posted as a group status) the first
// guard in this list that is on deals with it.
const GUARDS = {
	groupstatus: {
		title: 'Anti Group Status',
		rule: 'Group statuses are not allowed here',
		// rawType is the message as WhatsApp sent it, before the wrapper around a group status is taken off
		matches: msg =>
			GROUP_STATUS_TYPES.has(msg.rawType) ||
			GROUP_STATUS_TYPES.has(msg.type) ||
			[...GROUP_STATUS_TYPES].some(type => !!msg.message?.[type])
	},
	tag: {
		title: 'Anti Tag',
		rule: `Tagging ${TAG_LIMIT} or more members at once is not allowed here`,
		matches: msg => new Set(msg.mention || []).size >= TAG_LIMIT
	},
	sticker: {
		title: 'Anti Sticker',
		rule: 'Stickers are not allowed here',
		matches: msg => STICKER_TYPES.has(msg.type)
	},
	document: {
		title: 'Anti Document',
		rule: 'Documents are not allowed here',
		matches: msg => msg.type === 'documentMessage'
	},
	media: {
		title: 'Anti Media',
		rule: 'Photos, videos and audio are not allowed here',
		matches: msg => MEDIA_TYPES.has(msg.type)
	}
};

const recent = new Map(); // "group:guard:member" -> time of the last notice / warning, for the burst rule
const sameBurst = key => {
	const now = Date.now();
	if (now - (recent.get(key) || 0) < BURST_MS) return true;
	recent.delete(key);
	recent.set(key, now);
	if (recent.size > 500) recent.delete(recent.keys().next().value);
	return false;
};

async function enforce(msg, type, guard, action) {
	const conn = msg.client;
	const jid = msg.from;
	const user = msg.sender;
	const who = `@${user.split('@')[0]}`;
	const say = text =>
		conn.sendMessage(jid, { text: `\`\`\`🚫 ${guard.title}\n\n${text}\`\`\``, mentions: [user] });
	const limit = Number(config.WARN_COUNT) || 3;

	try {
		await conn.sendMessage(jid, { delete: msg.key });
	} catch {
		// the message may be gone already
	}

	const remove = async () => {
		try {
			await conn.groupParticipantsUpdate(jid, [user], 'remove');
			return true;
		} catch (err) {
			console.log('[antiguard] could not remove', user, err?.message || err);
			return false;
		}
	};

	if (action === 'kick') {
		return (await remove()) ? say(`${who} has been removed.\n${guard.rule}.`) : say(`${who}\n${guard.rule}.`);
	}

	// the rest of a burst was deleted above, the notice or the warning is for the first message only
	if (sameBurst(`${jid}:${type}:${user}`)) return;

	if (action === 'warn') {
		const warnings = await addGuardWarn(jid, type, user);
		if (warnings >= limit) {
			await resetGuardWarn(jid, type, user);
			return (await remove())
				? say(`${who} reached ${limit} warnings and has been removed.`)
				: say(`${who} reached ${limit} warnings, but I could not remove them.`);
		}
		return say(`${who}\n${guard.rule}.\nWarning ${warnings}/${limit}`);
	}

	return say(`${who}\n${guard.rule}.`);
}

/** Called for every message of a group. */
export async function AntiGuards(msg) {
	try {
		if (!isJidGroup(msg.from) || !msg.sender || !msg.message || msg.key?.fromMe) return;

		const enabled = await getGroupGuards(msg.from);
		if (!enabled.size) return;

		for (const [type, guard] of Object.entries(GUARDS)) {
			const setting = enabled.get(type);
			if (!setting || !guard.matches(msg)) continue;

			// the first guard that applies deals with the message, the others leave it alone
			if (!msg.isBotAdmin) return; // nothing can be deleted or removed
			if (msg.isAdmin || areJidsSameUser(msg.sender, msg.user) || (await isSudo(msg.sender, msg.user))) return;
			return await enforce(msg, type, guard, setting.action);
		}
	} catch (err) {
		console.log('[antiguard]', err?.message || err);
	}
}

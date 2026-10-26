import crypto from 'node:crypto';
import { downloadMediaMessage, isJidGroup } from 'baileys';
import { bot, Button, postGroupStatus, statusStyle, toStatusAudio } from '#lib';
import { isUrl, delay } from '#utils';

const PENDING_TTL_MS = 5 * 60 * 1000;
const MAX_PENDING = 3; // a pending post can hold a whole video in memory
const PAGE_SIZE = 30; // groups in one list message
const SECTION_SIZE = 10; // rows in one section of the list

// token -> { built, groups: [{jid, subject, size}], posted: Set of jids, expiresAt }
const pending = new Map();

function savePending(entry) {
	const now = Date.now();
	for (const [token, saved] of pending) if (saved.expiresAt < now) pending.delete(token);
	while (pending.size >= MAX_PENDING) pending.delete(pending.keys().next().value); // oldest first
	const token = crypto.randomBytes(4).toString('hex');
	pending.set(token, { ...entry, posted: new Set(), expiresAt: now + PENDING_TTL_MS });
	return token;
}

/** The pending post behind a list, or undefined once it expired. Using it keeps it alive. */
function getPending(token) {
	const entry = pending.get(token);
	if (!entry) return undefined;
	if (entry.expiresAt < Date.now()) {
		pending.delete(token);
		return undefined;
	}
	entry.expiresAt = Date.now() + PENDING_TTL_MS;
	return entry;
}

function getDomain(url) {
	try {
		return new URL(url).hostname;
	} catch {
		return url;
	}
}

const clip = (text, max) => {
	const chars = [...String(text)];
	return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : chars.join('');
};

async function downloadRaw(client, key, message) {
	return downloadMediaMessage({ key, message }, 'buffer', {}, { logger: console, reuploadRequest: client.updateMediaMessage });
}

/**
 * Figures out what to post: media quoted/attached to the command, or plain text/link.
 * Returns { payload, style, label } or null when there is nothing to post.
 */
async function buildContentPayload(message, captionText) {
	const quoted = message.reply_message;
	let node = null;
	let mtype = null;
	let key = null;

	if (quoted?.image || quoted?.video || quoted?.audio || quoted?.sticker || quoted?.document) {
		mtype = quoted.image
			? 'imageMessage'
			: quoted.video
			? 'videoMessage'
			: quoted.audio
			? 'audioMessage'
			: quoted.sticker
			? 'stickerMessage'
			: 'documentMessage';
		node = quoted.message?.[mtype];
		key = quoted.key;
	} else if (['imageMessage', 'videoMessage', 'audioMessage', 'stickerMessage', 'documentMessage'].includes(message.mtype)) {
		mtype = message.mtype;
		node = message.message?.[mtype];
		key = message.key;
	}

	if (node && key) {
		if (mtype === 'imageMessage') {
			const buf = await downloadRaw(message.client, key, { [mtype]: node });
			return { payload: { image: buf, caption: captionText || node?.caption || '' }, label: '📷 Image' };
		}
		if (mtype === 'videoMessage') {
			const buf = await downloadRaw(message.client, key, { [mtype]: node });
			return { payload: { video: buf, caption: captionText || node?.caption || '', gifPlayback: false }, label: '🎥 Video' };
		}
		if (mtype === 'audioMessage') {
			const buf = await downloadRaw(message.client, key, { [mtype]: node });
			return { payload: await toStatusAudio(buf, node), label: node?.ptt ? '🎤 Voice Note' : '🎵 Audio (as voice note)' };
		}
		if (mtype === 'stickerMessage') {
			const buf = await downloadRaw(message.client, key, { [mtype]: node });
			return { payload: { image: buf, caption: captionText || '' }, label: '🖼️ Sticker (as image)' };
		}
		if (mtype === 'documentMessage') {
			const fname = node?.fileName || 'Document';
			return { payload: { text: `📄 *${fname}*\n${captionText || ''}` }, style: statusStyle(), label: '📄 Document (as text)' };
		}
	}

	const rawText = captionText || '';
	if (!rawText) return null;

	if (isUrl(rawText)) {
		return {
			payload: {
				text: rawText,
				linkPreview: { 'canonical-url': rawText, 'matched-text': rawText, title: getDomain(rawText), description: rawText }
			},
			style: statusStyle(),
			label: `🔗 Link — ${getDomain(rawText)}`
		};
	}

	return { payload: { text: rawText }, style: statusStyle(), label: '📝 Text' };
}

async function listGroupsFor(client) {
	const all = await client.groupFetchAllParticipating();
	return Object.values(all)
		.map(g => ({ jid: g.id, subject: g.subject || 'Unnamed group', size: g.size ?? g.participants?.length ?? 0 }))
		.sort((a, b) => a.subject.localeCompare(b.subject, undefined, { sensitivity: 'base' }));
}

/** What the owner is told once a post went out: confirmed by WhatsApp, or sent without an answer. */
const postedText = (where, label, confirmed) =>
	confirmed
		? `_Posted to ${where}._\nType: ${label}`
		: `_Sent to ${where}, but WhatsApp has not confirmed it yet._\nType: ${label}\n_Check the group, and send it again if it is missing._`;

/**
 * The group picker: one list message, each row is a group. A row's id is the command that posts to it, so
 * tapping a row comes back as a normal command (see swgcpost). Long lists continue on the next page.
 */
async function sendGroupList(message, token, page = 0) {
	const { built, groups } = getPending(token);
	const start = page * PAGE_SIZE;
	const slice = groups.slice(start, start + PAGE_SIZE);
	const pages = Math.ceil(groups.length / PAGE_SIZE);

	const list = new Button(message.client)
		.setBody(
			`*Which group should I post this to?*\n\nType: ${built.label}\nGroups: ${groups.length}` +
				(pages > 1 ? ` (page ${page + 1} of ${pages})` : '')
		)
		.setFooter('Tap the button, pick a group. Expires in 5 minutes.')
		.addSelection('Select group');

	for (let i = 0; i < slice.length; i += SECTION_SIZE) {
		const chunk = slice.slice(i, i + SECTION_SIZE);
		list.makeSection(`Groups ${start + i + 1}-${start + i + chunk.length}`);
		for (const g of chunk) {
			const long = [...g.subject].length > 24;
			list.makeRow('', clip(g.subject, 24), long ? clip(g.subject, 72) : g.size ? `${g.size} members` : 'Group', `${message.prefix}swgcpost ${token} ${g.jid}`);
		}
	}
	if (start + PAGE_SIZE < groups.length) {
		list.makeSection('More');
		list.makeRow('', 'More groups ➡️', `Groups from ${start + PAGE_SIZE + 1}`, `${message.prefix}swgcpage ${token} ${page + 1}`);
	}
	return list.send(message.jid);
}

bot(
	{
		pattern: 'swgc|upswgc',
		public: false,
		desc: 'Post media/text/link as a group status. In a group, posts there. In DM, pick a group from a list.',
		type: 'group'
	},
	async (message, match) => {
		let built;
		try {
			built = await buildContentPayload(message, (match || '').trim());
		} catch (err) {
			return message.send(`_Could not prepare that: ${err?.message || err}_`);
		}
		if (!built) {
			return message.send(
				'_Nothing to post. Reply to (or send) an image/video/audio, or give text/a link.\n\n' +
					`Usage: ${message.prefix}swgc <text>, or reply media with ${message.prefix}swgc [caption]_`
			);
		}

		if (isJidGroup(message.jid)) {
			await message.react('⏳');
			try {
				const { confirmed } = await postGroupStatus(message.client, message.jid, built);
				await message.react(confirmed ? '✅' : '⚠️');
				return message.send(postedText('this group', built.label, confirmed));
			} catch (err) {
				await message.react('❌');
				return message.send(`_Status upload failed: ${err?.message || err}_`);
			}
		}

		// DM: a list of the groups to pick from
		const groups = await listGroupsFor(message.client);
		if (!groups.length) return message.send('_I am not in any groups._');
		return sendGroupList(message, savePending({ built, groups }));
	}
);

// Used by the rows of the list above, not meant to be typed.
bot(
	{
		pattern: 'swgcpost',
		public: false,
		dontAddCommandList: true,
		desc: 'Posts the waiting group status to the group picked from the swgc list',
		type: 'group'
	},
	async (message, match) => {
		const [token, jid] = (match || '').trim().split(/\s+/);
		const entry = token && getPending(token);
		if (!entry) return message.send(`_That list has expired. Send ${message.prefix}swgc again._`);

		const group = entry.groups.find(g => g.jid === jid);
		if (!group) return message.send(`_That group is not in the list. Send ${message.prefix}swgc again._`);
		if (entry.posted.has(jid)) return message.send(`_Already posted to *${group.subject}*._`);

		await message.react('⏳');
		try {
			const { confirmed } = await postGroupStatus(message.client, group.jid, entry.built);
			entry.posted.add(jid); // the list stays usable, so another group can be picked, but never the same one twice
			await message.react(confirmed ? '✅' : '⚠️');
			return message.send(postedText(`*${group.subject}*`, entry.built.label, confirmed));
		} catch (err) {
			await message.react('❌');
			return message.send(`_Status upload failed: ${err?.message || err}_`);
		}
	}
);

// The "More groups" row of a long list.
bot(
	{
		pattern: 'swgcpage',
		public: false,
		dontAddCommandList: true,
		desc: 'Shows the next page of groups for swgc',
		type: 'group'
	},
	async (message, match) => {
		const [token, page] = (match || '').trim().split(/\s+/);
		if (!token || !getPending(token)) return message.send(`_That list has expired. Send ${message.prefix}swgc again._`);
		return sendGroupList(message, token, Math.max(0, parseInt(page, 10) || 0));
	}
);

bot(
	{
		pattern: 'upswgcall',
		public: false,
		desc: 'Post media/text/link as a group status to every group the bot is in',
		type: 'group'
	},
	async (message, match) => {
		let built;
		try {
			built = await buildContentPayload(message, (match || '').trim());
		} catch (err) {
			return message.send(`_Could not prepare that: ${err?.message || err}_`);
		}
		if (!built) {
			return message.send('_Nothing to post. Reply to (or send) media, or give text/a link._');
		}

		const groups = await listGroupsFor(message.client);
		if (!groups.length) return message.send('_I am not in any groups._');

		await message.send(`_Posting to ${groups.length} groups..._`);
		let ok = 0;
		let unconfirmed = 0;
		let failed = 0;
		let reason = '';
		for (const g of groups) {
			try {
				const { confirmed } = await postGroupStatus(message.client, g.jid, built);
				if (confirmed) ok++;
				else unconfirmed++;
			} catch (err) {
				failed++;
				reason ||= err?.message || String(err);
			}
			await delay(1500);
		}

		return message.send(
			`_Done. Posted to ${ok}/${groups.length} groups._` +
				(unconfirmed ? `\n_${unconfirmed} sent without a confirmation from WhatsApp._` : '') +
				(failed ? `\n_${failed} failed. First error: ${reason}_` : '')
		);
	}
);

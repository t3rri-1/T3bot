import crypto from 'crypto';
import { generateWAMessageContent, generateWAMessageFromContent, downloadMediaMessage, isJidGroup } from 'baileys';
import { bot } from '#lib';
import { isUrl, delay } from '#utils';

// sender jid -> { contentPayload, typeLabel, caption, groups: [{jid,subject}], expiresAt }
const pending = new Map();
const PENDING_TTL_MS = 2 * 60 * 1000;

function getDomain(url) {
	try {
		return new URL(url).hostname;
	} catch {
		return url;
	}
}

function randomBg() {
	const colors = [0xff0e0e0e, 0xffb84fce, 0xff2a52be, 0xff0f8a5f, 0xffc9184a, 0xff614085];
	return colors[Math.floor(Math.random() * colors.length)];
}

async function downloadRaw(client, key, message) {
	return downloadMediaMessage({ key, message }, 'buffer', {}, { logger: console, reuploadRequest: client.updateMediaMessage });
}

/**
 * Figures out what to post: media quoted/attached to the command, or plain text/link.
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
			const isPtt = node?.ptt === true;
			return {
				payload: { audio: buf, mimetype: isPtt ? 'audio/ogg; codecs=opus' : 'audio/mp4', ptt: isPtt },
				label: isPtt ? '🎤 Voice Note' : '🎵 Audio'
			};
		}
		if (mtype === 'stickerMessage') {
			const buf = await downloadRaw(message.client, key, { [mtype]: node });
			return { payload: { image: buf, caption: captionText || '' }, label: '🖼️ Sticker (as image)' };
		}
		if (mtype === 'documentMessage') {
			const fname = node?.fileName || 'Document';
			return { payload: { text: `📄 *${fname}*\n${captionText || ''}` }, label: '📄 Document (as text)' };
		}
	}

	const rawText = captionText || '';
	if (!rawText) return null;

	if (isUrl(rawText)) {
		return {
			payload: {
				text: rawText,
				linkPreview: { url: rawText, title: getDomain(rawText), description: rawText, thumbnail: null }
			},
			label: `🔗 Link — ${getDomain(rawText)}`
		};
	}

	return {
		payload: { text: rawText, backgroundArgb: randomBg(), textArgb: 0xffffffff, font: Math.floor(Math.random() * 5) + 1 },
		label: '📝 Text'
	};
}

async function postGroupStatus(client, groupJid, contentPayload) {
	let waContent;
	try {
		waContent = await generateWAMessageContent(contentPayload, { upload: client.waUploadToServer });
	} catch {
		waContent = await generateWAMessageContent(
			{ text: contentPayload.caption || contentPayload.text || '(status)', backgroundArgb: randomBg(), textArgb: 0xffffffff, font: 1 },
			{ upload: client.waUploadToServer }
		);
	}

	const messageSecret = crypto.randomBytes(32);
	const finalMsg = generateWAMessageFromContent(
		groupJid,
		{
			messageContextInfo: { messageSecret },
			groupStatusMessageV2: { message: { ...waContent, messageContextInfo: { messageSecret } } }
		},
		{ userJid: client.user.id }
	);

	await client.relayMessage(groupJid, finalMsg.message, { messageId: finalMsg.key.id });
}

async function listGroupsFor(client) {
	const all = await client.groupFetchAllParticipating();
	return Object.values(all).map(g => ({ jid: g.id, subject: g.subject || 'Unnamed group' }));
}

bot(
	{
		pattern: 'swgc|upswgc',
		public: false,
		desc: 'Post media/text/link as a group status. In a group, posts there. In DM, pick a group by number.',
		type: 'group'
	},
	async (message, match) => {
		const built = await buildContentPayload(message, (match || '').trim());
		if (!built) {
			return message.send(
				'_Nothing to post. Reply to (or send) an image/video/audio, or give text/a link.\n\n' +
					`Usage: ${message.prefix}swgc <text>, or reply media with ${message.prefix}swgc [caption]_`
			);
		}

		if (isJidGroup(message.jid)) {
			await message.react('⏳');
			try {
				await postGroupStatus(message.client, message.jid, built.payload);
				await message.react('✅');
				return message.send(`_Group status posted._\nType: ${built.label}`);
			} catch (err) {
				await message.react('❌');
				return message.send(`_Status upload failed: ${err?.message || err}_`);
			}
		}

		// DM: list groups and wait for a number reply
		const groups = await listGroupsFor(message.client);
		if (!groups.length) return message.send('_I am not in any groups._');

		pending.set(message.sender, {
			contentPayload: built.payload,
			label: built.label,
			groups,
			expiresAt: Date.now() + PENDING_TTL_MS
		});

		const list = groups.map((g, i) => `${i + 1}. ${g.subject}`).join('\n');
		return message.send(`_Which group should I post this to? Reply with a number:_\n\n${list}\n\n_(expires in 2 minutes)_`);
	}
);

bot(
	{
		pattern: '',
		on: true,
		dontAddCommandList: true,
		public: true
	},
	async (message, body) => {
		const entry = pending.get(message.sender);
		if (!entry) return;
		if (Date.now() > entry.expiresAt) {
			pending.delete(message.sender);
			return;
		}
		if (!/^\d+$/.test((body || '').trim())) return;

		const idx = parseInt(body.trim(), 10) - 1;
		const group = entry.groups[idx];
		if (!group) return message.send(`_Invalid number. Pick 1-${entry.groups.length}, or send a new ${message.prefix}swgc to start over._`);

		pending.delete(message.sender);
		await message.react('⏳');
		try {
			await postGroupStatus(message.client, group.jid, entry.contentPayload);
			await message.react('✅');
			return message.send(`_Posted to *${group.subject}*._\nType: ${entry.label}`);
		} catch (err) {
			await message.react('❌');
			return message.send(`_Status upload failed: ${err?.message || err}_`);
		}
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
		const built = await buildContentPayload(message, (match || '').trim());
		if (!built) {
			return message.send('_Nothing to post. Reply to (or send) media, or give text/a link._');
		}

		const groups = await listGroupsFor(message.client);
		if (!groups.length) return message.send('_I am not in any groups._');

		await message.send(`_Posting to ${groups.length} groups..._`);
		let ok = 0;
		let failed = 0;
		for (const g of groups) {
			try {
				await postGroupStatus(message.client, g.jid, built.payload);
				ok++;
			} catch {
				failed++;
			}
			await delay(1500);
		}

		return message.send(`_Done. Posted to ${ok}/${groups.length} groups.${failed ? ` ${failed} failed.` : ''}_`);
	}
);

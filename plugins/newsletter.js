import { config } from '#config';
import { bot } from '#lib';
import { getBuffer } from '#utils';

const numbers = new Intl.NumberFormat('en-US');

/**
 * The invite code of a WhatsApp channel, out of a link, a part of a link or the bare code.
 * @param {string} link
 * @returns {string|null}
 */
function getChannelInviteCode(link) {
	// no query or fragment
	const clean = String(link || '')
		.trim()
		.split('?')[0]
		.split('#')[0];
	if (!clean) return null;

	// a link: the last part of its path
	try {
		const code = new URL(clean).pathname.split('/').filter(Boolean).pop();
		if (code) return code;
	} catch {
		// not a full link, the patterns below read it
	}

	for (const pattern of [/(?:whatsapp\.com|wa\.me)\/channel\/([A-Za-z0-9]+)/i, /channel\/([A-Za-z0-9]+)/i]) {
		const found = clean.match(pattern)?.[1];
		if (found) return found;
	}

	// the code on its own
	return /^[A-Za-z0-9]+$/.test(clean) ? clean : null;
}

// The picture of a channel comes as a path on WhatsApp's picture server
const pictureOf = meta => {
	const picture = meta.picture ?? meta.image ?? meta.preview;
	if (!picture) return null;
	if (typeof picture === 'string') return picture.startsWith('http') ? picture : `https://pps.whatsapp.net${picture}`;
	if (picture.url) return picture.url;
	const path = picture.directPath ?? picture.direct_path;
	return path ? `https://pps.whatsapp.net${path}` : null;
};

// the day it was created, in the bot's time zone (TIME_ZONE)
const createdOf = meta => {
	const raw = Number(meta.creation_time ?? meta.creationTime);
	if (!raw) return null;
	const date = new Date(raw > 1e12 ? raw : raw * 1000);
	if (Number.isNaN(date.getTime())) return null;
	const format = timeZone => date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone });
	try {
		return format(config.TIME_ZONE || undefined);
	} catch {
		return format(undefined); // a time zone name that is not valid
	}
};

const detailsOf = (meta, fallbackCode) => {
	const code = meta.invite || fallbackCode;
	const subscribers = meta.subscribers ?? meta.subscriberCount;
	const created = createdOf(meta);
	const verified = String(meta.verification || '').toUpperCase();

	return [
		'📢 *Channel*',
		'',
		meta.name ? `*Name:* ${meta.name}` : '',
		`*ID:* \`\`\`${meta.id || 'N/A'}\`\`\``,
		code ? `*Invite code:* ${code}` : '',
		code ? `*Link:* https://whatsapp.com/channel/${code}` : '',
		subscribers !== undefined && subscribers !== null ? `*Subscribers:* ${numbers.format(Number(subscribers))}` : '',
		created ? `*Created:* ${created}` : '',
		verified ? `*Verified:* ${verified === 'VERIFIED' ? 'Yes' : 'No'}` : '',
		meta.description ? `\n*Description:*\n${meta.description}` : ''
	]
		.filter(line => line !== '')
		.join('\n');
};

bot(
	{
		pattern: 'idch|newsletter|channelinfo',
		public: false,
		desc: 'Get the id and details of a WhatsApp channel from its link (or the link it is in a reply)',
		type: 'whatsapp'
	},
	async (message, match) => {
		const prefix = Array.from(message.prefix || '.')[0] || '.';
		const text = (match || message.reply_message?.text || '').trim();
		if (!text) {
			return message.send(
				`_Give me a channel link, eg. ${prefix}idch https://whatsapp.com/channel/0029VaAbCdEfGhIJkL_\n_The invite code on its own works too._`
			);
		}

		// a channel id (…@newsletter) is looked up as it is, anything else is read as an invite link / code
		const byJid = /^\d+@newsletter$/i.test(text);
		const key = byJid ? text.toLowerCase() : getChannelInviteCode(text);
		if (!key) {
			return message.send(
				'_Could not find an invite code in that. Send a link like https://whatsapp.com/channel/0029VaAbCdEfGhIJkL_'
			);
		}

		let meta;
		try {
			meta = await message.client.newsletterMetadata(byJid ? 'jid' : 'invite', key);
		} catch (err) {
			console.log('[newsletter]', err?.message || err);
		}
		if (!meta) return message.send('_Could not get that channel. Check the link, the channel may not exist any more._');

		const details = detailsOf(meta, byJid ? undefined : key);
		const picture = pictureOf(meta);
		if (picture) {
			try {
				return await message.send(await getBuffer(picture), { type: 'image', caption: details });
			} catch {
				// no picture (private, or the link expired): the details alone are the answer
			}
		}
		return message.send(details);
	}
);

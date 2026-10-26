import { generateWAMessageFromContent, getBinaryNodeChild, proto } from 'baileys';
import { bot } from '#lib';
import { getBuffer } from '#utils';

bot(
	{
		pattern: 'add',
		public: false,
		isGroup: true,
		desc: 'Add a number to this group (falls back to an invite DM if a direct add is not possible)'
	},
	async (message, match) => {
		const jid = await message.getUserJid(match);
		if (!jid) return;

		try {
			const response = await message.client.query({
				tag: 'iq',
				attrs: { type: 'set', xmlns: 'w:g2', to: message.jid },
				content: [{ tag: 'add', attrs: {}, content: [{ tag: 'participant', attrs: { jid } }] }]
			});

			const add = getBinaryNodeChild(response, 'add');
			const userNode = getBinaryNodeChild(add, 'participant');
			const addRequest = userNode ? getBinaryNodeChild(userNode, 'add_request') : null;

			if (!addRequest) {
				// No add_request node back means the participant was added directly
				return await message.send(`_@${jid.split('@')[0]} has been added to the group._`, { mentions: [jid] });
			}

			// Direct add wasn't possible (privacy settings / bot not admin) — send an invite instead
			const invite_code = addRequest.attrs.code;
			const invite_code_exp = addRequest.attrs.expiration;

			const pp = await message.client.profilePictureUrl(message.jid, 'image').catch(() => null);
			const jpegThumbnail = pp ? await getBuffer(pp).catch(() => Buffer.alloc(0)) : Buffer.alloc(0);

			const gName = await message.client.groupMetadata(message.jid);

			const groupInvite = generateWAMessageFromContent(
				jid,
				proto.Message.fromObject({
					groupInviteMessage: {
						groupJid: message.jid,
						inviteCode: invite_code,
						inviteExpiration: invite_code_exp,
						groupName: gName.subject,
						caption: `_Join ${gName.subject}_`,
						jpegThumbnail
					}
				}),
				{ userJid: jid }
			);

			await message.client.relayMessage(jid, groupInvite.message, { messageId: groupInvite.key.id });
			return message.send(
				`_Could not add @${jid.split('@')[0]} directly (their privacy settings, or I'm not admin here), so I sent them an invite instead._`,
				{ mentions: [jid] }
			);
		} catch (err) {
			return message.send(
				`_Couldn't add that number. This usually means this group doesn't allow non-admins to add members, or WhatsApp rejected the request._\n\`\`\`${err?.message || err}\`\`\``
			);
		}
	}
);

import { bot, AIRich, logo } from '#lib';
import { getSharp } from '../utils/sharp.js';

const OWNER_JID = '256784670936@s.whatsapp.net';
const FALLBACK_AVATAR = 'https://i.ibb.co/2kR6bDq/avatar-contact.png';
const CHANNEL = 'https://whatsapp.com/channel/0029Vb57ZHh7IUYcNttXEB3y';

// The logo keeps its own proportions (media/t3.jpg is square), a fixed banner size would stretch it.
async function logoSize() {
	try {
		const sharp = await getSharp();
		const { width, height } = await sharp(logo).metadata();
		if (width && height) return { width: 1080, height: Math.round((1080 * height) / width) };
	} catch {
		// no metadata: show it square
	}
	return { width: 1080, height: 1080 };
}

bot(
	{
		pattern: 'creator',
		public: true,
		desc: 'Meet the creator of this bot',
		type: 'help'
	},
	async message => {
		let avatar;
		try {
			avatar = await message.client.profilePictureUrl(OWNER_JID, 'image');
		} catch {
			avatar = FALLBACK_AVATAR;
		}

		try {
			const rich = new AIRich(message.client);
			rich.addImage(logo, await logoSize());
			rich.addSection({
				view_model: {
					primitive: {
						__typename: 'GenAICompactEntityPrimitive',
						title: 'T3rri',
						subtitle: 'Owner of T3RRI BOT',
						secondary_subtitle: 'domestic engineer',
						entity_id: 867051314767696,
						entity_url: CHANNEL,
						entity_type: 'PAGE',
						action_type: 'FOLLOW',
						is_verified: true,
						image: {
							url: avatar,
							url_fallback: avatar
						}
					},
					__typename: 'GenAISingleLayoutViewModel'
				}
			});
			rich.addTip('Owner of T3RRI BOT');
			await rich.send(message.jid, { quoted: { key: message.key, message: message.message } });
		} catch {
			// the rich card did not go through on this phone, the facts still have to reach the person
			return await message.send(`*T3rri*\nOwner of T3RRI BOT\n\n${CHANNEL}`);
		}
	}
);

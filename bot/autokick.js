import { AutoKickDB } from '#sql';
import { isJidGroup } from 'baileys';

// Used to run one 10 s timer per group, each fetching the group from WhatsApp and querying the database
// once per member. Now: a single timer, a single query for the whole kick list, and WhatsApp is only
// asked about groups that actually have someone on the list.
let timer = null;
let client = null;
let running = false;

const sweep = async () => {
	if (running) return;
	running = true;
	try {
		const rows = await AutoKickDB.findAll();
		if (!rows.length) return;

		const byGroup = new Map();
		for (const { groupJid, userJid } of rows) {
			if (!byGroup.has(groupJid)) byGroup.set(groupJid, new Set());
			byGroup.get(groupJid).add(userJid);
		}

		for (const [groupId, wanted] of byGroup) {
			let meta;
			try {
				meta = await client.groupMetadata(groupId);
			} catch {
				continue; // not in that group any more, or a transient error
			}
			for (const participant of meta.participants) {
				const target = wanted.has(participant.id)
					? participant.id
					: participant.phoneNumber && wanted.has(participant.phoneNumber)
					? participant.phoneNumber
					: null;
				if (!target) continue;
				try {
					await client.groupParticipantsUpdate(groupId, [participant.id], 'remove');
					await client.sendMessage(groupId, {
						text: `\`\`\`@${target.split('@')[0]} is detected from AutoKick, now kicking loser.\`\`\``,
						mentions: [participant.id],
					});
				} catch {
					// not an admin (or WhatsApp refused): try again on a later sweep without spamming the group
				}
			}
		}
	} catch {
		// database busy or connection gone, next sweep retries
	} finally {
		running = false;
	}
};

export async function AutoKick(msg) {
	if (!isJidGroup(msg.from)) return;
	client = msg.client;
	if (timer) return;
	timer = setInterval(sweep, 15000);
	timer.unref?.();
}

import { areJidsSameUser, isJidGroup } from 'baileys';
import { isSudo, isAntiTagSwEnabled, addTagSwWarn, resetTagSwWarn } from '#sql';
import { config } from '#config';

export async function AntiTagSw(msg) {
	if (!isJidGroup(msg.from)) return;
	if (!msg.sender || !msg.message) return;
	if (areJidsSameUser(msg.sender, msg.user) || (await isSudo(msg.sender, msg.user)) || msg.isAdmin) return;

	const isStatusMention =
		msg.type === 'groupStatusMentionMessage' || !!msg.message?.groupStatusMentionMessage;
	if (!isStatusMention) return;

	if (!(await isAntiTagSwEnabled(msg.from))) return;

	if (msg.isBotAdmin) {
		try {
			await msg.client.sendMessage(msg.from, { delete: msg?.key });
		} catch {
			// message may already be gone, ignore
		}
	}

	const { warnings } = await addTagSwWarn(msg.from, msg.sender);
	const limit = Number(config.WARN_COUNT) || 3;

	if (warnings >= limit) {
		await resetTagSwWarn(msg.from, msg.sender);

		if (msg.isBotAdmin) {
			try {
				await msg.client.groupParticipantsUpdate(msg.from, [msg.sender], 'remove');
				await msg.send(
					`\`\`\`🚫 Anti Status-Tag\n\n@${msg.sender.split('@')[0]} mentioned/tagged a status ${limit}x and has been removed.\`\`\``,
					{ mentions: [msg.sender] }
				);
			} catch {
				await msg.send(
					`\`\`\`🚫 Anti Status-Tag\n\n@${msg.sender.split('@')[0]} hit ${limit} warnings, but I couldn't remove them.\`\`\``,
					{ mentions: [msg.sender] }
				);
			}
		} else {
			await msg.send(
				`\`\`\`🚫 Anti Status-Tag\n\n@${msg.sender.split('@')[0]} hit ${limit} warnings. Make me admin so I can remove them.\`\`\``,
				{ mentions: [msg.sender] }
			);
		}
	} else {
		await msg.send(
			`\`\`\`🚫 Anti Status-Tag\n\n@${msg.sender.split('@')[0]} please don't tag/mention statuses here.\nWarning ${warnings}/${limit}\`\`\``,
			{ mentions: [msg.sender] }
		);
	}
}

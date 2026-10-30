import { TAG_LIMIT } from '#bot';
import { bot } from '#lib';
import { GUARD_ACTIONS, getGuard, isSudo, setGuard } from '#sql';

// antitag, antisticker, antimedia, antidocument and antigroupstatus take the same options, so one block makes them all
const GUARDS = [
	{ name: 'antitag', type: 'tag', title: 'AntiTag', what: `tagging ${TAG_LIMIT} or more members at once` },
	{ name: 'antisticker', type: 'sticker', title: 'AntiSticker', what: 'stickers' },
	{ name: 'antimedia', type: 'media', title: 'AntiMedia', what: 'photos, videos and audio' },
	{ name: 'antidocument', type: 'document', title: 'AntiDocument', what: 'documents' },
	{ name: 'antigroupstatus', type: 'groupstatus', title: 'AntiGroupStatus', what: 'group statuses' }
];

const prefixOf = message => Array.from(message.prefix || '.')[0] || '.';

for (const guard of GUARDS) {
	bot(
		{
			pattern: guard.name,
			public: true,
			isGroup: true,
			desc: `${guard.title}: no ${guard.what} (on / off / set delete | kick | warn)`,
			type: 'group'
		},
		async (message, match) => {
			const prefix = prefixOf(message);
			const jid = message.jid;
			const [option, value] = (match || '').trim().toLowerCase().split(/\s+/);
			const row = await getGuard(jid, guard.type);
			const on = !!row?.enabled;
			const action = row?.action || 'delete';

			const usage = [
				`\`\`\`${guard.title.toUpperCase()} SETUP`,
				'',
				`${prefix}${guard.name} on`,
				`${prefix}${guard.name} set delete | kick | warn`,
				`${prefix}${guard.name} off`,
				`${prefix}${guard.name} get`,
				'```',
				`_Blocks ${guard.what} from members who are not admins. The message is deleted, then: delete = nothing more, kick = the member is removed, warn = a warning, removal after ${Number(process.env.WARN_COUNT) || 'a few'} of them._`
			].join('\n');

			if (!option) return message.send(usage);

			if (option === 'get' || option === 'status') {
				return message.send(`*_${guard.title} Configuration:_*\nStatus: ${on ? 'ON' : 'OFF'}\nAction: ${on ? action : 'Not set'}`);
			}

			if (!['on', 'off', 'set'].includes(option)) return message.send(usage);
			if (!(message.isAdmin || (await isSudo(message.sender, message.user)))) {
				return message.send('```For Group Admins Only!```');
			}

			// it can only delete or remove when the bot is an admin of the group
			const adminNote = message.isBotAdmin ? '' : '\n_I am not an admin in this group, so I cannot delete or remove anyone yet. Make me admin._';

			if (option === 'on') {
				if (on) return message.send(`*_${guard.title} is already on_*`);
				await setGuard(jid, guard.type, { enabled: true });
				return message.send(`*_${guard.title} has been turned ON_*\nAction: ${action}${adminNote}`);
			}

			if (option === 'off') {
				if (!on) return message.send(`*_${guard.title} is already off_*`);
				await setGuard(jid, guard.type, { enabled: false });
				return message.send(`*_${guard.title} has been turned OFF_*`);
			}

			// set
			if (!value) return message.send(`*_Please specify an action: ${prefix}${guard.name} set delete | kick | warn_*`);
			if (!GUARD_ACTIONS.includes(value)) return message.send('*_Invalid action. Choose delete, kick, or warn._*');
			if (on && action === value) return message.send(`*_${guard.title} action is already set to ${value}_*`);
			await setGuard(jid, guard.type, { enabled: true, action: value });
			return message.send(`*_${guard.title} action set to ${value}_*${on ? '' : '\n_It is ON now._'}${adminNote}`);
		}
	);
}

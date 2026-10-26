import { isSudo, isBanned, isCmdDisabled, getNoPrefix } from '#sql';
import { getConfigValues } from './events.js';
import { areJidsSameUser, isJidGroup } from 'baileys';
import { delay } from '#utils';

const commands = [];

async function bot(cmd, func) {
	cmd.function = func;
	cmd.pattern = new RegExp(`^(${cmd.pattern})(?:\\s+([\\s\\S]+))?$`, 'i');
	cmd.public = cmd.public || false;
	cmd.isGroup = cmd.isGroup || false;
	cmd.dontAddCommandList = cmd.dontAddCommandList || false;
	commands.push(cmd);
	return cmd;
}

/**
 * Runs the command that `text` asks for.
 *   prefix  what the message started with. '' means it was typed without one, which only happens while the
 *           prefix is switched off (see the prefix command). Then nothing is said when the message turns out
 *           not to be for the bot: it is probably just chat that happens to start with a command word.
 * Returns true when the message was dealt with as a command.
 */
async function runCommand(text, prefix, msg, client, Message, db) {
	const bare = prefix === '';
	// a refusal: spoken for a real command, silent for a bare word (the message then falls through as plain chat)
	const refuse = async reply => {
		if (bare) return false;
		if (reply) await msg.send(reply);
		return true;
	};

	for (const cmd of commands) {
		if (cmd.on) continue; // listeners have no pattern of their own
		const match = text.match(cmd.pattern);
		if (!match) continue;

		const Msg = {
			...msg,
			prefix: prefix,
			command: `${prefix}${match[2]}`
		};
		if (isJidGroup(msg.from) && db.disablegc && `${prefix}${match[2]}` !== `${prefix}enablegc`) return refuse();
		if (!isJidGroup(msg.from) && db.disabledm && !areJidsSameUser(msg.chat, msg.user)) return refuse();
		if (await isCmdDisabled(Msg.command.replace(/[^a-zA-Z0-9]/g, ''))) return refuse('```This command is disabled```');

		const sudo = await isSudo(msg.sender, msg.user);
		const banned = await isBanned(msg.sender);
		const args = match[2] ?? '';

		if (db.mode && !sudo) return refuse();
		if (banned) return refuse('```You are banned from using commands!```');
		if (cmd.isGroup && !isJidGroup(msg.from)) return refuse('```This Command is for Groups```');
		if (!db.mode && !cmd.public && !sudo) return refuse('```For My Owners Only!```');
		if (db.cmdReact) await Message.react('🌀');
		if (db.cmdRead) await client.readMessages([msg.key]);
		if (db.autoType) {
			try {
				await client.sendPresenceUpdate('composing', msg.from);
				await delay(6000);
			} catch {
				// presence updates can fail silently, not worth blocking the reply for
			}
		} else if (db.autoRecord) {
			try {
				await client.sendPresenceUpdate('recording', msg.from);
				await delay(6000);
			} catch {
				// presence updates can fail silently, not worth blocking the reply for
			}
		}

		try {
			await cmd.function(Message, args, { ...Message });
			await Message.react('💫');
		} catch (err) {
			await Message.react('💔');
			await msg.error(cmd, err);
		}
		return true;
	}
	return false;
}

const Plugins = async (msg, client, Message) => {
	if (!msg.body) return;
	const db = await getConfigValues();
	const prefix = Array.from(db.PREFIX).find(p => msg.body.startsWith(p));

	// ".menu": only commands are looked at, listeners (cmd.on) never see a prefixed message
	if (prefix) {
		await runCommand(msg.body.slice(prefix.length), prefix, msg, client, Message, db);
		return;
	}

	// "menu" / "Menu": with the prefix switched off a plain word can be a command as well
	if ((await getNoPrefix()) && (await runCommand(msg.body, '', msg, client, Message, db))) return;

	for (const cmd of commands) {
		if (cmd.on) await cmd.function(Message, msg.body, msg, client);
	}
};

export { commands, bot, Plugins };

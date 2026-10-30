import { isSudo, isBanned, isCmdDisabled, getNoPrefix } from '#sql';
import { getConfigValues } from './events.js';
import { areJidsSameUser, isJidBroadcast, isJidGroup } from 'baileys';

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
 * autotype / autorecord: the "typing..." / "recording audio..." indicator for messages that are NOT commands.
 * Commands are never delayed by it and never wait for it, the indicator is sent and forgotten. (The chatbot
 * has its own typing: it shows it while it thinks, then answers.)
 */
const PRESENCE_MS = 8000; // how long the indicator stays before it is paused again
const RESEND_MS = 4000; // a busy chat gets the indicator again after this long
const NOT_CHAT = new Set([
	'protocolMessage',
	'reactionMessage',
	'encReactionMessage',
	'pollUpdateMessage',
	'senderKeyDistributionMessage'
]);
const presence = new Map(); // chat -> { timer that pauses the indicator, time it was last sent }

function showPresence(client, msg, db, Message) {
	const state = db.autoType ? 'composing' : db.autoRecord ? 'recording' : null;
	const jid = msg.from;
	if (!state || !jid || !msg.type || NOT_CHAT.has(msg.type) || msg.key?.fromMe) return;
	if (isJidBroadcast(jid) || jid.endsWith('@newsletter')) return;
	// the bot's own "disable group chats / private chats" switches apply here as well
	if (isJidGroup(jid) ? db.disablegc : db.disabledm && !areJidsSameUser(msg.chat, msg.user)) return;

	const now = Date.now();
	const before = presence.get(jid);
	if (before) clearTimeout(before.timer);

	let at = before ? before.at : -Infinity;
	if (now - at > RESEND_MS) {
		at = now;
		client.sendPresenceUpdate(state, jid).catch(() => {}); // not waited for: the reply is never held back
	}

	const timer = setTimeout(() => {
		presence.delete(jid);
		// the chatbot types for as long as it thinks (it marks the message with `typing`), leave that to it
		if (!Message?.typing) client.sendPresenceUpdate('paused', jid).catch(() => {});
	}, PRESENCE_MS);
	timer.unref?.();
	presence.set(jid, { timer, at });
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
	const db = await getConfigValues();
	const prefix = msg.body ? Array.from(db.PREFIX).find(p => msg.body.startsWith(p)) : undefined;

	// ".menu": only commands are looked at, listeners (cmd.on) never see a prefixed message
	if (prefix) {
		await runCommand(msg.body.slice(prefix.length), prefix, msg, client, Message, db);
		return;
	}

	// "menu" / "Menu": with the prefix switched off a plain word can be a command as well
	if (msg.body && (await getNoPrefix()) && (await runCommand(msg.body, '', msg, client, Message, db))) return;

	// not a command: show typing / recording (if switched on) while the message is dealt with
	showPresence(client, msg, db, Message);

	if (!msg.body) return;
	for (const cmd of commands) {
		if (cmd.on) await cmd.function(Message, msg.body, msg, client);
	}
};

export { commands, bot, Plugins };

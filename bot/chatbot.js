/**
 * Chatbot: answers people with an AI.
 *
 *   private chats  every text message that is not a command
 *   groups         only when someone @mentions the bot, or replies to one of its messages
 *
 * Switched with the `chatbot` command (on/off, gc on/off, dm on/off), see plugins/chatbot.js.
 * Every answer comes from T3ai: POST { message, instruction } as JSON.
 */
import { areJidsSameUser, isJidBroadcast } from 'baileys';
import { config } from '#config';
import { getChatbot, getConfig, isBanned, isSudo } from '#sql';

export const T3ai = 'https://api-xbha.onrender.com/api/chat';

const TIMEOUT_MS = 40_000; // the API sleeps on free hosting, the first request after a nap is slow
const ATTEMPTS = 2;
const COOLDOWN_MS = 3000; // one reply per person every 3 seconds
const CHAT_LIMIT = 10; // and at most this many replies in one chat per minute, so two bots cannot talk each other into a loop
const MAX_INPUT = 1500;
const MAX_REPLY = 4000;

const MEMORY_TURNS = 6; // exchanges the bot remembers per person
const MEMORY_CLIP = 300; // characters kept of each remembered line
const MEMORY_TTL_MS = 30 * 60_000;
const MEMORY_MAX = 100; // people remembered at once

const TEXT_TYPES = new Set(['conversation', 'extendedTextMessage']);

const FALLBACKS = [
	'😴 My brain is a bit slow right now, try again in a moment.',
	"Hmm, I couldn't think of an answer. Ask me again?",
	'⚠️ I could not reach my AI just now, please try again shortly.'
];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

const botName = () => (config.BOT_INFO || '').split(';')[1]?.trim() || 'T3rri Bot';
const ownerName = () => (config.BOT_INFO || '').split(';')[0]?.trim() || 'T3rri';

const baseInstruction = () =>
	`You are ${botName()}, a friendly, helpful assistant chatting with people on WhatsApp. Your owner is ${ownerName()}. ` +
	'Reply in the language the person writes in. Keep answers short and natural, like a chat message. ' +
	'Use plain text (WhatsApp *bold* and _italic_ are fine), no markdown headings or tables.';

/* ───────────────────────────── reading the API's answer ───────────────────────────── */

// Field names a chat API usually answers in, most specific first ("message" is last, it is often just a status).
const REPLY_FIELDS = ['response', 'reply', 'answer', 'result', 'output', 'text', 'content', 'data', 'message'];

export function extractReply(payload, depth = 0) {
	if (typeof payload === 'string') return payload.trim();
	if (!payload || typeof payload !== 'object' || depth > 3) return '';
	const choice = payload.choices?.[0]?.message?.content ?? payload.choices?.[0]?.text;
	if (typeof choice === 'string' && choice.trim()) return choice.trim();
	for (const field of REPLY_FIELDS) {
		const found = extractReply(payload[field], depth + 1);
		if (found) return found;
	}
	return '';
}

// WhatsApp writes bold as *x*, models write **x** and "# Heading"
export function toWhatsApp(text) {
	return text
		.replace(/\r\n?/g, '\n')
		.replace(/\*\*(.+?)\*\*/gs, '*$1*')
		.replace(/^#{1,6}\s+(.+)$/gm, '*$1*')
		.trim();
}

async function askApi(message, instruction) {
	let failure;
	for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
		try {
			const res = await fetch(T3ai, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ message, instruction }),
				signal: AbortSignal.timeout(TIMEOUT_MS)
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const raw = await res.text();
			let payload = raw;
			try {
				payload = JSON.parse(raw);
			} catch {
				// not JSON: the body itself is the answer
			}
			const answer = toWhatsApp(extractReply(payload));
			if (!answer) throw new Error(`no answer in the response: ${clip(raw, 200)}`);
			return clip(answer, MAX_REPLY);
		} catch (err) {
			failure = err;
			if (attempt < ATTEMPTS) await sleep(2500);
		}
	}
	throw failure;
}

/* ───────────────────────────── memory, cooldowns ───────────────────────────── */

const memory = new Map(); // key -> { turns: [{ from: 'user' | 'bot', text }], at }
const lastReply = new Map(); // key -> time of the last reply
const chatReplies = new Map(); // jid -> times of the replies in the last minute

const remember = (key, from, text) => {
	const entry = memory.get(key) || { turns: [], at: 0 };
	entry.turns.push({ from, text: clip(text, MEMORY_CLIP) });
	entry.turns = entry.turns.slice(-MEMORY_TURNS * 2);
	entry.at = Date.now();
	memory.delete(key); // re-insert: the Map then keeps the longest unused person first
	memory.set(key, entry);
	while (memory.size > MEMORY_MAX) memory.delete(memory.keys().next().value);
};

const recall = key => {
	const entry = memory.get(key);
	if (!entry) return [];
	if (Date.now() - entry.at > MEMORY_TTL_MS) {
		memory.delete(key);
		return [];
	}
	return entry.turns;
};

/** Forgets everything the chatbot remembers (used when it is switched off). */
export const clearChatbotMemory = () => {
	memory.clear();
	lastReply.clear();
	chatReplies.clear();
};

const withinLimits = (key, jid) => {
	const now = Date.now();
	if (now - (lastReply.get(key) || 0) < COOLDOWN_MS) return false;
	const recent = (chatReplies.get(jid) || []).filter(at => now - at < 60_000);
	if (recent.length >= CHAT_LIMIT) return false;
	lastReply.set(key, now);
	recent.push(now);
	chatReplies.set(jid, recent);
	if (lastReply.size > 500) {
		for (const [k, at] of lastReply) if (now - at > 60_000) lastReply.delete(k);
		for (const [j, list] of chatReplies) if (!list.some(at => now - at < 60_000)) chatReplies.delete(j);
	}
	return true;
};

/* ───────────────────────────── the handler ───────────────────────────── */

/** Should this message get an answer? Returns the text to answer, or null. */
async function pickMessage(message) {
	if (message.fromMe || !message.text || !TEXT_TYPES.has(message.mtype)) return null;
	if (isJidBroadcast(message.jid) || message.jid.endsWith('@newsletter')) return null; // statuses, channels

	const settings = await getChatbot();
	if (!settings.enabled || !(message.isGroup ? settings.gc : settings.dm)) return null;

	// the bot's own "disable group chats / private chats" switches apply to the chatbot as well
	const { disablegc, disabledm } = await getConfig();
	if (message.isGroup) {
		if (disablegc) return null;
	} else if (disabledm && !areJidsSameUser(message.data?.chat || message.jid, message.user)) {
		return null;
	}

	if (message.isGroup) {
		const mentioned = (message.mention || []).some(jid => areJidsSameUser(jid, message.user));
		const repliedToBot = !!message.reply_message?.fromMe;
		if (!mentioned && !repliedToBot) return null;
	}

	const text = message.text
		.replace(/@\d{5,}/g, ' ') // the @mention of the bot itself
		.replace(/\s+/g, ' ')
		.trim();
	if (!text) return null;
	if (/^\$\s/.test(message.text) && (await isSudo(message.sender, message.user))) return null; // the owner's `$ code` console

	if (await isBanned(message.sender)) return null;
	return clip(text, MAX_INPUT);
}

async function reply(message, text) {
	const { client, jid } = message;
	const key = message.isGroup ? `${jid}:${message.sender}` : jid;

	let instruction = baseInstruction();
	if (message.pushName) instruction += ` The person you are talking to is called ${message.pushName}.`;
	const turns = recall(key);
	if (turns.length) {
		instruction +=
			'\n\nThe conversation so far (oldest first):\n' +
			turns.map(turn => `${turn.from === 'user' ? 'Person' : 'You'}: ${turn.text}`).join('\n');
	}

	const presence = async state => {
		try {
			await client.sendPresenceUpdate(state, jid);
		} catch {
			// presence is only decoration
		}
	};

	await presence('composing');
	let answer;
	let failed = false;
	try {
		answer = await askApi(text, instruction);
	} catch (err) {
		failed = true;
		console.log('[chatbot] the API did not answer:', err?.message || err);
		answer = FALLBACKS[Math.floor(Math.random() * FALLBACKS.length)];
	}
	await presence('paused');

	// groups: quote the message so people can see whom the bot is answering
	const options = message.isGroup ? { quoted: { key: message.key, message: message.message } } : {};
	await client.sendMessage(jid, { text: answer }, options);

	if (!failed) {
		remember(key, 'user', text);
		remember(key, 'bot', answer);
	}
}

/**
 * Called for every message that is not a command (plugins/chatbot.js). Decides quickly, then answers in the
 * background, so a slow AI never holds up the bot's other handlers.
 */
export async function Chatbot(message) {
	const text = await pickMessage(message);
	if (!text) return;

	const key = message.isGroup ? `${message.jid}:${message.sender}` : message.jid;
	if (!withinLimits(key, message.jid)) return;

	reply(message, text).catch(err => console.log('[chatbot] could not reply:', err?.message || err));
}

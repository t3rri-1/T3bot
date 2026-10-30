/**
 * Direct access to the interactive builders, and Meta-AI-style answers.
 *
 * Button, ButtonV2, Carousel, AIRich and Toolkit are also put on globalThis, so a plugin can use them with
 * no import at all. The socket is optional too, the live one is filled in for you:
 *
 *   await new Button().setBody('Pick one').addReply('Menu', '.menu').send(message.jid);
 *   await new AIRich().addText('**Hello**').addSuggest(['Tell me more']).send(message.jid);
 *
 * `new Button(message.client)` still works everywhere it is used today.
 *
 * One Meta-AI-looking message from markdown (text, code blocks, tables, links, sources, follow-up pills):
 *
 *   await message.sendRich(markdown, { suggestions: ['Tell me more'] });
 */
import * as raw from './button.js';

// button.js is left untouched. The classes below shadow its Button, ButtonV2, Carousel and AIRich
// (a name exported here wins over the same name coming through `export *`).
export * from './button.js';

let live = null;

/** Remembers the socket that `new Button()` and friends use when none is passed in. */
export const useClient = client => {
	if (client && typeof client.relayMessage === 'function') live = client;
	return live;
};

const socket = client => {
	const sock = client ?? live;
	if (!sock) throw new Error('Socket is required');
	return sock;
};

export class Button extends raw.Button {
	constructor(client) {
		super(socket(client));
	}
}

export class ButtonV2 extends raw.ButtonV2 {
	constructor(client) {
		super(socket(client));
	}
}

export class Carousel extends raw.Carousel {
	constructor(client) {
		super(socket(client));
	}
}

export class AIRich extends raw.AIRich {
	constructor(client, options) {
		super(socket(client), options);
	}
}

Object.assign(globalThis, { Button, ButtonV2, Carousel, AIRich, Toolkit: raw.Toolkit });

/* ───────────────────────────── markdown -> blocks ───────────────────────────── */

const FENCE_OPEN = /^\s*(`{3,}|~{3,})\s*([\w+#.-]*)[^\n]*$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/;

const LANGUAGES = {
	js: 'javascript',
	jsx: 'javascript',
	mjs: 'javascript',
	cjs: 'javascript',
	node: 'javascript',
	nodejs: 'javascript',
	ts: 'typescript',
	tsx: 'typescript',
	py: 'python',
	python3: 'python',
	go: 'golang',
	'c++': 'cpp',
	cc: 'cpp',
	rs: 'rust',
	sh: 'bash',
	shell: 'bash',
	zsh: 'bash',
	console: 'bash',
	md: 'markdown',
	htm: 'html',
	xml: 'html'
};

export const codeLanguage = name => {
	const lang = String(name || '').toLowerCase();
	return LANGUAGES[lang] || lang || 'text';
};

const splitRow = line => {
	let row = line.trim();
	if (row.startsWith('|')) row = row.slice(1);
	if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1);
	return row.split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, '|'));
};

const isTableAt = (lines, i) =>
	lines[i]?.includes('|') && lines[i + 1]?.includes('|') && TABLE_SEPARATOR.test(lines[i + 1]);

/**
 * Splits markdown into the parts an AI answer is made of:
 *   { type: 'text', text }  { type: 'code', language, code }  { type: 'table', rows }  (rows[0] is the header)
 */
export function parseMarkdown(input) {
	const lines = String(input ?? '')
		.replace(/\r\n?/g, '\n')
		.split('\n');
	const blocks = [];
	let text = [];

	const flush = () => {
		const body = text.join('\n').trim();
		if (body) blocks.push({ type: 'text', text: body });
		text = [];
	};

	for (let i = 0; i < lines.length; i++) {
		const fence = lines[i].match(FENCE_OPEN);
		// "```like this```" on one line is inline code, not the start of a block
		if (fence && !lines[i].includes(fence[1], lines[i].indexOf(fence[1]) + fence[1].length)) {
			flush();
			const close = new RegExp(`^\\s*${fence[1][0] === '`' ? '`' : '~'}{${fence[1].length},}\\s*$`);
			const code = [];
			for (i++; i < lines.length && !close.test(lines[i]); i++) code.push(lines[i]);
			blocks.push({ type: 'code', language: fence[2] || '', code: code.join('\n') });
			continue;
		}

		if (isTableAt(lines, i)) {
			flush();
			const rows = [splitRow(lines[i])];
			for (i += 2; i < lines.length && lines[i].includes('|') && lines[i].trim(); i++) rows.push(splitRow(lines[i]));
			i--;
			blocks.push({ type: 'table', rows });
			continue;
		}

		text.push(lines[i]);
	}
	flush();
	return blocks;
}

const LINK = /(?<!!)\[([^\]\n]{1,80})\]\((https?:\/\/[^\s)]+)\)/g;

/** The distinct http(s) links of some markdown, as the source chips Meta AI shows under an answer. */
export function collectSources(markdown, max = 5) {
	const seen = new Set();
	const sources = [];
	for (const [, label, url] of String(markdown ?? '').matchAll(LINK)) {
		if (seen.has(url)) continue;
		let host;
		try {
			host = new URL(url).hostname.replace(/^www\./, '');
		} catch {
			continue;
		}
		seen.add(url);
		sources.push({
			icon: `https://www.google.com/s2/favicons?domain=${host}&sz=64`,
			url,
			title: label.trim() || host,
			subtitle: host
		});
		if (sources.length >= max) break;
	}
	return sources;
}

const cleanSuggestions = (list = [], max = 3) => {
	const out = [];
	for (const item of Array.isArray(list) ? list : [list]) {
		const text = String(item ?? '')
			.replace(/\s+/g, ' ')
			.trim();
		if (text && text.length <= 80 && !out.includes(text)) out.push(text);
		if (out.length >= max) break;
	}
	return out;
};

/* ───────────────────────────── the Meta-AI-style message ───────────────────────────── */

/**
 * Builds an AIRich message from markdown.
 *   suggestions  follow-up pills under the answer (max 3)
 *   sources      add a source chip for every markdown link (default true)
 *   actions      footer buttons, [{ text, url }]
 *   title        small disclaimer line, footer: small grey line at the end
 */
export function richFromMarkdown(client, markdown, { suggestions, sources = true, actions, title, footer } = {}) {
	// no "[ UNSUPPORTED_TYPE ]" lines for the parts an old WhatsApp cannot draw: it just shows the text
	const rich = new AIRich(client, { unsupportedTypeAlert: false });
	const blocks = parseMarkdown(markdown);

	let added = 0;
	for (const block of blocks) {
		if (block.type === 'code') {
			if (!block.code.trim()) continue;
			rich.addCode(codeLanguage(block.language), block.code);
		} else if (block.type === 'table') {
			rich.addTable(block.rows);
		} else {
			rich.addText(block.text);
		}
		added++;
	}
	if (!added) throw new Error('Nothing to send');

	if (sources) {
		const found = collectSources(
			blocks
				.filter(block => block.type === 'text')
				.map(block => block.text)
				.join('\n')
		);
		if (found.length) rich.addSource(found);
	}
	if (actions?.length) rich.addFooterAction(actions);

	const pills = cleanSuggestions(suggestions);
	if (pills.length) rich.addSuggest(pills);

	if (title) rich.setTitle(title);
	if (footer) rich.setFooter(footer);
	return rich;
}

/** Sends markdown as one Meta-AI-style message. Resolves with the sent message. */
export async function sendRich(client, jid, markdown, { quoted, ...options } = {}) {
	const { suggestions, sources, actions, title, footer, ...sendOptions } = options;
	const rich = richFromMarkdown(client, markdown, { suggestions, sources, actions, title, footer });
	return rich.send(jid, { ...(quoted ? { quoted } : {}), ...sendOptions });
}

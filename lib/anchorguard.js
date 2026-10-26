/**
 * AnchorGuard: finds "bug" messages (payloads made to freeze or crash WhatsApp: huge texts, floods of
 * invisible characters, thousands of mentions, absurdly nested or oversized structures) and removes them.
 *
 * Ported from the uploaded anchorguard.js. What changed on the way:
 *   - the invisible-character pattern had lost its first character, so it matched a plain "-" and missed the
 *     zero-width space. It is written with \u escapes now, so an editor can no longer eat it.
 *   - binary fields (thumbnails, sidecars, media keys) count as one value. Walking them byte by byte made an
 *     ordinary photo with a big sidecar look like a 20 000 node structure.
 *   - "circular" only fires for a real cycle, not for an object that is referenced twice.
 *   - the verdict is cached per message, so the message handler can ask again for free.
 *   - the bot's own echoes (type "append") are not scanned, only what other people send.
 */

export const ANTIBUG_DEFAULTS = {
	maxText: 65536,
	maxCaption: 32768,
	maxMentions: 1500,
	maxGroupMentions: 200,
	maxButtons: 100,
	maxSections: 100,
	maxRows: 300,
	maxCards: 60,
	maxDepth: 12,
	maxNodes: 20000,
	maxBytes: 3 * 1024 * 1024,
	maxParamsJson: 262144,
	maxInvisibleRun: 500,
	maxCombiningRun: 100,
	maxNewlines: 20000
};

// zero-width space/joiners/marks, bidi controls, invisible operators, BOM, interlinear annotation
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u206A-\u206F\uFEFF\uFFF9-\uFFFB]/;
// combining marks (the "zalgo" text family)
const COMBINING =
	/[\u0300-\u036F\u0483-\u0489\u0591-\u05BD\u0610-\u061A\u064B-\u065F\u06D6-\u06DC\u06DF-\u06E4\u0E31\u0E34-\u0E3A\u0EB1\u0EB4-\u0EBC\u1AB0-\u1AFF\u1DC0-\u1DFF\u20D0-\u20FF\uFE20-\uFE2F]/;

const longestRun = (text, matcher) => {
	let run = 0;
	let best = 0;
	for (const ch of text) {
		if (matcher.test(ch)) {
			run += 1;
			if (run > best) best = run;
		} else {
			run = 0;
		}
	}
	return best;
};

const countChar = (text, ch) => {
	let n = 0;
	for (let i = 0; i < text.length; i += 1) {
		if (text[i] === ch) n += 1;
	}
	return n;
};

const isBinary = value => ArrayBuffer.isView(value) || value instanceof ArrayBuffer;

const unwrapContent = message => {
	let current = message;
	let depth = 0;
	const wrappers = [
		'ephemeralMessage',
		'viewOnceMessage',
		'viewOnceMessageV2',
		'viewOnceMessageV2Extension',
		'documentWithCaptionMessage',
		'editedMessage',
		'deviceSentMessage',
		'botInvokeMessage'
	];
	while (current && typeof current === 'object' && depth < 64) {
		const wrapper = wrappers.find(w => current[w]?.message);
		if (!wrapper) break;
		current = current[wrapper].message;
		depth += 1;
	}
	return { content: current, wrapDepth: depth };
};

export const detectBug = (message, options = {}) => {
	const limits = { ...ANTIBUG_DEFAULTS, ...options };
	const reasons = [];
	if (!message || typeof message !== 'object') {
		return { flagged: false, reasons };
	}
	const { content, wrapDepth } = unwrapContent(message);
	if (wrapDepth >= 6) {
		reasons.push(`wrapper nesting ${wrapDepth}`);
	}
	let nodes = 0;
	const ancestors = new WeakSet(); // objects on the way down from the root: meeting one again is a real cycle
	const walk = (value, depth) => {
		if (reasons.length > 40) return;
		nodes += 1;
		if (nodes > limits.maxNodes) {
			reasons.push(`node count > ${limits.maxNodes}`);
			return;
		}
		if (depth > limits.maxDepth) {
			reasons.push(`structure depth > ${limits.maxDepth}`);
			return;
		}
		if (typeof value === 'string') {
			if (value.length > limits.maxText) {
				reasons.push(`string length ${value.length} > ${limits.maxText}`);
			}
			if (countChar(value, '\n') > limits.maxNewlines) {
				reasons.push('excessive newlines');
			}
			const invisibleRun = longestRun(value, INVISIBLE);
			if (invisibleRun > limits.maxInvisibleRun) {
				reasons.push(`invisible-char run ${invisibleRun}`);
			}
			const combiningRun = longestRun(value, COMBINING);
			if (combiningRun > limits.maxCombiningRun) {
				reasons.push(`combining-char run ${combiningRun}`);
			}
			return;
		}
		if (isBinary(value)) {
			if (value.byteLength > limits.maxBytes) {
				reasons.push(`binary field ${value.byteLength} bytes > ${limits.maxBytes}`);
			}
			return;
		}
		if (Array.isArray(value)) {
			for (const item of value) {
				walk(item, depth + 1);
			}
			return;
		}
		if (value && typeof value === 'object') {
			if (ancestors.has(value)) {
				reasons.push('circular structure');
				return;
			}
			ancestors.add(value);
			for (const key of Object.keys(value)) {
				walk(value[key], depth + 1);
			}
			ancestors.delete(value);
		}
	};
	walk(content, 0);

	const collectContextInfo = (node, depth = 0) => {
		if (!node || typeof node !== 'object' || isBinary(node) || depth > limits.maxDepth + 2) return;
		for (const key of Object.keys(node)) {
			const child = node[key];
			if (key === 'contextInfo' && child && typeof child === 'object') {
				if (Array.isArray(child.mentionedJid) && child.mentionedJid.length > limits.maxMentions) {
					reasons.push(`mentionedJid ${child.mentionedJid.length} > ${limits.maxMentions}`);
				}
				if (Array.isArray(child.groupMentions) && child.groupMentions.length > limits.maxGroupMentions) {
					reasons.push(`groupMentions ${child.groupMentions.length} > ${limits.maxGroupMentions}`);
				}
			}
			if (child && typeof child === 'object') {
				collectContextInfo(child, depth + 1);
			}
		}
	};
	collectContextInfo(content);

	const inspectInteractive = node => {
		if (!node || typeof node !== 'object') return;
		const nativeFlow = node.nativeFlowMessage || node.interactiveMessage?.nativeFlowMessage;
		if (nativeFlow?.buttons) {
			if (nativeFlow.buttons.length > limits.maxButtons) {
				reasons.push(`nativeFlow buttons ${nativeFlow.buttons.length} > ${limits.maxButtons}`);
			}
			for (const button of nativeFlow.buttons) {
				const params = button?.buttonParamsJson;
				if (typeof params === 'string') {
					if (params.length > limits.maxParamsJson) {
						reasons.push(`buttonParamsJson length ${params.length}`);
					} else if (params.length) {
						try {
							JSON.parse(params);
						} catch {
							reasons.push('buttonParamsJson invalid');
						}
					}
				}
			}
		}
		const list = node.listMessage || node.interactiveMessage?.carouselMessage;
		if (list?.sections && list.sections.length > limits.maxSections) {
			reasons.push(`list sections ${list.sections.length} > ${limits.maxSections}`);
		}
		if (Array.isArray(list?.sections)) {
			let rows = 0;
			for (const section of list.sections) {
				rows += Array.isArray(section?.rows) ? section.rows.length : 0;
			}
			if (rows > limits.maxRows) {
				reasons.push(`list rows ${rows} > ${limits.maxRows}`);
			}
		}
		const cards = node.interactiveMessage?.carouselMessage?.cards;
		if (Array.isArray(cards) && cards.length > limits.maxCards) {
			reasons.push(`carousel cards ${cards.length} > ${limits.maxCards}`);
		}
	};
	inspectInteractive(content);

	if (typeof options.byteLength === 'number' && options.byteLength > limits.maxBytes) {
		reasons.push(`encoded size ${options.byteLength} > ${limits.maxBytes}`);
	}
	if (options.proto?.Message) {
		try {
			const encoded = options.proto.Message.encode(options.proto.Message.fromObject(message)).finish();
			if (encoded.length > limits.maxBytes) {
				reasons.push(`encoded size ${encoded.length} > ${limits.maxBytes}`);
			}
		} catch (error) {
			reasons.push(`proto encode failed: ${error.message}`);
		}
	}

	return { flagged: reasons.length > 0, reasons };
};

export const createAntiBugGuard = (sock, options = {}) => {
	const config = {
		autoDelete: true,
		deleteMode: 'auto',
		guardIncoming: true,
		guardOutgoing: true,
		blockOnBug: false,
		selfOnly: false,
		thresholds: {},
		onDetect: null,
		proto: null,
		logger: sock?.logger,
		...options
	};
	const ownJid = config.ownJid || sock?.user?.id;
	const detectOptions = { ...config.thresholds, proto: config.proto };

	// one verdict per message object, so the guard and the message handler never scan the same message twice
	const verdicts = new WeakMap();
	const inspect = message => {
		if (!message || typeof message !== 'object') return detectBug(message, detectOptions);
		let verdict = verdicts.get(message);
		if (!verdict) {
			verdict = detectBug(message, detectOptions);
			verdicts.set(message, verdict);
		}
		return verdict;
	};

	const report = async detail => {
		try {
			await config.onDetect?.(detail);
		} catch (error) {
			config.logger?.warn?.({ error: error.message }, 'anti-bug onDetect failed');
		}
	};

	const removeMessage = async (jid, key) => {
		if (!config.autoDelete) return;
		const revoke = config.deleteMode === 'everyone' || (config.deleteMode === 'auto' && key?.fromMe);
		try {
			if (revoke) {
				await sock.sendMessage(jid, { delete: key });
			} else if (typeof sock.chatModify === 'function') {
				await sock.chatModify({ deleteForMe: { key, timestamp: Date.now(), deleteMedia: false } }, jid);
			}
		} catch (error) {
			config.logger?.warn?.({ error: error.message }, 'anti-bug delete failed');
		}
	};

	const maybeBlock = async (jid, key) => {
		if (!config.blockOnBug || key?.fromMe || typeof sock.updateBlockStatus !== 'function') return;
		try {
			await sock.updateBlockStatus(typeof sock.getJid === 'function' ? sock.getJid(jid) : jid, 'block');
		} catch (error) {
			config.logger?.warn?.({ error: error.message }, 'anti-bug block failed');
		}
	};

	const handleUpsert = async ({ messages, type }) => {
		if (!config.guardIncoming || !Array.isArray(messages)) return;
		for (const msg of messages) {
			const content = msg?.message;
			if (!content) continue;
			if (type === 'append' && msg.key?.fromMe) continue; // the bot's own sends echoing back
			const jid = msg.key?.remoteJid;
			if (config.selfOnly && jid !== ownJid && !msg.key?.fromMe) continue;
			const result = inspect(content);
			if (!result.flagged) continue;
			const sender = msg.key?.participant || jid;
			config.logger?.warn?.({ jid, sender, reasons: result.reasons }, 'anti-bug flagged incoming message');
			await report({ direction: 'incoming', message: msg, jid, sender, reasons: result.reasons });
			await removeMessage(jid, msg.key);
			await maybeBlock(sender, msg.key);
		}
	};

	if (config.guardIncoming && sock?.ev?.on) {
		sock.ev.on('messages.upsert', handleUpsert);
	}

	let originalSend = null;
	if (config.guardOutgoing && typeof sock?.sendMessage === 'function') {
		originalSend = sock.sendMessage.bind(sock);
		sock.sendMessage = async (jid, content, sendOptions) => {
			const probe = inspect(content);
			if (probe.flagged) {
				config.logger?.warn?.({ jid, reasons: probe.reasons }, 'anti-bug blocked outgoing message');
				await report({ direction: 'outgoing', jid, content, reasons: probe.reasons });
				throw new Error(`anti-bug blocked outgoing message: ${probe.reasons.join('; ')}`);
			}
			return originalSend(jid, content, sendOptions);
		};
	}

	return {
		detect: inspect,
		stop: () => {
			if (config.guardIncoming && sock?.ev?.off) {
				sock.ev.off('messages.upsert', handleUpsert);
			}
			if (originalSend) {
				sock.sendMessage = originalSend;
			}
		}
	};
};

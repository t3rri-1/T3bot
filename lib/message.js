import {
	areJidsSameUser,
	getContentType,
	isJidGroup,
	isLidUser,
	isPnUser,
	jidNormalizedUser,
	normalizeMessageContent
} from 'baileys';
import { getConfigValues } from './events.js';

const META_TTL = 90_000;
const META_MAX = 64;
const metaCache = new Map();
const metaInflight = new Map();

export const invalidateGroupMeta = jid => {
	if (jid) metaCache.delete(jid);
	else metaCache.clear();
};

const getGroupMeta = async (conn, jid) => {
	const hit = metaCache.get(jid);
	if (hit && hit.conn === conn && hit.exp > Date.now()) return hit.data;
	if (metaInflight.has(jid)) return metaInflight.get(jid);

	const request = conn
		.groupMetadata(jid)
		.then(data => {
			data?.participants?.forEach(p => conn.participantJid(p));
			metaCache.delete(jid);
			metaCache.set(jid, { data, conn, exp: Date.now() + META_TTL });
			if (metaCache.size > META_MAX) metaCache.delete(metaCache.keys().next().value);
			return data;
		})
		.finally(() => metaInflight.delete(jid));
	metaInflight.set(jid, request);
	return request;
};

// group members come as { id, lid, phoneNumber, admin }, the id is the @lid or the phone number depending on the group
const findMember = (participants, ids) => {
	const wanted = new Set(ids.filter(Boolean).map(id => jidNormalizedUser(id)));
	return participants.find(p => [p.id, p.lid, p.phoneNumber, p.jid].some(id => id && wanted.has(id)));
};

const getButtonReplyId = content => {
	const flow = content?.interactiveResponseMessage?.nativeFlowResponseMessage;
	if (flow?.paramsJson) {
		try {
			const params = JSON.parse(flow.paramsJson);
			if (params?.id) return String(params.id);
		} catch {
			// not JSON, the other formats below may still match
		}
	}
	return (
		content?.buttonsResponseMessage?.selectedButtonId ||
		content?.templateButtonReplyMessage?.selectedId ||
		content?.listResponseMessage?.singleSelectReply?.selectedRowId ||
		false
	);
};

export async function serialize(messages, conn) {
	const { key } = messages;
	const owner = jidNormalizedUser(conn.user.id);
	const ownerLid = conn.user.lid ? jidNormalizedUser(conn.user.lid) : null;
	const isGroup = isJidGroup(key.remoteJid);
	const remoteJid = isGroup ? key.remoteJid : jidNormalizedUser(key.remoteJid);
	let metadata = null;

	if (isGroup) {
		try {
			metadata = await getGroupMeta(conn, remoteJid);
		} catch {
			metadata = null; // don't let a transient metadata fetch failure drop the message
		}
	}

	// Same rules as ChiiMD: use the phone-number twin Baileys sends along (remoteJidAlt / participantAlt),
	// then the group member list, then Baileys' own LID store. The raw key stays untouched for replies.
	const chat = isPnUser(remoteJid) || isLidUser(remoteJid) ? await conn.resolveJid(remoteJid, key.remoteJidAlt) : remoteJid;
	let sender = '';
	if (key.fromMe) sender = owner;
	else if (isGroup) sender = (await conn.resolveJid(key.participant, key.participantAlt)) || '';
	else sender = chat || '';

	const msg = {
		key: {
			id: key.id,
			fromMe: key.fromMe,
			remoteJid,
			participant: isGroup ? key.participant : undefined
		},
		prefix: (await getConfigValues()).PREFIX,
		user: owner,
		from: key.remoteJid,
		chat,
		pushName: messages.pushName,
		sender,

		isGroup,
		client: conn
	};

	if (isGroup) {
		const participants = metadata?.participants || [];
		msg.isAdmin = !!findMember(participants, [key.participant, key.participantAlt, sender])?.admin;
		msg.isBotAdmin = !!findMember(participants, [owner, ownerLid])?.admin;
	}

	if (messages.message) {
		const normalizedMessage = normalizeMessageContent(messages.message);
		const type = getContentType(normalizedMessage);
		const getPollBody = normalizedMessage => {
			if (normalizedMessage?.pollCreationMessageV3) {
				const pollData = normalizedMessage.pollCreationMessageV3;
				return [pollData.name, ...pollData.options.map(option => option.optionName)].join(', ');
			}
			return false;
		};
		Object.assign(msg, {
			message: normalizedMessage,
			type,
			participant: msg.key.participant || msg.key.remoteJid,
			mention: (normalizedMessage?.[type]?.contextInfo?.mentionedJid || []).map(jid => conn.getJid(jid)),
			viewonce: normalizedMessage?.[type]?.viewOnce || false,
			body:
				normalizedMessage?.[type]?.editedMessage?.conversation ||
				normalizedMessage?.[type]?.editedMessage?.text ||
				normalizedMessage?.[type]?.editedMessage?.caption ||
				normalizedMessage?.conversation ||
				normalizedMessage?.[type]?.text ||
				normalizedMessage?.[type]?.caption ||
				getButtonReplyId(normalizedMessage) ||
				getPollBody(normalizedMessage) ||
				normalizedMessage?.eventMessage?.name ||
				false
		});
	}

	const InquotedType = getContentType(messages.message);
	const deepQuotedType = getContentType(messages.message?.[InquotedType]?.message);

	const quoted =
		messages.message?.[msg.type]?.contextInfo?.quotedMessage ||
		normalizeMessageContent(
			normalizeMessageContent(
				messages.message?.[InquotedType]?.message?.[deepQuotedType]?.contextInfo?.quotedMessage
			)
		);

	if (quoted) {
		const quotedMessage = normalizeMessageContent(quoted);
		const quotedType = getContentType(quotedMessage);
		const stanzaId =
			messages.message?.[msg.type]?.contextInfo?.stanzaId ||
			normalizeMessageContent(
				normalizeMessageContent(
					messages.message?.[InquotedType]?.message?.[deepQuotedType]?.contextInfo?.stanzaId
				)
			);
		const quotedParticipant =
			messages.message?.[msg.type]?.contextInfo?.participant ||
			messages.message?.[InquotedType]?.contextInfo?.participant;
		msg.quoted = {
			key: {
				id: normalizeMessageContent(stanzaId) || null,
				fromMe: !!quotedParticipant && areJidsSameUser(conn.getJid(quotedParticipant), owner),
				remoteJid: msg.key.remoteJid,
				participant: isGroup
					? normalizeMessageContent(messages.message?.[InquotedType]?.contextInfo?.participant)
					: undefined
			},
			sender: quotedParticipant ? conn.getJid(quotedParticipant) : chat,
			message: quotedMessage,
			type: quotedType,
			viewonce: quotedMessage?.[quotedType]?.viewOnce || false,
			isStatus: messages.message?.[msg.type]?.contextInfo?.remoteJid === 'status@broadcast',
			body:
				quotedMessage?.conversation ||
				quotedMessage?.[quotedType]?.text ||
				quotedMessage?.[quotedType]?.caption ||
				false
		};
	} else {
		msg.quoted = null;
	}

	Object.defineProperty(msg, 'client', {
		get: function () {
			return conn;
		},
		enumerable: false,
		configurable: false
	});

	Object.defineProperty(msg, 'send', {
		value: async (content, options = {}) => {
			const jid = options.jid || msg.key.remoteJid;
			const data = await conn.sendMessage(
				jid,
				{ [options.type || 'text']: content, ...options },
				{ quoted: msg || options.quoted }
			);
			return serialize(data, conn);
		},
		enumerable: false,
		writable: false,
		configurable: false
	});

	Object.defineProperty(msg, 'error', {
		value: async (cmd, error) => {
			await msg.send(
				`\`\`\`An Error Occurred while running ${
					cmd.pattern.toString().split(/\W+/)[2]
				} command!\`\`\``
			);
			const name = cmd.pattern.toString().split(/\W+/)[1] || 'UNKNOWN CMD';
			const { stack, message } = error;
			const data = await msg.send(
				`\`\`\`─━❲ ERROR REPORT ❳━─\n\nFROM: @${
					msg?.sender?.split('@')[0]
				}\nCMD: ${name}\nMESSAGE: ${message}\`\`\``,
				{ jid: owner, mentions: [msg.sender] }
			);
			return serialize(data, conn) && console.log(stack);
		},
		enumerable: false,
		writable: false,
		configurable: false
	});

	return msg;
}

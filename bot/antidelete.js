import { isJidGroup } from 'baileys';
import { getAnti, getConfig } from '#sql';
import { applyFont } from './fontlist.js';

const DeletedText = async (conn, msg, jid, deleteInfo, isGroup, update) => {
	const messageContent =
		msg.message?.conversation || msg.message?.extendedTextMessage?.text || 'Unknown content';

	// This module sends through the socket directly (not Message.send), so apply the .font setting here.
	// Only the bot's own wording is styled; the deleted message is quoted exactly as it was written.
	let fontStyle = 1;
	try {
		({ fontStyle } = await getConfig());
	} catch {
		// no config available, send plain text
	}
	const style = text => (fontStyle && fontStyle !== 1 ? applyFont(text, fontStyle) : text);
	deleteInfo = `${style(deleteInfo)}\n\n${style('*Content:*')} ${messageContent}`;

	await conn.sendMessage(
		jid,
		{
			text: deleteInfo,
			contextInfo: {
				mentionedJid: isGroup
					? [update.key.participant, msg.key.participant]
					: [update.key.remoteJid]
			}
		},
		{ quoted: msg }
	);
};

const DeletedMedia = async (conn, msg, jid) => {
	const antideletedMsg = JSON.parse(JSON.stringify(msg.message));
	const messageType = Object.keys(antideletedMsg)[0];
	if (antideletedMsg[messageType]) {
		antideletedMsg[messageType].contextInfo = {
			stanzaId: msg.key.id,
			participant: msg.sender,
			quotedMessage: msg.message
		};
	}
	await conn.relayMessage(jid, antideletedMsg, {});
};

export const AntiDelete = async (conn, updates) => {
	for (const update of updates) {
		if (update.key && (update.update.deleteMessage || update.update?.message === null)) {
			const store = await conn.loadMessage(update.key.id);

			if (store && store.message) {
				const msg = store.message;
				const isGroup = isJidGroup(store.jid);
				const antiDeleteType = isGroup ? 'gc' : 'dm';
				const antiDeleteStatus = await getAnti(antiDeleteType);
				if (!antiDeleteStatus) continue;

				const deleteTime = new Date().toLocaleTimeString('en-GB', {
					hour: '2-digit',
					minute: '2-digit',
					second: '2-digit'
				});

				let deleteInfo, jid;
				if (isGroup) {
					const groupMetadata = await conn.groupMetadata(store.jid);
					const groupName = groupMetadata.subject;
					const sender = msg.key.participant?.split('@')[0];
					const deleter = update.key.participant?.split('@')[0];

					deleteInfo = `*Antidelete Detected*\n\n*Time:* ${deleteTime}\n*Group:* ${groupName}\n*Deleted By:* @${deleter}\n*Sender:* @${sender}`;
					jid = store.jid;
				} else {
					const senderNumber = msg.key.remoteJid?.split('@')[0];
					const deleterNumber = update.key.remoteJid?.split('@')[0];

					deleteInfo = `*Antidelete Detected*\n\n*Time:* ${deleteTime}\n*Deleted By:* @${deleterNumber}\n*Sender:* @${senderNumber}`;
					jid = conn.user.id;
				}

				if (msg.message?.conversation || msg.message?.extendedTextMessage) {
					await DeletedText(conn, msg, jid, deleteInfo, isGroup, update);
				} else {
					await DeletedMedia(conn, msg, jid, deleteInfo, isGroup, update);
				}
			}
		}
	}
};

import {
	Antilink,
	AntiSpammer,
	AntiViewOnce,
	AntiWord,
	AntiTagSw,
	AutoKick,
	schedules,
	updateGroupMetadata,
	StickerCMD
} from '#bot';
import { config } from '#config';
import { readFile } from 'fs/promises';
import { getConfig } from '#sql';
import { getJson } from '#utils';
import { MessagesDebug } from './debug.js';
import { areJidsSameUser, isJidGroup } from 'baileys';

export async function getConfigValues() {
	const db_list = await getConfig();
	const {
		autoRead,
		autoStatusRead,
		cmdReact,
		cmdRead,
		autoType,
		autoRecord,
		mode,
		PREFIX,
		autolikestatus,
		statusEmoji,
		fontStyle,
		disablegc,
		disabledm
	} = db_list;
	return {
		autoRead,
		autoStatusRead,
		cmdReact,
		cmdRead,
		autoType,
		autoRecord,
		mode,
		PREFIX,
		autolikestatus,
		statusEmoji,
		fontStyle,
		disablegc,
		disabledm
	};
}

export async function getUsers() {
	return await getJson(`${config.API_ID}/api/users`);
}

export async function upserts(msg) {
	let tasks = [];
	const configValues = await getConfigValues();
	if (!msg.isGroup) {
		if (configValues.disabledm && !areJidsSameUser(msg.chat, msg.user)) return; // Ignore if disabledm is true and not the user
		tasks.push(
			AntiSpammer(msg),
			AntiViewOnce(msg),
			updateGroupMetadata(msg),
			MessagesDebug(msg),
			StickerCMD(msg)
		);
	}
	if (msg.isGroup) {
		if (isJidGroup(msg.from) && configValues.disablegc) return; // Ignore if disablegc is true in a group
		tasks.push(Antilink(msg), schedules(msg), AntiWord(msg), AutoKick(msg), AntiTagSw(msg));
	}
	await Promise.all(tasks);
}

export const logo = await readFile('./media/t3.jpg');
import { DataTypes } from 'sequelize';
import { DATABASE } from '#lib';
import { registerCache } from '../lib/memory.js';

/**
 * One row per group and guard: antitag, antisticker, antimedia, antidocument, antigroupstatus.
 *   type     tag | sticker | media | document | groupstatus
 *   action   delete | kick | warn
 *   warns    { "<member jid>": warnings }
 * A table of its own, so a bot that already has a database picks it up without any change to the others.
 */
export const GUARD_TYPES = ['tag', 'sticker', 'media', 'document', 'groupstatus'];
export const GUARD_ACTIONS = ['delete', 'kick', 'warn'];

export const AntiGuardDB = DATABASE.define(
	'AntiGuard',
	{
		id: {
			type: DataTypes.INTEGER,
			autoIncrement: true,
			primaryKey: true
		},
		jid: {
			type: DataTypes.STRING,
			allowNull: false
		},
		type: {
			type: DataTypes.STRING,
			allowNull: false
		},
		enabled: {
			type: DataTypes.BOOLEAN,
			allowNull: false,
			defaultValue: true
		},
		action: {
			type: DataTypes.STRING,
			allowNull: false,
			defaultValue: 'delete'
		},
		warns: {
			type: DataTypes.JSON,
			allowNull: true,
			defaultValue: {}
		}
	},
	{
		tableName: 'antiguard',
		timestamps: false,
		indexes: [{ unique: true, fields: ['jid', 'type'] }]
	}
);

// Every group message asks which guards are on, so the answer is kept for a few seconds
const TTL = 10_000;
const MAX_GROUPS = 300;
const cache = new Map(); // group jid -> { at, guards: Map(type -> { action }) }
registerCache('antiguard', () => cache.clear());

/** The guards that are on in a group, as a Map of type -> { action }. Never throws: on a database error the last answer is used. */
export async function getGroupGuards(jid) {
	const hit = cache.get(jid);
	if (hit && Date.now() - hit.at < TTL) return hit.guards;
	let guards = hit?.guards || new Map();
	try {
		const rows = await AntiGuardDB.findAll({ where: { jid, enabled: true } });
		guards = new Map(rows.map(row => [row.type, { action: row.action }]));
		cache.delete(jid);
		cache.set(jid, { at: Date.now(), guards });
		if (cache.size > MAX_GROUPS) cache.delete(cache.keys().next().value);
	} catch (err) {
		console.log('[antiguard] could not read the guards:', err?.message || err);
	}
	return guards;
}

/** The row of one guard in one group, or null when it was never set up. */
export const getGuard = (jid, type) => AntiGuardDB.findOne({ where: { jid, type } });

/**
 * Turns a guard on or off, and / or changes what it does.
 * @param {string} jid - group
 * @param {string} type - one of GUARD_TYPES
 * @param {{enabled?: boolean, action?: string}} changes
 */
export async function setGuard(jid, type, changes) {
	const [row] = await AntiGuardDB.findOrCreate({
		where: { jid, type },
		defaults: { jid, type, enabled: true, action: 'delete', warns: {} }
	});
	await row.update(changes);
	cache.delete(jid);
	return row;
}

// Warnings are read, changed and written back: two at the same moment (a member sending five stickers at once)
// would count as one, so they go through one at a time per guard.
const locks = new Map();
const serial = (key, work) => {
	const next = (locks.get(key) || Promise.resolve()).catch(() => {}).then(work);
	locks.set(key, next);
	const cleanup = () => {
		if (locks.get(key) === next) locks.delete(key);
	};
	next.then(cleanup, cleanup);
	return next;
};

/** One more warning for a member; returns how many they have now. */
export const addGuardWarn = (jid, type, user) =>
	serial(`${jid}:${type}`, async () => {
		const row = await AntiGuardDB.findOne({ where: { jid, type } });
		if (!row) return 0;
		const warns = { ...(row.warns || {}) };
		warns[user] = (warns[user] || 0) + 1;
		await row.update({ warns });
		return warns[user];
	});

/** Clears the warnings of a member. */
export const resetGuardWarn = (jid, type, user) =>
	serial(`${jid}:${type}`, async () => {
		const row = await AntiGuardDB.findOne({ where: { jid, type } });
		if (!row?.warns?.[user]) return;
		const warns = { ...row.warns };
		delete warns[user];
		await row.update({ warns });
	});

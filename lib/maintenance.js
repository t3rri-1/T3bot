// Housekeeping for small hosts: bounded disk use (temp files, message store) and memory relief (no restarts).
import { readdir, stat, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Op, QueryTypes } from 'sequelize';
import { DATABASE } from './database.js';
import { messageDb } from '../sql/store.js';
import { MEMORY_LIMIT_MB, RSS_HARD_MB, RSS_SOFT_MB } from './resources.js';
import { freeMemory, memoryReading } from './memory.js';

const TMP_DIR = resolve('tmp'); // index.js points TMPDIR here, nothing outside it is ever touched

const MSG_HOURS = Number(process.env.MSG_RETENTION_HOURS) || 48;
const STATUS_HOURS = Number(process.env.STATUS_RETENTION_HOURS) || 12;
const MSG_MAX_ROWS = Number(process.env.MSG_MAX_ROWS) || 3000;

// The default limits are meant for the local sqlite file; a Postgres database is only pruned when asked to.
const pruneEnabled =
	DATABASE.getDialect() === 'sqlite' || !!(process.env.MSG_RETENTION_HOURS || process.env.MSG_MAX_ROWS);

/** sqlite: WAL keeps readers and the writer out of each other's way and syncs far less often than the default journal. */
export const tuneDatabase = async () => {
	if (DATABASE.getDialect() !== 'sqlite') return;
	try {
		await DATABASE.query('PRAGMA journal_mode = WAL');
		await DATABASE.query('PRAGMA synchronous = NORMAL');
		await DATABASE.query('PRAGMA busy_timeout = 5000');
	} catch (err) {
		console.log('Could not tune the database:', err?.message || err);
	}
};

// Deleted rows only leave free pages inside the file; give the space back once enough has piled up.
const VACUUM_AFTER_MB = 24;
const shrinkDatabase = async () => {
	if (DATABASE.getDialect() !== 'sqlite') return;
	const [{ freelist_count: free }] = await DATABASE.query('PRAGMA freelist_count', { type: QueryTypes.SELECT });
	const [{ page_size: pageSize }] = await DATABASE.query('PRAGMA page_size', { type: QueryTypes.SELECT });
	if ((free * pageSize) / 1048576 > VACUUM_AFTER_MB) await DATABASE.query('VACUUM');
};

const sweep = async (dir, maxAgeMs, depth = 0) => {
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		const path = join(dir, entry.name);
		try {
			if (entry.isDirectory()) {
				if (depth < 3) await sweep(path, maxAgeMs, depth + 1);
			} else if (Date.now() - (await stat(path)).mtimeMs > maxAgeMs) {
				await rm(path, { force: true });
			}
		} catch {
			// file vanished or is in use, next sweep gets it
		}
	}
};

/** Deletes temp files older than maxAgeMs (default 15 minutes). */
export const cleanTemp = (maxAgeMs = 15 * 60_000) => sweep(TMP_DIR, maxAgeMs);

/** Keeps the message store (antidelete, quoted lookups) to a recent window instead of growing forever. */
export const pruneMessages = async () => {
	if (!pruneEnabled) return;
	const hoursAgo = hours => new Date(Date.now() - hours * 3600_000);

	// statuses expire after a day and are plentiful, so they get a shorter window
	await messageDb.destroy({
		where: { jid: 'status@broadcast', createdAt: { [Op.lt]: hoursAgo(STATUS_HOURS) } }
	});
	await messageDb.destroy({ where: { createdAt: { [Op.lt]: hoursAgo(MSG_HOURS) } } });

	if ((await messageDb.count()) > MSG_MAX_ROWS) {
		const [edge] = await messageDb.findAll({
			attributes: ['createdAt'],
			order: [['createdAt', 'DESC']],
			limit: 1,
			offset: MSG_MAX_ROWS
		});
		if (edge) await messageDb.destroy({ where: { createdAt: { [Op.lte]: edge.createdAt } } });
	}

	await shrinkDatabase();
};

// sqlite keeps pages and statements in memory; this hands them back
const shrinkSqliteMemory = async () => {
	if (DATABASE.getDialect() !== 'sqlite') return;
	await DATABASE.query('PRAGMA shrink_memory');
};

// Close to the memory limit the bot frees memory, it does not restart.
//   soft (75 % of the limit, or the heap at 80 %): the caches that are cheap to fill again are emptied, garbage is collected
//   hard (88 %, or the heap at 90 %, where it used to restart): also old temp files go and sqlite gives its memory back
let lastRelief = 0;
let lastReport = 0;
const watchMemory = async () => {
	const { rssMB, heapRatio } = memoryReading();
	const level = rssMB > RSS_HARD_MB || heapRatio > 0.9 ? 'hard' : rssMB > RSS_SOFT_MB || heapRatio > 0.8 ? 'soft' : null;
	if (!level) return;

	// soft relief at most once a minute, hard relief on every check for as long as memory stays that high
	if (level === 'soft' && Date.now() - lastRelief < 60_000) return;
	lastRelief = Date.now();

	if (level === 'hard') await cleanTemp(2 * 60_000).catch(() => {});
	await shrinkSqliteMemory().catch(() => {});
	const { rssBeforeMB, rssAfterMB } = freeMemory(level);

	// said once in a while, not on every check
	if (Date.now() - lastReport > 5 * 60_000) {
		lastReport = Date.now();
		console.log(
			`Memory ${level}: ${Math.round(rssBeforeMB)} -> ${Math.round(rssAfterMB)} MB of ${MEMORY_LIMIT_MB} MB, caches emptied and garbage collected`
		);
	}
};

export const startMaintenance = () => {
	const every = (task, ms) => {
		const timer = setInterval(() => Promise.resolve(task()).catch(() => {}), ms);
		timer.unref?.();
	};

	cleanTemp().catch(() => {});
	pruneMessages().catch(() => {});
	every(cleanTemp, 10 * 60_000);
	every(pruneMessages, 30 * 60_000);
	every(watchMemory, 30_000);
};

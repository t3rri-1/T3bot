// Housekeeping for small hosts: bounded disk use (temp files, message store) and a memory safety net.
import { readdir, stat, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Op, QueryTypes } from 'sequelize';
import { DATABASE } from './database.js';
import { messageDb } from '../sql/store.js';
import { MEMORY_LIMIT_MB, RSS_RESTART_MB } from './resources.js';

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

let highReadings = 0;
const watchMemory = () => {
	const rssMB = process.memoryUsage.rss() / 1048576;
	highReadings = rssMB > RSS_RESTART_MB ? highReadings + 1 : 0;
	// three readings in a row (90 s) so a short spike does not trigger a restart
	if (highReadings >= 3) {
		console.log(`Memory at ${Math.round(rssMB)} MB of ${MEMORY_LIMIT_MB} MB, restarting before the host kills the bot`);
		process.exit(0);
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

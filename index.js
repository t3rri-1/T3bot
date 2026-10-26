import cluster from 'cluster';
import http from 'http';
import { mkdirSync, rmSync } from 'fs';
import { spawnSync } from 'child_process';
import { resolve } from 'path';
import 'dotenv/config'; 
import { onWorkerExit, restoreKept } from './bot/autoupdater.js';
import { HEAP_MB, MEMORY_LIMIT_MB } from './lib/resources.js';

const TMP_DIR = resolve('tmp');
process.env.TMPDIR = process.env.TMP = process.env.TEMP = TMP_DIR;

if (cluster.isPrimary) {
	rmSync(TMP_DIR, { recursive: true, force: true });
	mkdirSync(TMP_DIR, { recursive: true });
	restoreKept();
	const accepted = flags => {
		try {
			return spawnSync(process.execPath, [...flags, '-e', '0'], { stdio: 'ignore', timeout: 15000 }).status === 0;
		} catch {
			return false;
		}
	};
	const heapFlag = `--max-old-space-size=${HEAP_MB}`;
	const extraFlags = ['--max-semi-space-size=4', '--single-threaded-gc'];
	const workerFlags = accepted([heapFlag, ...extraFlags]) ? [heapFlag, ...extraFlags] : [heapFlag];

	cluster.setupPrimary({
		execArgv: [
			...process.execArgv.filter(arg => !/^--(max-old-space-size|max-semi-space-size|single-threaded-gc)/.test(arg)),
			...workerFlags
		]
	});

	const WORKER_ENV = {
		MALLOC_ARENA_MAX: process.env.MALLOC_ARENA_MAX || '2' 
	};

	let isRestarting = false;
	let quickExits = 0;

	const createWorker = () => {
		const startedAt = Date.now();
		const worker = cluster.fork(WORKER_ENV);

		worker.on('message', message => {
			if (message === 'app.kill') {
				console.log('Shutting down Nova...');
				worker.kill();
				process.exit(0);
			} else if (message === 'restart') {
				console.log('Restarting...');
				isRestarting = true;
				worker.kill();
			}
		});

		worker.on('exit', async (code, signal) => {
			if (signal === 'SIGKILL') console.log('Worker was killed (out of memory?)');
			else if (!isRestarting) console.log('Restarting...');
			isRestarting = false;
			await onWorkerExit(); 
			quickExits = Date.now() - startedAt < 20000 ? quickExits + 1 : 0;
			setTimeout(createWorker, Math.min(quickExits * 5000, 60000));
		});
	};

	createWorker();

	['SIGINT', 'SIGTERM'].forEach(sig => {
		process.on(sig, () => {
			for (const id in cluster.workers) {
				cluster.workers[id].kill();
			}
			process.exit(0);
		});
	});
} else {
	const startServer = async () => {
		console.log('Starting...');
		mkdirSync(TMP_DIR, { recursive: true });

		http
			.createServer((req, res) => res.end(JSON.stringify({ alive: req.url === '/' })))
			.listen(process.env.PORT || 8000);

		const { DATABASE } = await import('#database');
		const { client, eventlogger, loadSession, loadPlugins } = await import('#lib');
		const { startMaintenance, tuneDatabase } = await import('./lib/maintenance.js');

		await DATABASE.sync();
		await tuneDatabase();
		eventlogger();
		await loadSession();
		await loadPlugins();
		await client();
		startMaintenance();
	};

	startServer().catch(err => {
		console.log('Failed to start:', err?.stack || err);
		process.exit(1);
	});
	process.on('unhandledRejection', () => {});
	process.on('exit', () => {
		try {
			process.send('restart');
		} catch {
			
		}
	});
}

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	chmodSync,
	copyFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const STATE_FILE = join(ROOT, '.update-state.json');
const CHECK_EVERY = Math.max(5, Number(process.env.UPDATE_INTERVAL) || 30) * 60 * 1000;
const MAX_CRASHES = 3;
const IS_WIN = process.platform === 'win32';
const ENV = {
	...process.env,
	GIT_TERMINAL_PROMPT: '0',
	LC_ALL: 'C',
	GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME || 'T3rri Updater',
	GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL || 'updater@localhost',
	GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME || 'T3rri Updater',
	GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL || 'updater@localhost'
};

const short = sha => String(sha || '').slice(0, 7);
const bt = text => `\`\`\`${text}\`\`\``;

const scrub = text => String(text || '').replace(/(https?:\/\/)[^\s/@]+@/g, '$1***@');
const tail = (text, max = 300) => {
	const clean = scrub(text).trim();
	return clean.length > max ? `…${clean.slice(-max)}` : clean;
};

const run = (cmd, args, options = {}) =>
	new Promise((done, fail) => {
		execFile(
			cmd,
			args,
			{ cwd: ROOT, env: ENV, timeout: 120_000, maxBuffer: 10 * 1024 * 1024, windowsHide: true, ...options },
			(err, stdout, stderr) => {
				if (!err) return done(String(stdout).trim());
				const why =
					err.code === 'ENOENT' ? `${cmd} is not installed` : err.killed ? `${cmd} timed out` : stderr || stdout || err.message;
				fail(Object.assign(new Error(tail(why)), { stderr: String(stderr || '') }));
			}
		);
	});
const git = (...args) => run('git', ['-c', 'safe.directory=*', ...args]);

const KEEP = [
	'config.js',
	'.env',
	'database.db',
	'database.db-wal',
	'database.db-shm',
	'database.db-journal',
	'session',
	'media',
	'tmp',
	'.session-invalid',
	'.update-state.json',
	'.update-state.json.tmp',
	...String(process.env.UPDATE_KEEP || '').split(/[,;\n]+/)
]
	.map(entry => entry.trim().replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\/+$/, ''))
	.filter(Boolean);

export const isKept = file => KEEP.some(entry => file === entry || file.startsWith(`${entry}/`));

const KEEP_DIR = join(ROOT, '.update-keep');
const KEEP_MANIFEST = join(KEEP_DIR, 'manifest.json');

const listPaths = async (...args) =>
	(await git(...args).catch(() => '')).split('\0').filter(Boolean);

const holdKept = async target => {
	const files = [
		...new Set([
			...(await listPaths('diff', '--name-only', '-z', '--no-renames', 'HEAD')),
			...(target ? await listPaths('diff', '--name-only', '-z', '--no-renames', 'HEAD', target) : [])
		])
	].filter(isKept);
	if (!files.length) return;

	const saved = [];
	for (const file of files) {
		let stat;
		try {
			stat = lstatSync(join(ROOT, file));
		} catch {
			continue;
		}
		if (!stat.isFile()) continue;
		const copy = join(KEEP_DIR, 'files', file);
		mkdirSync(dirname(copy), { recursive: true });
		copyFileSync(join(ROOT, file), copy);
		saved.push({ file, mode: stat.mode & 0o777 });
	}
	if (!saved.length) return;
	writeFileSync(KEEP_MANIFEST, JSON.stringify({ files: saved }));

	try {
		for (const { file } of saved) {
			const inHead = await git('cat-file', '-e', `HEAD:${file}`).then(
				() => true,
				() => false
			);
			if (inHead) {
				await git('checkout', 'HEAD', '--', file);
			} else {
				await git('rm', '--cached', '--quiet', '--ignore-unmatch', '--', file);
				rmSync(join(ROOT, file), { force: true });
			}
		}
	} catch (err) {
		restoreKept();
		throw err;
	}
};

export const restoreKept = () => {
	let manifest;
	try {
		manifest = JSON.parse(readFileSync(KEEP_MANIFEST, 'utf8'));
	} catch {
		return 0;
	}
	let restored = 0;
	for (const { file, mode } of manifest.files || []) {
		try {
			const target = join(ROOT, file);
			mkdirSync(dirname(target), { recursive: true });
			copyFileSync(join(KEEP_DIR, 'files', file), target);
			try {
				chmodSync(target, mode);
			} catch {
			}
			restored++;
		} catch (err) {
			console.log(`[autoupdate] could not put ${file} back: ${err.message}. Your copy is in .update-keep/files/`);
			return restored;
		}
	}
	rmSync(KEEP_DIR, { recursive: true, force: true });
	if (restored) console.log(`[autoupdate] kept ${restored} of your file(s) as they were`);
	return restored;
};

const withKept = async (target, step) => {
	await holdKept(target);
	try {
		return await step();
	} finally {
		restoreKept();
	}
};

const readState = () => {
	try {
		return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
	} catch {
		return {};
	}
};
const patchState = change => {
	const state = readState();
	change(state);
	try {
		writeFileSync(`${STATE_FILE}.tmp`, JSON.stringify(state, null, 2));
		renameSync(`${STATE_FILE}.tmp`, STATE_FILE);
	} catch (err) {
		console.log('[autoupdate] could not save state:', err.message);
	}
	return state;
};
const markBad = (state, sha) => {
	state.bad = [...new Set([...(state.bad || []), sha])].slice(-20);
};

const pkgAt = async sha => {
	try {
		return JSON.parse(await git('show', `${sha}:package.json`));
	} catch {
		return {};
	}
};
const depsKey = pkg => JSON.stringify(Object.entries({ ...pkg.dependencies, ...pkg.optionalDependencies }).sort());
const localPkg = () => {
	try {
		return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
	} catch {
		return {};
	}
};

const prettyRemote = url =>
	String(url || '')
		.trim()
		.replace(/^[a-z+]+:\/\/(?:[^/@]*@)?/i, '')
		.replace(/\.git$/, '');

const unsupported = message => Object.assign(new Error(message), { unsupported: true });

const normalizeRepoUrl = raw => {
	const url = String(raw || '')
		.trim()
		.replace(/^git\+/, '');
	if (/^github:/i.test(url)) return `https://github.com/${url.slice(7)}`;
	if (/^[\w.-]+\/[\w.-]+$/.test(url)) return `https://github.com/${url}`;
	return url;
};
const repoUrl = () => {
	const repo = localPkg().repository;
	return normalizeRepoUrl(process.env.UPDATE_REPO || (typeof repo === 'string' ? repo : repo?.url));
};

const detectBranch = async url => {
	if (process.env.UPDATE_BRANCH) return process.env.UPDATE_BRANCH;
	try {
		const out = await git('ls-remote', '--symref', url, 'HEAD');
		return out.match(/^ref: refs\/heads\/(\S+)\s+HEAD$/m)?.[1] || 'master';
	} catch (err) {
		if (/unknown option|usage:/i.test(err.message)) return 'master';
		throw err;
	}
};

const SCAN_COMMITS = 300;
const SCAN_ENTRIES = 150_000;
const MAX_HASH_BYTES = 5 * 1024 * 1024;

const blobId = buffer =>
	createHash('sha1')
		.update(`blob ${buffer.length}\0`)
		.update(buffer)
		.digest('hex');

const treeOf = async sha => {
	const files = new Map();
	for (const entry of (await git('ls-tree', '-r', '-z', '--full-tree', sha)).split('\0')) {
		const tab = entry.indexOf('\t');
		if (tab < 0) continue;
		const [mode, type, id] = entry.slice(0, tab).split(' ');
		if (type === 'blob' && mode !== '120000') files.set(entry.slice(tab + 1), id);
	}
	return files;
};

const findBase = async (ref, branch) => {
	const revs = (await git('rev-list', `--max-count=${SCAN_COMMITS}`, ref)).split('\n').filter(Boolean);
	if (!revs.length) throw unsupported(`the remote has no commits on "${branch}"`);

	const trees = [];
	let entries = 0;
	for (let i = 0; i < revs.length && entries < SCAN_ENTRIES; i += 6) {
		for (const files of await Promise.all(revs.slice(i, i + 6).map(treeOf))) {
			trees.push(files);
			entries += files.size;
		}
	}

	const here = new Map();
	for (const path of new Set(trees.flatMap(files => [...files.keys()]))) {
		let id = null;
		try {
			const file = join(ROOT, path);
			const stat = statSync(file);
			if (stat.isFile()) id = stat.size > MAX_HASH_BYTES ? 'too-big' : blobId(readFileSync(file));
		} catch {
		}
		here.set(path, id);
	}

	let best = null;
	trees.forEach((files, i) => {
		let differs = 0;
		for (const [path, id] of here) if ((files.get(path) ?? null) !== id) differs++;
		if (!best || differs < best.differs) best = { sha: revs[i], differs };
	});
	return best;
};

const setupCheckout = async () => {
	const url = repoUrl();
	if (!url) throw unsupported('no repository to update from (set UPDATE_REPO, or "repository" in package.json)');
	if (existsSync(join(ROOT, '.git'))) {
		throw unsupported('there is a .git folder here that git cannot use, delete it and the bot sets up a new one');
	}

	const branch = await detectBranch(url);
	const ref = `refs/remotes/origin/${branch}`;
	try {
		await git('init', '--quiet').catch(err => {
			throw unsupported(`cannot create a git checkout here (${err.message})`);
		});
		await git('symbolic-ref', 'HEAD', `refs/heads/${branch}`);
		await git('remote', 'add', 'origin', url);
		await run('git', ['-c', 'safe.directory=*', '-c', 'pack.threads=1', 'fetch', '--quiet', '--no-tags', 'origin', `+refs/heads/${branch}:${ref}`], {
			timeout: 5 * 60_000
		});

		const base = await findBase(ref, branch);
		await git('update-ref', `refs/heads/${branch}`, base.sha);
		await git('reset', '--quiet');
		patchState(s => {
			s.bootstrap = { at: Date.now(), base: base.sha, differs: base.differs };
		});
		console.log(`[autoupdate] set up a git checkout from ${prettyRemote(url)} (${branch}) at ${short(base.sha)}, ${base.differs} file(s) differ`);
	} catch (err) {
		rmSync(join(ROOT, '.git'), { recursive: true, force: true });
		throw err;
	}
};

let settingUp = null;
const bootstrapRepo = () => {
	settingUp ||= setupCheckout().finally(() => {
		settingUp = null;
	});
	return settingUp;
};

const ensureRepo = async ({ create = false } = {}) => {
	let top;
	try {
		top = await git('rev-parse', '--show-toplevel');
	} catch (err) {
		if (/not installed/.test(err.message)) throw unsupported('updates need git, and it is not installed on this host');
		if (!/not a git repository/i.test(err.message)) throw unsupported(`updates need a git checkout (${err.message})`);
		if (!create) throw unsupported('there is no git checkout here yet, the first update check sets one up');
		await bootstrapRepo();
		top = await git('rev-parse', '--show-toplevel');
	}
	if (realpathSync(top) !== realpathSync(ROOT)) throw unsupported('the bot folder is not the root of its git repository');
	try {
		await git('remote', 'get-url', 'origin');
	} catch {
		throw unsupported('this git checkout has no "origin" remote');
	}
};

const getBranch = async () => {
	if (process.env.UPDATE_BRANCH) return process.env.UPDATE_BRANCH;
	const current = await git('rev-parse', '--abbrev-ref', 'HEAD').catch(() => 'HEAD');
	return current && current !== 'HEAD' ? current : 'master';
};

const changedFiles = async (from, to) =>
	(await git('diff', '--name-only', '-z', '--diff-filter=AMR', from, to)).split('\0').filter(Boolean);

const adoptIdentical = async (from, to) => {
	const changed = await changedFiles(from, to);
	for (let i = 0; i < changed.length; i += 200) {
		const entries = await git('ls-tree', '-r', '-z', '--full-tree', to, '--', ...changed.slice(i, i + 200));
		for (const entry of entries.split('\0')) {
			const tab = entry.indexOf('\t');
			if (tab < 0) continue;
			const [mode, type, id] = entry.slice(0, tab).split(' ');
			const file = entry.slice(tab + 1);
			if (type !== 'blob' || mode === '120000') continue;
			let same = false;
			try {
				same = blobId(readFileSync(join(ROOT, file))) === id;
			} catch {
			}
			if (same) await git('update-index', '--add', '--cacheinfo', `${mode},${id},${file}`);
		}
	}
};

const listedUnder = (output, header) => {
	const files = [];
	let inside = false;
	for (const line of String(output || '').split('\n')) {
		if (line.startsWith('\t')) {
			if (inside) files.push(line.trim());
		} else inside = header.test(line);
	}
	return files;
};

const verify = async files => {
	for (const file of files) {
		const path = join(ROOT, file);
		if (!existsSync(path)) continue;
		try {
			if (file === 'package.json') JSON.parse(readFileSync(path, 'utf8'));
			else if (/\.(js|mjs|cjs)$/.test(file)) await run(process.execPath, ['--check', path], { timeout: 30_000 });
		} catch (err) {
			const line = String(err.stderr || err.message).match(/^\w*Error: .*$/m)?.[0] || err.message;
			throw new Error(tail(`${file}: ${line}`));
		}
	}
};

const installDeps = async () => {
	const wantsYarn = String(localPkg().packageManager || '').startsWith('yarn');
	const hasYarn =
		wantsYarn &&
		(await run('yarn', ['--version'], { timeout: 30_000, shell: IS_WIN }).then(
			() => true,
			() => false
		));
	const [cmd, args] = hasYarn
		? ['yarn', ['install', '--production']]
		: ['npm', ['install', '--omit=dev', '--no-audit', '--no-fund']];
	const heapMB = Number(process.env.MAX_HEAP_MB) || 192;
	await run(cmd, args, {
		timeout: 15 * 60_000,
		shell: IS_WIN,
		env: { ...ENV, NODE_OPTIONS: `${ENV.NODE_OPTIONS || ''} --max-old-space-size=${heapMB}`.trim() }
	});
};

// FIX: detect a diverged branch (HEAD has commits not in `to`) so we don't rely on --ff-only.
const divergedFrom = async (from, to) => {
	const ahead = await git('rev-list', '--count', `${to}..${from}`).then(Number).catch(() => 0);
	return ahead > 0;
};

const changeList = (commits = [], total = commits.length) => {
	const lines = commits.slice(0, 10).map((c, i) => bt(`${i + 1}. ${c.message}`));
	if (total > lines.length) lines.push(bt(`...and ${total - lines.length} more`));
	return lines.join('\n');
};

const versionLine = ({ version = [], from, to }) => {
	const [before, after] = version;
	return `${before && after && before !== after ? `v${before} -> v${after}  ` : ''}${short(from)} -> ${short(to)}`;
};

export const updateFoundText = (info, prefix = '.') =>
	`${bt('UPDATE FOUND')}\n\n*Changes:* ${bt(info.behind)}\n*Updates:*\n${changeList(info.commits, info.behind)}\n\n` +
	`*To update, use* ${bt(`${prefix}update now`)}`;

export const describeResult = (res, prefix = '.') => {
	switch (res.status) {
		case 'updated':
			return `*Update installed*\n${bt(versionLine(res))}${res.stashed ? `\n${bt('Local changes were stashed, see git stash list')}` : ''}\n*Restarting...*`;
		case 'failed':
			return (
				`⚠️ *Update failed*\n` +
				(res.rollbackError
					? `🚨 *Rollback failed too:* ${bt(res.rollbackError)}\n`
					: `${bt(`Rolled back, ${short(res.from)} is running again`)}\n`) +
				`*Reason:* ${bt(res.error)}`
			);
		case 'blocked':
			// FIX: clearer message for divergence / conflict, and mention the force option.
			return (
				`⚠️ *Update blocked*\n${bt(res.error)}` +
				(res.conflict && !res.forced
					? `\n_Your checkout has diverged from origin or has edits in the way. Send ${prefix}update now to force it._`
					: '')
			);
		case 'busy':
			return bt('Another update is already running');
		default:
			return bt('No update available');
	}
};

const completeText = p =>
	`✅ *Update complete*\n${bt(versionLine(p))}` +
	(p.commits?.length ? `\n\n*Changes:*\n${changeList(p.commits, p.behind)}` : '') +
	(p.stashed ? `\n\n${bt('Local changes were stashed, see git stash list')}` : '');

const selfJid = client => client.user.id.replace(/:\d+@/, '@');
const notify = async (client, text) => {
	try {
		await client.sendMessage(selfJid(client), { text });
	} catch (err) {
		console.log('[autoupdate] could not send message:', err?.message || err);
	}
};

export const checkForUpdate = async () => {
	await ensureRepo({ create: true });
	const branch = await getBranch();
	const remote = `origin/${branch}`;
	await git('fetch', '--quiet', 'origin', `+refs/heads/${branch}:refs/remotes/${remote}`);

	const [current, latest, behind] = await Promise.all([
		git('rev-parse', 'HEAD'),
		git('rev-parse', remote),
		git('rev-list', '--count', `HEAD..${remote}`).then(Number)
	]);
	const commits = behind
		? (await git('log', '--max-count=15', '--pretty=format:%h%x09%s', `HEAD..${remote}`)).split('\n').map(line => {
				const [sha, ...rest] = line.split('\t');
				return { sha, message: rest.join('\t') };
			})
		: [];

	const state = patchState(s => {
		s.lastCheck = Date.now();
	});
	return { available: behind > 0, current, latest, branch, behind, commits, bad: (state.bad || []).includes(latest) };
};

const rollbackPending = async (pending, reason) => {
	await withKept(pending.from, () => git('reset', '--keep', pending.from));
	if (pending.depsChanged) {
		await installDeps().catch(err => console.log('[autoupdate] reinstall after rollback failed:', err.message));
	}
	patchState(s => {
		delete s.pending;
		markBad(s, pending.to);
		s.notice = describeResult({ status: 'failed', from: pending.from, to: pending.to, error: reason });
	});
};

let busy = false;

export const installUpdate = async ({ info, force = false } = {}) => {
	if (busy) return { status: 'busy' };
	busy = true;
	try {
		info ||= await checkForUpdate();
		if (!info.available) return { status: 'uptodate', ...info };

		const { current: from, latest: to, commits, behind } = info;
		const [oldPkg, newPkg] = await Promise.all([pkgAt(from), pkgAt(to)]);
		const depsChanged = depsKey(oldPkg) !== depsKey(newPkg);
		const version = [oldPkg.version, newPkg.version];

		patchState(s => {
			s.pending = { from, to, phase: 'installing', by: process.pid, at: Date.now(), crashes: 0, depsChanged, version, commits, behind };
			delete s.notice;
		});

		let merged = false;
		let stashed = false;
		try {
			await withKept(to, async () => {
				await adoptIdentical(from, to);

				// FIX: handle a diverged branch — fast-forward is impossible when HEAD is ahead.
				const diverged = await divergedFrom(from, to);
				if (diverged) {
					if (!force) {
						// Try to stash so the user's committed/working work isn't lost.
						const label = `nova-autoupdate ${short(to)}`;
						const out = await git('stash', 'push', '-m', label).catch(() => '');
						stashed = !/No local changes/i.test(out);
						if (!stashed) {
							const err = new Error(
								'your branch has diverged from origin; send "update now" to force it'
							);
							err.diverged = true;
							throw err;
						}
					}
					await git('reset', '--hard', to);
					merged = true;
					return;
				}

				try {
					await git('merge', '--ff-only', to);
				} catch (err) {
					if (!force || !/overwritten/i.test(`${err.stderr || ''} ${err.message}`)) throw err;
					const label = `nova-autoupdate ${short(to)}`;
					const out = await git('stash', 'push', '-m', label);
					stashed = !/No local changes/i.test(out);
					try {
						await git('merge', '--ff-only', to);
					} catch (again) {
						const files = listedUnder(again.stderr, /untracked working tree files/i);
						if (!files.length) throw again;
						await git('stash', 'push', '--include-untracked', '-m', label, '--', ...files);
						stashed = true;
						await git('merge', '--ff-only', to);
					}
				}
			});
			merged = true;
			if (depsChanged) await installDeps();
			await verify((await changedFiles(from, to)).filter(file => !isKept(file)));
		} catch (err) {
			try {
				// FIX: --hard is the correct rollback when the tree may have been force-reset.
				if (merged) await withKept(from, () => git('reset', '--hard', from));
				else await git('reset', '--quiet').catch(() => {});
				if (stashed) await git('stash', 'pop').catch(() => {});
				if (merged && depsChanged) await installDeps().catch(() => {});
			} catch (rollbackErr) {
				return { status: 'failed', from, to, error: err.message, rollbackError: rollbackErr.message };
			}
			patchState(s => {
				delete s.pending;
				if (merged) markBad(s, to);
			});
			// FIX: also treat the diverged case as "conflict" so the message tells the user to force.
			const conflict =
				!merged &&
				(/overwritten/i.test(`${err.stderr || ''} ${err.message}`) || err.diverged === true);
			return { status: merged ? 'failed' : 'blocked', from, to, error: err.message, conflict, forced: force };
		}

		patchState(s => {
			s.pending.phase = 'restarting';
			s.pending.expectExit = true;
			s.pending.stashed = stashed;
		});
		return { status: 'updated', from, to, version, commits, behind, stashed, depsChanged };
	} finally {
		busy = false;
	}
};

export const rollbackUpdate = async () => {
	if (busy) return { status: 'busy' };
	busy = true;
	try {
		await ensureRepo();
		const { previous } = readState();
		const current = await git('rev-parse', 'HEAD');
		if (!previous || previous === current) return { status: 'none' };

		const [now, before] = await Promise.all([pkgAt(current), pkgAt(previous)]);
		await withKept(previous, () => git('reset', '--keep', previous));
		if (depsKey(now) !== depsKey(before)) await installDeps();
		patchState(s => {
			markBad(s, current);
			s.lastGood = previous;
			delete s.previous;
		});
		return { status: 'rolledback', from: current, to: previous };
	} finally {
		busy = false;
	}
};

export const restartBot = async () => {
	await new Promise(done => setTimeout(done, 1500));
	process.exit(0);
};

export const updateStatus = async () => {
	const state = readState();
	const status = { lastCheck: state.lastCheck, previous: state.previous, everyMinutes: CHECK_EVERY / 60_000 };
	try {
		await ensureRepo({ create: true });
		status.supported = true;
		status.branch = await getBranch();
		status.remote = prettyRemote(await git('remote', 'get-url', 'origin'));
		status.current = await git('rev-parse', 'HEAD');
		status.version = localPkg().version;
		status.dirty = (await listPaths('diff', '--name-only', '-z', '--no-renames', 'HEAD')).filter(file => !isKept(file)).length;
	} catch (err) {
		status.supported = false;
		status.error = err.message;
	}
	return status;
};

export const onWorkerExit = async () => {
	try {
		restoreKept();
		const { pending } = readState();
		if (!pending) return;
		if (pending.expectExit) {
			patchState(s => {
				s.pending.expectExit = false;
			});
			return;
		}
		const crashes = (pending.crashes || 0) + 1;
		if (crashes < MAX_CRASHES) {
			patchState(s => {
				s.pending.crashes = crashes;
			});
			return;
		}
		console.log(`[autoupdate] ${short(pending.to)} keeps crashing, going back to ${short(pending.from)}`);
		await rollbackPending(pending, `the bot crashed ${crashes} times after the update`);
	} catch (err) {
		console.log('[autoupdate] supervisor error:', err.message);
	}
};

export const confirmUpdate = async client => {
	const { pending } = readState();
	if (pending?.by === process.pid) return;

	let interrupted = false;
	if (pending?.phase === 'installing') {
		await rollbackPending(pending, 'the update was interrupted before it finished');
		interrupted = true;
	}

	const state = readState();
	if (!state.pending && !state.notice) return;
	patchState(s => {
		if (s.pending) {
			s.previous = s.pending.from;
			s.lastGood = s.pending.to;
		}
		delete s.pending;
		delete s.notice;
	});
	if (state.notice) await notify(client, state.notice);
	if (state.pending) await notify(client, completeText(state.pending));
	if (interrupted) await restartBot();
};

let announced = null;

export const runAutoUpdate = async (client, { getMode = async () => 'on', getPrefix = async () => '.' } = {}) => {
	const mode = await getMode().catch(() => 'off');
	if (mode !== 'on' && mode !== 'notify') return;

	const info = await checkForUpdate();
	if (!info.available || info.bad) return;

	const tell = async (key, text) => {
		if (announced === key) return;
		announced = key;
		await notify(client, text);
	};

	if (mode === 'notify') {
		return tell(info.latest, updateFoundText(info, await getPrefix().catch(() => '.')));
	}

	await tell(`${info.latest}:start`, `⬇️ *Auto-update:* ${bt(`${info.behind} new change(s), installing...`)}`);
	const res = await installUpdate({ info });
	if (res.status === 'updated') return restartBot();
	if (res.status !== 'busy') {
		await tell(`${info.latest}:${res.status}`, describeResult(res, await getPrefix().catch(() => '.')));
	}
};

let firstCheck = null;
let timer = null;

export const AutoUpdater = async (client, options = {}) => {
	restoreKept();
	await confirmUpdate(client).catch(err => console.log('[autoupdate]', err.message));

	clearTimeout(firstCheck);
	clearInterval(timer);

	let running = false;
	const tick = async () => {
		if (running) return;
		running = true;
		try {
			await runAutoUpdate(client, options);
		} catch (err) {
			if (err.unsupported) {
				clearInterval(timer);
				return console.log(`[autoupdate] switched off: ${err.message}`);
			}
			console.log('[autoupdate] check failed:', err.message);
		} finally {
			running = false;
		}
	};

	firstCheck = setTimeout(tick, 30_000 + Math.random() * 60_000);
	timer = setInterval(tick, CHECK_EVERY);
	firstCheck.unref?.();
	timer.unref?.();
};
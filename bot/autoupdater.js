/**
 * Auto-updater
 *
 * Keeps the bot in sync with the git remote it was cloned from ("origin").
 * A folder uploaded without a .git directory (zip upload, panel hosts) is turned into a
 * checkout by the first check, see setupCheckout().
 *
 *   setup     no .git yet: init, fetch the remote, point HEAD at the commit this folder matches best
 *   check     git fetch, then compare HEAD with origin/<branch>
 *   download  fast-forward merge: never rewrites history, never overwrites local edits
 *   install   yarn/npm install, only when "dependencies" changed
 *   verify    syntax-check every changed .js file before restarting
 *   notify    status messages go to the bot's own chat
 *   rollback  a failed step, or a crash loop after the restart, returns to the old commit
 *
 * Optional env vars
 *   UPDATE_INTERVAL  minutes between checks (default 30, minimum 5)
 *   UPDATE_BRANCH    branch to follow (default: the branch the bot is on, else the remote's default)
 *   UPDATE_REPO      where to update from, only used to set up a checkout (default: "repository" in
 *                    package.json). A URL, or owner/repo for GitHub. Private repos: https://user:token@github.com/owner/repo
 *
 * Only Node built-ins are used here, so the supervisor in index.js can still roll back
 * after an update that breaks the rest of the code.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const STATE_FILE = join(ROOT, '.update-state.json');
const CHECK_EVERY = Math.max(5, Number(process.env.UPDATE_INTERVAL) || 30) * 60 * 1000;
const MAX_CRASHES = 3; // worker crashes right after an update before it is rolled back
const IS_WIN = process.platform === 'win32';
// git refuses to stash without a committer identity, and a fresh container has none configured
const ENV = {
	...process.env,
	GIT_TERMINAL_PROMPT: '0',
	LC_ALL: 'C',
	GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME || 'T3rri Updater',
	GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL || 'updater@localhost',
	GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME || 'T3rri Updater',
	GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL || 'updater@localhost'
};

/* ───────────────────────────── helpers ───────────────────────────── */

const short = sha => String(sha || '').slice(0, 7);
const bt = text => `\`\`\`${text}\`\`\``;

// remote URLs can carry tokens (https://user:token@host), keep them out of chat messages
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

/* The state file survives restarts and rollbacks (it is untracked), and is shared by the
   worker (installs, confirms) and the master (crash-loop rollback). */
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

// "https://user:token@github.com/me/bot.git" -> "github.com/me/bot"
const prettyRemote = url =>
	String(url || '')
		.trim()
		.replace(/^[a-z+]+:\/\/(?:[^/@]*@)?/i, '')
		.replace(/\.git$/, '');

const unsupported = message => Object.assign(new Error(message), { unsupported: true });

/* ───────────────── turning an uploaded folder into a checkout ─────────────────
   Hosts that deploy from a zip have no .git folder, so there is nothing to fetch into. The first
   check builds one in place: init, add the remote, fetch its history, then point HEAD at the commit
   whose files match this folder best. Files are never touched, so anything that differs shows up as
   an ordinary local change, and from then on the normal update path applies. */

// "git+https://github.com/me/bot.git" | "me/bot" | "github:me/bot" -> a URL git can fetch
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
		const out = await git('ls-remote', '--symref', url, 'HEAD'); // "ref: refs/heads/main<TAB>HEAD"
		return out.match(/^ref: refs\/heads\/(\S+)\s+HEAD$/m)?.[1] || 'master';
	} catch (err) {
		if (/unknown option|usage:/i.test(err.message)) return 'master'; // git older than 2.8 has no --symref
		throw err;
	}
};

const SCAN_COMMITS = 300; // how far back to look for the commit this folder came from
const SCAN_ENTRIES = 150_000; // ...and a ceiling on file entries held in memory, so a huge repo cannot exhaust a small host
const MAX_HASH_BYTES = 5 * 1024 * 1024;

// the id git gives a file's content (sha1 of "blob <size>\0<content>"), computed here so no process is spawned per file
const blobId = buffer =>
	createHash('sha1')
		.update(`blob ${buffer.length}\0`)
		.update(buffer)
		.digest('hex');

const treeOf = async sha => {
	const files = new Map(); // path -> blob id
	for (const entry of (await git('ls-tree', '-r', '-z', '--full-tree', sha)).split('\0')) {
		const tab = entry.indexOf('\t');
		if (tab < 0) continue;
		const [mode, type, id] = entry.slice(0, tab).split(' ');
		if (type === 'blob' && mode !== '120000') files.set(entry.slice(tab + 1), id); // 120000 = symlink
	}
	return files;
};

/** The recent commit whose files are closest to this folder (the one it was uploaded from, if nothing was edited). */
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

	// every path that ever mattered, with the id of the file in this folder (null = not here)
	const here = new Map();
	for (const path of new Set(trees.flatMap(files => [...files.keys()]))) {
		let id = null;
		try {
			const file = join(ROOT, path);
			const stat = statSync(file);
			if (stat.isFile()) id = stat.size > MAX_HASH_BYTES ? 'too-big' : blobId(readFileSync(file));
		} catch {
			/* not in this folder */
		}
		here.set(path, id);
	}

	let best = null;
	trees.forEach((files, i) => {
		let differs = 0;
		for (const [path, id] of here) if ((files.get(path) ?? null) !== id) differs++;
		if (!best || differs < best.differs) best = { sha: revs[i], differs }; // revs are newest first, so the newest wins a tie
	});
	return best;
};

const setupCheckout = async () => {
	const url = repoUrl();
	if (!url) throw unsupported('no repository to update from (set UPDATE_REPO, or "repository" in package.json)');
	if (existsSync(join(ROOT, '.git'))) {
		throw unsupported('there is a .git folder here that git cannot use, delete it and the bot sets up a new one');
	}

	const branch = await detectBranch(url); // also proves the remote is reachable before anything is written
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
		await git('reset', '--quiet'); // the index follows HEAD, the files stay exactly as they are
		patchState(s => {
			s.bootstrap = { at: Date.now(), base: base.sha, differs: base.differs };
		});
		console.log(`[autoupdate] set up a git checkout from ${prettyRemote(url)} (${branch}) at ${short(base.sha)}, ${base.differs} file(s) differ`);
	} catch (err) {
		rmSync(join(ROOT, '.git'), { recursive: true, force: true }); // never leave a half-built checkout behind
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

/** create: set up a checkout when the folder has none (checks and status do, a rollback has nothing to undo). */
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

/**
 * Files this folder already has with exactly the content an update is about to write (typically the same change
 * was uploaded by hand before it was pushed): record them as updated, so git sees nothing in the way and the
 * merge leaves them alone. Nothing can be lost, the content is identical.
 */
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
				/* not in this folder */
			}
			if (same) await git('update-index', '--add', '--cacheinfo', `${mode},${id},${file}`);
		}
	}
};

// git lists the files it complains about as tab-indented lines under a header line
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

/** Syntax-check what an update changed, so a typo never gets as far as a restart. */
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
	// Capping npm/yarn's heap makes a too-big install fail (and roll back) instead of taking the whole container down.
	const heapMB = Number(process.env.MAX_HEAP_MB) || 192;
	await run(cmd, args, {
		timeout: 15 * 60_000,
		shell: IS_WIN,
		env: { ...ENV, NODE_OPTIONS: `${ENV.NODE_OPTIONS || ''} --max-old-space-size=${heapMB}`.trim() }
	});
};

/* ───────────────────────────── messages ───────────────────────────── */

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
			return (
				`⚠️ *Update blocked*\n${bt(res.error)}` +
				(res.conflict && !res.forced ? `\n_Your own edits are in the way. Send ${prefix}update now to stash them and update._` : '')
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

/* ───────────────────────────── core ───────────────────────────── */

/** Fetch the remote and report whether it is ahead of this checkout. */
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

/** Go back to the commit an update started from (used after a failed or crashing update). */
const rollbackPending = async (pending, reason) => {
	await git('reset', '--keep', pending.from);
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

/**
 * Download + install the update found by checkForUpdate().
 * Does not restart: when status is "updated" the caller restarts the bot (see restartBot).
 *   force  also stash local changes that stand in the way (manual `update now` only)
 * status: updated | uptodate | blocked (nothing changed) | failed (rolled back) | busy
 */
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

		// From here on a kill or crash is detectable: the marker says an update was in progress.
		patchState(s => {
			s.pending = { from, to, phase: 'installing', by: process.pid, at: Date.now(), crashes: 0, depsChanged, version, commits, behind };
			delete s.notice;
		});

		let merged = false;
		let stashed = false;
		try {
			await adoptIdentical(from, to);
			try {
				await git('merge', '--ff-only', to);
			} catch (err) {
				if (!force || !/overwritten/i.test(`${err.stderr || ''} ${err.message}`)) throw err;
				const label = `nova-autoupdate ${short(to)}`;
				const out = await git('stash', 'push', '-m', label); // edits to tracked files
				stashed = !/No local changes/i.test(out);
				try {
					await git('merge', '--ff-only', to);
				} catch (again) {
					// files of your own that the update also creates, with different content: stash those too
					const files = listedUnder(again.stderr, /untracked working tree files/i);
					if (!files.length) throw again;
					await git('stash', 'push', '--include-untracked', '-m', label, '--', ...files);
					stashed = true;
					await git('merge', '--ff-only', to);
				}
			}
			merged = true;
			if (depsChanged) await installDeps();
			await verify(await changedFiles(from, to));
		} catch (err) {
			try {
				if (merged) await git('reset', '--keep', from);
				else await git('reset', '--quiet').catch(() => {}); // undo what adoptIdentical() recorded, the files themselves are untouched
				if (stashed) await git('stash', 'pop').catch(() => {});
				if (merged && depsChanged) await installDeps().catch(() => {});
			} catch (rollbackErr) {
				// marker stays, so the next boot (or the supervisor) tries the rollback again
				return { status: 'failed', from, to, error: err.message, rollbackError: rollbackErr.message };
			}
			patchState(s => {
				delete s.pending;
				if (merged) markBad(s, to);
			});
			const conflict = !merged && /overwritten/i.test(`${err.stderr || ''} ${err.message}`);
			return { status: merged ? 'failed' : 'blocked', from, to, error: err.message, conflict, forced: force };
		}

		patchState(s => {
			s.pending.phase = 'restarting';
			s.pending.expectExit = true; // the exit we are about to cause is not a crash
			s.pending.stashed = stashed;
		});
		return { status: 'updated', from, to, version, commits, behind, stashed, depsChanged };
	} finally {
		busy = false;
	}
};

/** Manual rollback to the version that was running before the last update. */
export const rollbackUpdate = async () => {
	if (busy) return { status: 'busy' };
	busy = true;
	try {
		await ensureRepo();
		const { previous } = readState();
		const current = await git('rev-parse', 'HEAD');
		if (!previous || previous === current) return { status: 'none' };

		const [now, before] = await Promise.all([pkgAt(current), pkgAt(previous)]);
		await git('reset', '--keep', previous);
		if (depsKey(now) !== depsKey(before)) await installDeps();
		patchState(s => {
			markBad(s, current); // so the auto-updater does not instantly install it again
			s.lastGood = previous;
			delete s.previous;
		});
		return { status: 'rolledback', from: current, to: previous };
	} finally {
		busy = false;
	}
};

/** Exit so the master process starts a fresh worker running the new code. */
export const restartBot = async () => {
	await new Promise(done => setTimeout(done, 1500)); // let the last message leave first
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
		// files here that differ from the commit above; an update that touches one of them needs `update now`
		status.dirty = (await git('status', '--porcelain', '--untracked-files=no')).split('\n').filter(Boolean).length;
	} catch (err) {
		status.supported = false;
		status.error = err.message;
	}
	return status;
};

/* ───────────────────── health check + crash-loop rollback ───────────────────── */

/**
 * Master process (index.js): called every time the worker exits.
 * The master keeps running the old code in memory, so it can undo an update whose new code
 * cannot even start (syntax error, bad import) and would otherwise crash forever.
 */
export const onWorkerExit = async () => {
	try {
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

/**
 * Worker: runs once WhatsApp is connected. A connected bot means the update works, so the
 * marker is cleared and the owner hears how it went (including rollbacks done by the master).
 */
export const confirmUpdate = async client => {
	const { pending } = readState();
	if (pending?.by === process.pid) return; // this process is the one still installing

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
	if (interrupted) await restartBot(); // files changed under a running process, start clean
};

/* ───────────────────────────── scheduler ───────────────────────────── */

let announced = null; // what the owner was last told, so every check does not repeat itself

/**
 * One check. mode: "on" installs, "notify" only tells the owner, anything else does nothing.
 * Throws when updates are unsupported here or the remote cannot be reached.
 */
export const runAutoUpdate = async (client, { getMode = async () => 'on', getPrefix = async () => '.' } = {}) => {
	const mode = await getMode().catch(() => 'off');
	if (mode !== 'on' && mode !== 'notify') return;

	const info = await checkForUpdate();
	if (!info.available || info.bad) return; // bad = this exact commit already failed here

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

/** Call when the WhatsApp connection opens. Safe to call again on every reconnect. */
export const AutoUpdater = async (client, options = {}) => {
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

	firstCheck = setTimeout(tick, 30_000 + Math.random() * 60_000); // spread out many bots
	timer = setInterval(tick, CHECK_EVERY);
	firstCheck.unref?.();
	timer.unref?.();
};

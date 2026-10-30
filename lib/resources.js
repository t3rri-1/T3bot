// Memory budget for the bot. Node built-ins only: index.js (the supervisor) imports this too,
// and the supervisor must stay tiny.
import { readFileSync } from 'node:fs';

// The container limit if the host exposes one (cgroup v2 / v1), otherwise the small-panel default.
const cgroupLimitMB = () => {
	for (const file of ['/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory/memory.limit_in_bytes']) {
		try {
			const bytes = Number(readFileSync(file, 'utf8').trim());
			if (Number.isFinite(bytes) && bytes > 0 && bytes < 2 ** 40) return Math.floor(bytes / 1048576);
		} catch {
			// file not there (not Linux, or no limit set)
		}
	}
	return null;
};

export const MEMORY_LIMIT_MB = Number(process.env.MEMORY_LIMIT_MB) || cgroupLimitMB() || 308;

// V8 old-space cap for the worker. Buffers, sqlite, libvips and ffmpeg live outside the heap,
// so the cap has to stay well under the container limit.
export const HEAP_MB = Number(process.env.MAX_HEAP_MB) || Math.max(96, Math.min(1024, Math.floor(MEMORY_LIMIT_MB * 0.45)));

// Rough cost of the supervisor process, and the worker RSS at which the bot starts freeing memory (lib/memory.js).
// It never restarts because of memory: soft empties the caches that are cheap to fill again and collects garbage,
// hard (where it used to restart) also deletes old temp files and gives sqlite's memory back.
export const SUPERVISOR_MB = 55;
export const RSS_SOFT_MB = Math.floor(MEMORY_LIMIT_MB * 0.75) - SUPERVISOR_MB;
export const RSS_HARD_MB = Math.floor(MEMORY_LIMIT_MB * 0.88) - SUPERVISOR_MB;

// Largest file the bot will pull into memory (downloads, quoted media). A Buffer is copied several times on
// its way through encoding and upload, so on a small host this has to stay well under the free memory.
export const MAX_MEDIA_MB = Number(process.env.MAX_MEDIA_MB) || (MEMORY_LIMIT_MB <= 512 ? 30 : 100);

// Memory relief for small hosts. Near its memory limit the bot frees what it can (caches, temp files, garbage)
// instead of restarting. Node built-ins only, so any module can register a cache here without an import cycle.
import v8 from 'node:v8';
import vm from 'node:vm';

const caches = new Map();

/**
 * Registers a cache that can be emptied when memory runs short. It fills up again by itself.
 * @param {string} name
 * @param {(level: 'soft'|'hard') => void} clear - soft: give back what is cheap to get again, hard: as much as possible
 */
export const registerCache = (name, clear) => {
	caches.set(name, clear);
};

/** Drops the oldest entries of a Map until `keep` are left (a Map keeps the order the entries were added in). */
export const trimMap = (map, keep) => {
	while (map.size > keep) map.delete(map.keys().next().value);
};

// global.gc only exists when node runs with --expose-gc; v8 can switch it on while running
let collect = typeof globalThis.gc === 'function' ? globalThis.gc : undefined;
const garbageCollector = () => {
	if (collect) return collect;
	try {
		v8.setFlagsFromString('--expose-gc');
		collect = vm.runInNewContext('gc');
	} catch {
		collect = undefined;
	}
	return collect;
};

/** How much of the memory the bot is using: the process (rss) and the JavaScript heap. */
export const memoryReading = () => {
	const heap = v8.getHeapStatistics();
	return {
		rssMB: process.memoryUsage.rss() / 1048576,
		heapMB: heap.used_heap_size / 1048576,
		heapRatio: heap.used_heap_size / heap.heap_size_limit
	};
};

/**
 * Frees memory: empties the registered caches, then runs the garbage collector.
 * @param {'soft'|'hard'} [level]
 * @returns {{rssBeforeMB: number, rssAfterMB: number, collected: boolean}}
 */
export const freeMemory = (level = 'soft') => {
	const before = process.memoryUsage.rss();
	for (const [name, clear] of caches) {
		try {
			clear(level);
		} catch (err) {
			console.log(`[memory] could not empty ${name}:`, err?.message || err);
		}
	}
	const gc = garbageCollector();
	if (gc) {
		gc();
		if (level === 'hard') gc(); // the second pass takes what the first one released
	}
	return { rssBeforeMB: before / 1048576, rssAfterMB: process.memoryUsage.rss() / 1048576, collected: !!gc };
};

import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

// FFMPEG_PATH lets a host use its own ffmpeg and skip the bundled binary.
ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH || ffmpegInstaller.path);

/** An ffmpeg command limited to one thread (more threads only add memory and context switching on a small CPU share). */
export const ff = (...args) => ffmpeg(...args).addOutputOptions(['-threads', '1']);

// Conversions run one at a time. Two encodes in parallel take as long as two in a row and double the memory.
let tail = Promise.resolve();
const JOB_TIMEOUT = 3 * 60_000;

export const ffmpegQueue = job => {
	const run = tail.then(job, job);
	let timer;
	const guard = Promise.race([run, new Promise(resolve => (timer = setTimeout(resolve, JOB_TIMEOUT)))]);
	tail = guard.finally(() => clearTimeout(timer)).catch(() => {});
	return run;
};

export default ffmpeg;

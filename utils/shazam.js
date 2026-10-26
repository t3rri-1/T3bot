import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { ff, ffmpegQueue } from './ffmpeg.js';

const AUDD_TOKEN = process.env.AUDD_TOKEN || 'test';

export async function identifyAudio(buffer) {
	const form = new FormData();
	form.append('file', new Blob([buffer], { type: 'audio/mpeg' }), 'sample.mp3');
	form.append('api_token', AUDD_TOKEN);
	form.append('return', 'spotify,apple_music');

	const res = await fetch('https://api.audd.io/', {
		method: 'POST',
		body: form,
		signal: AbortSignal.timeout(45_000)
	});

	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const data = await res.json();

	if (data.status === 'error') throw new Error(data.error?.error_message || 'AudD returned an error');
	if (data.status !== 'success' || !data.result) return null;
	return data.result;
}


export async function toAudioSample(buffer, seconds = 30) {
	const id = `${Date.now()}_${randomBytes(3).toString('hex')}`;
	const input = path.join(os.tmpdir(), `shazam_${id}.in`); // os.tmpdir() is ./tmp, swept by lib/maintenance.js
	const output = path.join(os.tmpdir(), `shazam_${id}.mp3`);
	await fs.promises.writeFile(input, buffer);
	try {
		await ffmpegQueue(
			() =>
				new Promise((resolve, reject) => {
					ff(input)
						.noVideo()
						.audioChannels(1)
						.audioFrequency(44100)
						.audioCodec('libmp3lame')
						.audioBitrate('128k')
						.duration(seconds)
						.format('mp3')
						.on('end', resolve)
						.on('error', reject)
						.save(output);
				})
		);
		return await fs.promises.readFile(output);
	} finally {
		fs.promises.unlink(input).catch(() => {});
		fs.promises.unlink(output).catch(() => {});
	}
}

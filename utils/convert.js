import fs from 'fs';
import path from 'path';
import os from 'os';
import { randomBytes } from 'crypto';
import axios from 'axios';
import FormData from 'form-data';
import { ff, ffmpegQueue } from './ffmpeg.js';
import { getSharp } from './sharp.js';
import { config } from '#config';

const { writeFileSync, existsSync, readFileSync, mkdirSync } = fs;

// os.tmpdir() is ./tmp (index.js sets TMPDIR), which lib/maintenance.js sweeps every few minutes.
const tempDir = path.join(os.tmpdir(), 'media-temp');
if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true });

function temp(ext) {
	return path.join(tempDir, `${Date.now()}_${randomBytes(3).toString('hex')}.${ext}`);
}

const remove = file => fs.promises.unlink(file).catch(() => {});

export const GIFBufferToVideoBuffer = async image => {
	const gifPath = temp('gif');
	const mp4Path = temp('mp4');
	writeFileSync(gifPath, image);
	try {
		await ffmpegQueue(
			() =>
				new Promise((resolve, reject) => {
					ff()
						.input(gifPath)
						.outputOptions([
							'-movflags faststart',
							'-pix_fmt yuv420p',
							'-vf scale=trunc(iw/2)*2:trunc(ih/2)*2'
						])
						.toFormat('mp4')
						.save(mp4Path)
						.on('end', resolve)
						.on('error', reject);
				})
		);
		return readFileSync(mp4Path);
	} finally {
		await Promise.all([remove(mp4Path), remove(gifPath)]);
	}
};

export async function audioToBlackVideo(input) {
	const video = temp('mp4');

	// A black screen carries no detail, so a small low-fps frame is enough and costs a fraction of 1080p30.
	return ffmpegQueue(
		() =>
			new Promise((resolve, reject) => {
				ff()
					.input(`color=black:s=640x360:r=15`)
					.inputOptions(['-f', 'lavfi'])
					.input(input)
					.outputOptions([
						'-c:v',
						'libx264',
						'-preset',
						'ultrafast',
						'-crf',
						'30',
						'-pix_fmt',
						'yuv420p',
						'-c:a',
						'aac',
						'-b:a',
						'128k',
						'-map',
						'0:v',
						'-map',
						'1:a',
						'-shortest'
					])
					.output(video)
					.on('end', () => resolve(fs.readFileSync(video)))
					.on('error', reject)
					.run();
			})
	);
}

export async function flipMedia(file, direction) {
	const outputFile = path.join(tempDir, `flipped_${path.basename(file)}`);
	const validDirections = {
		left: 'transpose=2',
		right: 'transpose=1',
		vertical: 'vflip',
		horizontal: 'hflip'
	};

	return ffmpegQueue(
		() =>
			new Promise((resolve, reject) => {
				ff(file)
					.videoFilters(validDirections[direction])
					.on('end', () => resolve(fs.readFileSync(outputFile)))
					.on('error', reject)
					.save(outputFile);
			})
	);
}

export async function webpToImage(input) {
	const outputImage = temp('jpg');

	return ffmpegQueue(
		() =>
			new Promise((resolve, reject) => {
				ff(input)
					.output(outputImage)
					.on('end', () => resolve(fs.readFileSync(outputImage)))
					.on('error', reject)
					.run();
			})
	);
}

export function convertToMp3(input) {
	const outputAudio = temp('mp3');

	return ffmpegQueue(
		() =>
			new Promise((resolve, reject) => {
				ff(input)
					.toFormat('mp3')
					.audioCodec('libmp3lame')
					.audioBitrate(192)
					.on('end', () => resolve(readFileSync(outputAudio)))
					.on('error', reject)
					.save(outputAudio);
			})
	);
}

export function toPTT(input) {
	const outputAudio = temp('opus');

	return ffmpegQueue(
		() =>
			new Promise((resolve, reject) => {
				ff(input)
					.toFormat('opus')
					.audioCodec('libopus')
					.audioChannels(1) // Mono audio
					.audioFrequency(48000) // Standard Opus sample rate
					.audioBitrate('128k')
					.outputOptions([
						'-application voip' // Optimize for voice
					])
					.on('end', () => resolve(readFileSync(outputAudio)))
					.on('error', (err, stdout, stderr) => {
						reject(new Error(`FFmpeg error: ${err.message}\n${stderr}`));
					})
					.save(outputAudio);
			})
	);
}

export function toVideo(input) {
	const outputVideo = temp('mp4');

	return ffmpegQueue(
		() =>
			new Promise((resolve, reject) => {
				ff(input)
					.videoCodec('libx264')
					.audioCodec('aac')
					.audioBitrate(128)
					.audioFrequency(44100)
					// "slow" costs several times the CPU of "veryfast" for a file that is already crf 32
					.outputOptions(['-crf 32', '-preset veryfast'])
					.on('end', () => resolve(readFileSync(outputVideo)))
					.on('error', reject)
					.save(outputVideo);
			})
	);
}

export const cropToCircle = async input => {
	try {
		const sharp = await getSharp();
		const image = sharp(input);
		const { width, height } = await image.metadata();
		const circleMask = Buffer.from(
			`<svg width="${width}" height="${height}">
		<circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) / 2}" fill="white"/>
	  </svg>`
		);

		const croppedImage = await image
			.composite([{ input: circleMask, blend: 'dest-in' }])
			.toFormat('webp', { quality: 50 })
			.toBuffer();
		return croppedImage;
	} catch (error) {
		console.error('Error cropping image to circle:', error);
		throw error;
	}
};

export async function resizeImage(imageBuffer, width, height) {
	if (!Buffer.isBuffer(imageBuffer)) {
		throw new Error('The imageBuffer parameter must be a valid Buffer.');
	}

	const sharp = await getSharp();
	return sharp(imageBuffer)
		.resize(width, height, {
			fit: 'inside',
			withoutEnlargement: true
		})
		.toBuffer();
}

export const isAnimatedWebp = async filePath => {
	const sharp = await getSharp();
	const metadata = await sharp(filePath).metadata();
	return metadata.pages > 1; // If pages > 1, it's animated
};

export const convertWebPFile = async input => {
	try {
		const form = new FormData();
		if (Buffer.isBuffer(input)) {
			form.append('file', input, {
				filename: `${Date.now()}.webp`,
				contentType: 'image/webp'
			});
		} else {
			form.append('file', readFileSync(input), {
				filename: path.basename(input),
				contentType: 'image/webp'
			});
		}

		const { data } = await axios.post(`${config.API_ID}/api/webpmp4`, form, {
			headers: {
				...form.getHeaders()
			},
			maxBodyLength: Infinity,
			maxContentLength: Infinity
		});

		return data.url;
	} catch (error) {
		console.error('Error converting file:', error.message);
		throw error;
	}
};

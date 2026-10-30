import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { createReadStream, existsSync, promises as fsp } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { createDecipheriv, createHash, randomBytes, randomInt, randomUUID } from 'crypto';
import axios from 'axios';
import FormData from 'form-data';
import yts from 'yt-search';
import { FileTypeFromBuffer, getJson, delay, detectType } from './utils.js';
import { extractUrl, isTikTok } from './main.js';
import { registerCache } from '../lib/memory.js';

/**
 * Enhances or filters images using the Vyro AI API.
 * @async
 * @param {Buffer|string} image - The image buffer or file path to process
 * @param {string} [filterType='enhance'] - The type of filter to apply ('enhance', 'recolor', or 'dehaze')
 * @returns {Promise<Buffer>} A buffer containing the processed image data
 * @throws {Error} If the API request fails
 */

export const remini = async (image, filterType) => {
	const availableFilters = ['enhance', 'recolor', 'dehaze'];
	const selectedFilter = availableFilters.includes(filterType) ? filterType : availableFilters[0];
	const apiUrl = `https://inferenceengine.vyro.ai/${selectedFilter}`;

	const form = new FormData();
	form.append('model_version', 1);

	const imageBuffer = Buffer.isBuffer(image) ? image : readFileSync(image);
	form.append('image', imageBuffer, {
		filename: 'enhance_image_body.jpg',
		contentType: 'image/jpeg'
	});
	const response = await axios.post(apiUrl, form, {
		headers: {
			...form.getHeaders(),
			'User-Agent': 'okhttp/4.9.3',
			Connection: 'Keep-Alive',
			'Accept-Encoding': 'gzip'
		},
		responseType: 'arraybuffer'
	});
	return Buffer.from(response.data);
};

/**
 * Uploads a file to Catbox hosting service.
 * @async
 * @param {Buffer} mediaBuffer - The buffer containing the file data to upload
 * @returns {Promise<string>} The URL of the uploaded file
 * @throws {Error} If the file type cannot be determined or if the upload fails
 */
export const uploadFile = async mediaBuffer => {
	const fileType = await FileTypeFromBuffer(mediaBuffer);
	if (!fileType) throw new Error('Unable to determine the file type of the media.');
	const filename = `file.${fileType}`;
	const tempPath = path.join(tmpdir(), `${Date.now()}_${Math.random().toString(36).slice(2, 6)}_${filename}`);
	writeFileSync(tempPath, mediaBuffer);

	const form = new FormData();
	form.append('fileToUpload', createReadStream(tempPath), {
		filename,
		contentType: fileType
	});
	form.append('reqtype', 'fileupload');

	const response = await axios.post('https://catbox.moe/user/api.php', form, {
		headers: form.getHeaders()
	});
	const url = response.data.trim();
	unlinkSync(tempPath);
	return url;
};

/**
 * Removes the background from an image using the remove.bg API
 * @param {Buffer} buffer - The input image buffer
 * @returns {Promise<Buffer>} A buffer containing the image with removed background
 * @throws {Error} If the API request fails
 * @async
 */
export async function removeBg(buffer) {
	const formData = new FormData();
	const type = await FileTypeFromBuffer(buffer);
	const inputPath = path.join(tmpdir(), `${Date.now()}_${Math.random().toString(36).slice(2, 6)}_temp_image.${type}`);
	writeFileSync(inputPath, buffer);
	formData.append('size', 'auto');
	formData.append('image_file', createReadStream(inputPath), path.basename(inputPath));
	const { status, data } = await axios.post('https://api.remove.bg/v1.0/removebg', formData, {
		responseType: 'arraybuffer',
		headers: {
			...formData.getHeaders(),
			'X-Api-Key': 'FjyTadatkyWixWGWUCUDTF7J'
		},
		encoding: null
	});
	unlinkSync(inputPath);
	return data;
}

/**
 * Uploads a file to Uguu.se hosting service
 * @param {(Buffer|string)} input - The file to upload, either as a Buffer or file path string
 * @returns {Promise<string>} A promise that resolves to the URL of the uploaded file
 * @throws {Error} Will throw an error if the input type is invalid or if the upload fails
 * @async
 */
export async function UguuUpload(input) {
	return new Promise(async (resolve, reject) => {
		const form = new FormData();
		let fileStream;

		if (Buffer.isBuffer(input)) {
			fileStream = input;
			form.append('files[]', fileStream, 'uploaded-file.jpg');
		} else if (typeof input === 'string') {
			fileStream = createReadStream(input);
			form.append('files[]', fileStream);
		} else {
			return reject(new Error('Invalid input type'));
		}

		try {
			const response = await axios({
				url: 'https://uguu.se/upload.php',
				method: 'POST',
				headers: {
					'User-Agent':
						'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.212 Safari/537.36',
					...form.getHeaders()
				},
				data: form
			});
			resolve(response.data.files[0].url);
		} catch (error) {
			reject(error);
		}
	});
}

/**
 * Scrapes Pinterest for images based on a search query.
 * @param {string} query - The search term to look for on Pinterest.
 * @returns {Promise<{status: number, url: string}>} A promise that resolves to an object containing:
 *   - status: HTTP status code (200 if successful)
 *   - url: URL of a randomly selected image from the search results
 * @throws {Error} If the Pinterest request fails
 */
export function pinterest(query) {
	return new Promise((resolve, reject) => {
		axios(
			`https://www.pinterest.com/resource/BaseSearchResource/get/?source_url=%2Fsearch%2Fpins%2F%3Fq%3D${query}&data=%7B%22options%22%3A%7B%22isPrefetch%22%3Afalse%2C%22query%22%3A%22${query}%22%2C%22scope%22%3A%22pins%22%2C%22no_fetch_context_on_resource%22%3Afalse%7D%2C%22context%22%3A%7B%7D%7D&_=1619980301559`
		)
			.then(data => {
				const random =
					data.data.resource_response.data.results[
						Math.floor(Math.random() * data.data.resource_response.data.results.length)
					];
				var result = [];
				result = {
					status: 200,
					url: random.images.orig.url
				};
				resolve(result);
			})
			.catch(reject);
	});
}

export async function UploadFileUgu(input) {
	const form = new FormData();
	form.append('files[]', createReadStream(input));

	const { data } = await axios.post('https://uguu.se/upload.php', form, {
		headers: {
			'User-Agent':
				'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.212 Safari/537.36',
			...form.getHeaders()
		}
	});

	return data.files[0];
}

const BROWSER_UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const http = axios.create({ timeout: 30_000, headers: { 'User-Agent': BROWSER_UA } });

/* ───────────────────────────────── YouTube ─────────────────────────────────
 * The downloader flow (Savetube, ytmp3.ing for audio) is based on ytmp3.js by Febry Wesker. Every backend is asked at
 * once and the first one to answer with a link wins.
 */

const YT_ID = /^[\w-]{11}$/;
const watchUrl = id => `https://www.youtube.com/watch?v=${id}`;

/**
 * Pulls the 11 character video id out of a YouTube link (watch, youtu.be, shorts, embed, live) or a bare id.
 * @param {string} input
 * @returns {string|null}
 */
export const getVideoId = input => {
	const text = String(input || '').trim();
	if (YT_ID.test(text)) return text;
	const link = extractUrl(text);
	if (!link) return null;
	try {
		const url = new URL(link);
		const host = url.hostname.replace(/^(www|m|music)\./, '');
		let id = null;
		if (host === 'youtu.be') id = url.pathname.split('/')[1];
		else if (host === 'youtube.com') {
			id = url.searchParams.get('v') || url.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{11})/)?.[1];
		}
		return YT_ID.test(id || '') ? id : null;
	} catch {
		return null;
	}
};

/**
 * Searches YouTube.
 * @param {string} query
 * @returns {Promise<Array>} yt-search video objects (videoId, title, author, timestamp, views, thumbnail ...)
 */
export const ytSearch = async query => {
	const { videos } = await yts(query);
	return (videos || []).filter(video => video.videoId);
};

// Savetube answers /v2/info with base64( iv[16] + AES-128-CBC ciphertext ) of a JSON text.
const SAVETUBE_KEY = Buffer.from('C5D58EF67A7584E4A29F6C35BBC4EB12', 'hex');

const savetubeDecrypt = base64 => {
	const raw = Buffer.from(base64, 'base64');
	const decipher = createDecipheriv('aes-128-cbc', SAVETUBE_KEY, raw.subarray(0, 16));
	const text = Buffer.concat([decipher.update(raw.subarray(16)), decipher.final()]).toString('utf8');
	return JSON.parse(text);
};

async function savetube(videoUrl, { type, quality }) {
	const { data: pick } = await http.get('https://media.savetube.vip/api/random-cdn');
	const cdn = pick?.cdn;
	if (!cdn) throw new Error('Savetube gave no server');

	const { data } = await http.post(`https://${cdn}/v2/info`, { url: videoUrl });
	if (!data?.status) throw new Error(data?.message || 'Savetube could not read that video');
	const info = savetubeDecrypt(data.data);

	const { data: dl } = await http.post(`https://${cdn}/download`, {
		downloadType: type,
		quality: String(quality),
		key: info.key
	});
	const downloadUrl = dl?.data?.downloadUrl;
	if (!downloadUrl) throw new Error(dl?.message || 'Savetube gave no download link');

	return {
		title: info.title,
		thumbnail: info.thumbnail,
		duration: info.durationLabel,
		downloadUrl,
		format: type === 'audio' ? 'mp3' : 'mp4'
	};
}

// Audio only. It has no quality choice, so it is just the backup for Savetube.
async function ytmp3Ing(videoUrl) {
	const page = await http.get('https://ytmp3.ing/');
	const cookie = (page.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
	const csrf = String(page.data).match(/value="([^"]+)"/)?.[1];
	if (!csrf) throw new Error('ytmp3.ing gave no CSRF token');

	const form = new FormData();
	form.append('url', videoUrl);
	const { data } = await http.post('https://ytmp3.ing/audio', form, {
		headers: { ...form.getHeaders(), 'x-csrftoken': csrf, cookie }
	});
	if (!data?.url) throw new Error('ytmp3.ing gave no download link');

	return {
		title: data.filename || 'Unknown',
		downloadUrl: Buffer.from(data.url, 'base64').toString('utf8'),
		format: 'mp3'
	};
}

// A YouTube link goes straight through, anything else is searched and the first result is used.
async function resolveVideo(input) {
	const text = String(input || '').trim();
	const link = extractUrl(text);
	const id = link ? getVideoId(link) : null;
	if (id) return { id, url: watchUrl(id) };

	const [first] = await ytSearch(text);
	if (!first) throw new Error('No YouTube results found');
	return {
		id: first.videoId,
		url: watchUrl(first.videoId),
		title: first.title,
		author: first.author?.name || '',
		thumbnail: first.thumbnail || first.image || '',
		duration: first.timestamp || ''
	};
}

// ssyoutube lists the formats of the video: this picks the one that fits the request and puts it in the shape of the others
async function ssyoutubeBackend(videoUrl, { type, quality }) {
	const result = await ssyoutube(videoUrl);
	if (result.error) throw new Error(result.error);

	const height = item => Number.parseInt(item.quality, 10) || 0;
	let pick;
	if (type === 'audio') {
		// WhatsApp plays m4a and mp3, but not opus
		pick = result.downloads.find(item => item.audio && /^(m4a|mp3)$/i.test(item.format));
	} else {
		const videos = result.downloads.filter(item => !item.audio && /^mp4$/i.test(item.format));
		const wanted = Number(quality) || 720;
		// the best resolution that is not above the one asked for, otherwise the lowest there is
		pick =
			videos.filter(item => height(item) <= wanted).sort((a, b) => height(b) - height(a))[0] ||
			videos.sort((a, b) => height(a) - height(b))[0];
	}
	if (!pick) throw new Error('ssyoutube had no usable format');

	return {
		title: result.meta?.title || 'Unknown',
		thumbnail: result.meta?.thumbnail,
		duration: result.meta?.duration,
		downloadUrl: pick.url,
		format: type === 'audio' ? String(pick.format).toLowerCase() : 'mp4'
	};
}

async function youtube(input, { type, quality }) {
	const video = await resolveVideo(input);
	const backends = [
		{ name: 'savetube', run: () => savetube(video.url, { type, quality }) },
		{ name: 'ssyoutube', run: () => ssyoutubeBackend(video.url, { type, quality }) }
	];
	if (type === 'audio') backends.push({ name: 'ytmp3ing', run: () => ytmp3Ing(video.url) });

	// They all start now and the first link to arrive is the answer. The ones still running finish on their own
	// and their result is dropped.
	const attempts = backends.map(async backend => {
		try {
			return { status: true, backend: backend.name, video, download: await backend.run() };
		} catch (err) {
			console.error(`[youtube] ${backend.name} failed: ${err.message}`);
			throw err;
		}
	});
	try {
		return await Promise.any(attempts);
	} catch (err) {
		const reasons = (err.errors || []).map(e => e?.message).filter(Boolean);
		throw new Error(`All download backends failed. ${reasons.join(' | ')}`.trim());
	}
}

/**
 * YouTube audio. It is an mp3 from Savetube / ytmp3.ing and an m4a from ssyoutube, whichever answers first
 * (download.format says which). Nothing is converted.
 * @param {string} input - A YouTube link or a search text (the first result is used)
 * @param {{quality?: string}} [options] - Bitrate, 256 by default
 * @returns {Promise<{status: boolean, backend: string, video: object, download: {title: string, downloadUrl: string, format: 'mp3'|'m4a'}}>}
 */
export const ytmp3 = (input, { quality = '256' } = {}) => youtube(input, { type: 'audio', quality });

/**
 * YouTube video as an mp4, from whichever backend answers first.
 * @param {string} input - A YouTube link or a search text (the first result is used)
 * @param {{quality?: string}} [options] - Resolution, 720 by default
 * @returns {Promise<{status: boolean, backend: string, video: object, download: {title: string, downloadUrl: string, format: string}}>}
 */
export const ytmp4 = (input, { quality = '720' } = {}) => youtube(input, { type: 'video', quality });

/* ───────────────────────────────── Instagram ───────────────────────────────── */

/**
 * Gets the media of an Instagram post, reel or story.
 * @param {string} url
 * @returns {Promise<{status: boolean, username: string, title: string, caption: string, thumbnail: string, avatar: string, media: Array<{type: 'video'|'image', url: string, thumbnail: string}>}>}
 */
export async function instagramDownloader(url) {
	const { data } = await http.get('https://api.azbry.com/api/download/instagramv2', { params: { url } });
	if (!data || !data.status || !Array.isArray(data.links) || data.links.length === 0) {
		throw new Error('Could not get any media from the Instagram API');
	}

	const media = data.links.map(item => {
		const itemType = String(item.type || '').toLowerCase();
		const itemUrl = String(item.url || '').toLowerCase();
		const isVideo = itemType === 'video' || itemType === 'mp4' || itemUrl.includes('.mp4');
		return {
			type: isVideo ? 'video' : 'image',
			url: item.url,
			thumbnail: item.thumbnail || ''
		};
	});

	const firstLink = data.links[0] || {};
	const captionText = firstLink.text && firstLink.text !== 'null' ? firstLink.text.trim() : '';
	const authorName = data.author && data.author !== 'Unknown' ? data.author : '-';

	return {
		status: true,
		username: authorName,
		title: captionText || authorName,
		caption: captionText,
		thumbnail: firstLink.thumbnail || data.thumbnail || '',
		avatar: data.avatar || '',
		media
	};
}

/* ───────────────────────────────── Spotify ───────────────────────────────── */

/**
 * Gets the download link of a Spotify track.
 * @param {string} spotifyUrl
 * @returns {Promise<{title: string, artist: string, mime: string, downloadUrl: string}>}
 */
export async function downloadSpotify(spotifyUrl) {
	const { data } = await http.post(
		'https://spotyloader.com/api/spotify/track',
		{ url: spotifyUrl },
		{
			headers: {
				'Content-Type': 'application/json',
				Referer: 'https://spotyloader.com/',
				Origin: 'https://spotyloader.com'
			}
		}
	);
	if (!data?.downloadLink) throw new Error('Could not get a download link for that Spotify track');

	return {
		title: data.post?.name || '',
		artist: data.post?.artist || '',
		mime: data.post?.mime || 'audio/mpeg',
		downloadUrl: data.downloadLink
	};
}

/**
 * Takes a Spotify track link out of a text and drops the tracking query from it.
 * @param {string} input
 * @returns {string|null} null when there is no track link in the text
 */
export const cleanSpotifyLink = input => {
	const link = extractUrl(String(input || ''));
	if (!link) return null;
	try {
		const url = new URL(link);
		if (url.hostname !== 'open.spotify.com') return null;
		const id = url.pathname.match(/\/track\/([A-Za-z0-9]+)/)?.[1];
		return id ? `https://open.spotify.com/track/${id}` : null;
	} catch {
		return null;
	}
};

/* ───────────────────────────────── TikTok ───────────────────────────────── */

const TIKTOK_API = 'https://aj-ibra.zone.id/api/tiktok';
const TIKTOK_CACHE_MS = 10 * 60_000;
const tiktokCache = new Map();
registerCache('tiktok-links', () => tiktokCache.clear());

/**
 * Takes a TikTok link out of a text and drops the tracking query from it.
 * @param {string} input
 * @returns {string|null}
 */
export const cleanTikTokLink = input => {
	const link = extractUrl(String(input || ''));
	if (!link || !isTikTok(link)) return null;
	try {
		const url = new URL(link);
		return `${url.origin}${url.pathname}`;
	} catch {
		return null;
	}
};

/**
 * Gets a TikTok post (video, music, photos, stats). Answers are kept for 10 minutes.
 * @param {string} link - A link that went through cleanTikTokLink
 * @returns {Promise<object|null>} null when the post could not be fetched
 */
export const getTikTok = async link => {
	const hit = tiktokCache.get(link);
	if (hit && Date.now() - hit.at < TIKTOK_CACHE_MS) return hit.data;
	const res = await getJson(`${TIKTOK_API}?url=${encodeURIComponent(link)}`).catch(() => null);
	if (!res?.success || !res.result) return null;
	tiktokCache.set(link, { at: Date.now(), data: res.result });
	if (tiktokCache.size > 30) tiktokCache.delete(tiktokCache.keys().next().value);
	return res.result;
};

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * More scrapers
 *
 * Every one of these is a small client for a public web service, so any of them can stop working when the
 * site behind it changes. They throw (or answer { status: false }) when that happens, and the commands in
 * plugins/ pass that on to the user instead of crashing.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

const ANDROID_UA =
	'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36';
const ANDROID_HINTS = {
	'sec-ch-ua': '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
	'sec-ch-ua-mobile': '?1',
	'sec-ch-ua-platform': '"Android"'
};

// The video / image tools of fgsi.dpdns.org. Set FGSI_API_KEY to use your own key.
const FGSI_KEY = process.env.FGSI_API_KEY || 'fgsiapi-20c1605c-6d';

// cheerio is loaded on first use: a host that has not installed it yet only loses the scrapers that read HTML
const loadCheerio = () => import('cheerio');

const toBuffer = input => (Buffer.isBuffer(input) ? input : readFileSync(input));

/**
 * Looks through a JSON answer for a link. Several of the services here answer in a shape that is not documented,
 * so the keys in `prefer` are tried first (in that order), then the first link found anywhere in the answer
 * (links under keys like thumbnail or cover come last).
 * @param {*} value
 * @param {string[]} [prefer] - lower case key names
 * @returns {string|null}
 */
export function findMediaUrl(value, prefer = []) {
	const found = [];
	const walk = (node, key) => {
		if (typeof node === 'string') {
			if (/^https?:\/\//i.test(node)) found.push({ key: key.toLowerCase(), url: node });
		} else if (Array.isArray(node)) {
			for (const item of node) walk(item, key);
		} else if (node && typeof node === 'object') {
			for (const [name, item] of Object.entries(node)) walk(item, name);
		}
	};
	walk(value, '');
	for (const wanted of prefer) {
		const hit = found.find(item => item.key === wanted);
		if (hit) return hit.url;
	}
	// no preferred key: the first link that is not a picture of the post (thumbnail, cover, avatar ...)
	return (found.find(item => !/thumb|cover|avatar|icon|poster|preview/.test(item.key)) || found[0])?.url || null;
}

// Hands a streamed answer (server-sent events / ndjson) over one line at a time
async function readStreamLines(response, onLine) {
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	while (true) {
		const { value, done } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		const lines = buffer.split('\n');
		buffer = lines.pop() || '';
		for (const line of lines) onLine(line);
	}
	if (buffer.trim()) onLine(buffer);
}

// The scrapers that upload a file by path take a Buffer too: it is written to a temp file for the upload only.
async function withTempFile(input, ext, run) {
	if (!input) throw new Error('A file or a Buffer is required');
	if (!Buffer.isBuffer(input)) {
		if (!existsSync(input)) throw new Error(`File not found: ${input}`);
		return run(input);
	}
	const file = path.join(tmpdir(), `${Date.now()}_${randomBytes(3).toString('hex')}.${ext}`);
	await fsp.writeFile(file, input);
	try {
		return await run(file);
	} finally {
		fsp.unlink(file).catch(() => {});
	}
}

const videoMime = file => {
	const ext = path.extname(String(file)).toLowerCase();
	return { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska' }[ext] || 'video/mp4';
};

/* ───────────────────────────────── AI chat ───────────────────────────────── */

const OVERCHAT_API = 'https://api.overchat.ai/v1/chat/completions';

// GPT5 and Qwen3 talk to the same service, only the model and the persona differ.
async function overchat({ prompt, model, personaId, chatId, deviceId, history = [], tail = [] }) {
	const messages = [
		...history.map(item => ({ id: randomUUID(), role: item.role, content: item.content })),
		{ id: randomUUID(), role: 'user', content: prompt },
		...tail.map(content => ({ id: randomUUID(), role: 'system', content }))
	];

	const response = await fetch(OVERCHAT_API, {
		method: 'POST',
		headers: {
			...ANDROID_HINTS,
			'x-device-uuid': deviceId,
			'x-device-language': 'id-ID',
			'x-device-platform': 'web',
			'x-device-version': '1.0.44',
			'user-agent': ANDROID_UA,
			accept: '*/*',
			'content-type': 'application/json',
			origin: 'https://overchat.ai',
			referer: 'https://overchat.ai/',
			'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
			priority: 'u=1, i'
		},
		body: JSON.stringify({
			chatId,
			model,
			messages,
			personaId,
			frequency_penalty: 0,
			max_tokens: 4000,
			presence_penalty: 0,
			stream: true,
			temperature: 0.5,
			top_p: 0.95
		}),
		signal: AbortSignal.timeout(120_000)
	});

	if (!response.ok) return { ok: false, code: response.status, error: await response.text() };

	let answer = '';
	let responseId = null;
	let responseModel = null;
	await readStreamLines(response, rawLine => {
		const line = rawLine.trim();
		if (!line.startsWith('data:')) return;
		const data = line.slice(5).trim();
		if (!data || data === '[DONE]') return;
		try {
			const json = JSON.parse(data);
			if (json.id) responseId = json.id;
			if (json.model) responseModel = json.model;
			const content = json.choices?.[0]?.delta?.content;
			if (typeof content === 'string') answer += content;
		} catch {
			// a line that is not JSON is skipped
		}
	});
	return { ok: true, code: response.status, answer, responseId, responseModel };
}

/**
 * Chat with GPT (overchat.ai, gpt-4.1 nano).
 * @param {string} prompt
 * @param {{chatId?: string, deviceId?: string, model?: string, history?: {role: string, content: string}[]}} [options]
 * @returns {Promise<{status: boolean, code: number, answer?: string, error?: string}>}
 */
export async function GPT5(prompt, options = {}) {
	const chatId = options.chatId || randomUUID();
	const deviceId = options.deviceId || randomUUID();
	const model = options.model || 'openai/gpt-4.1-nano-2025-04-14';
	const res = await overchat({
		prompt,
		model,
		personaId: 'gpt-4o-landing',
		chatId,
		deviceId,
		history: options.history
	});
	if (!res.ok) return { status: false, code: res.code, error: res.error };
	return {
		status: true,
		code: res.code,
		chatId,
		deviceId,
		responseId: res.responseId,
		model: res.responseModel || model,
		answer: res.answer
	};
}

/**
 * Chat with Qwen3 (overchat.ai).
 * @param {string} prompt
 * @param {{chatId?: string, deviceId?: string, history?: {role: string, content: string}[]}} [options]
 * @returns {Promise<{status: boolean, code: number, model: string, answer?: string, error?: string}>}
 */
export async function Qwen3(prompt, options = {}) {
	const model = 'alibaba/qwen3-next-80b-a3b-instruct';
	const res = await overchat({
		prompt,
		model,
		personaId: 'qwen-3-landing',
		chatId: options.chatId || randomUUID(),
		deviceId: options.deviceId || randomUUID(),
		history: options.history,
		tail: ['Ikuti bahasa user dan jawab dengan gaya natural, singkat, dan jelas.']
	});
	if (!res.ok) return { status: false, code: res.code, model, error: res.error };
	return { status: true, code: res.code, model, question: prompt, answer: res.answer };
}

const FEELBETTER_API = 'https://feelbetterbot.com/';
const FEELBETTER_SYSTEM =
	'Kamu adalah asisten AI yang dibuat oleh Ditzzx. Ikuti bahasa yang digunakan user dalam percakapan. Jika user memakai bahasa Indonesia, jawab dalam bahasa Indonesia yang natural, santai, jelas, dan mudah dipahami. Jangan tiba-tiba pindah bahasa kecuali user memintanya. Jika user bertanya siapa pembuatmu, penciptamu, developermu, atau siapa yang membuatmu, jawab bahwa pembuatmu adalah Ditzzx.';
const FEELBETTER_GREETING =
	"Hi, I'm FeelBetterBot — I'm here to listen and help you carry whatever feels heavy, without judgment. I draw on gentle, proven ways of working through hard things, but mostly I just want to understand what you're going through. So, how are you doing right now?";

const feelbetterMemoryId = () => {
	const animals = ['owl', 'fox', 'cat', 'wolf', 'bear', 'lion', 'deer', 'bird'];
	const words = ['safe', 'calm', 'soft', 'kind', 'warm', 'bright', 'gentle'];
	const pick = list => list[Math.floor(Math.random() * list.length)];
	return `${pick(words)}-${pick(animals)}-${Math.floor(1000 + Math.random() * 9000)}`;
};

// One line of the streamed answer: plain text, or JSON in one of the shapes the service has used
function feelbetterChunk(line) {
	let data = line.trim();
	if (!data || data === '[DONE]') return '';
	if (data.startsWith('data:')) data = data.slice(5).trim();
	if (!data || data === '[DONE]') return '';
	try {
		const json = JSON.parse(data);
		if (typeof json === 'string') return json;
		for (const key of ['content', 'text', 'delta', 'message', 'response', 'answer']) {
			if (typeof json[key] === 'string') return json[key];
		}
		const openAi = json.choices?.[0]?.delta?.content;
		return typeof openAi === 'string' ? openAi : '';
	} catch {
		return data;
	}
}

/**
 * Chat with FeelBetterBot, a listening / support bot.
 * @param {string} prompt
 * @param {{memoryId?: string, history?: {role: string, content: string}[], system?: string}} [options]
 *   `system` replaces the built-in instructions (which say the bot was made by Ditzzx).
 * @returns {Promise<{status: boolean, code: number, answer?: string, error?: string}>}
 */
export async function FeelBetter(prompt, options = {}) {
	const memoryId = options.memoryId || feelbetterMemoryId();
	const messages = [
		{ role: 'system', content: options.system || FEELBETTER_SYSTEM },
		{ role: 'assistant', content: FEELBETTER_GREETING },
		...(options.history || []).map(item => ({ role: item.role, content: item.content })),
		{ role: 'user', content: prompt }
	];

	const response = await fetch(FEELBETTER_API, {
		method: 'POST',
		headers: {
			...ANDROID_HINTS,
			'user-agent': ANDROID_UA,
			'content-type': 'application/json',
			accept: '*/*',
			origin: 'https://feelbetterbot.com',
			referer: 'https://feelbetterbot.com/',
			'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
			cookie: `feelbet-memory=${memoryId}`,
			priority: 'u=1, i'
		},
		body: JSON.stringify({ messages }),
		signal: AbortSignal.timeout(120_000)
	});

	if (!response.ok) return { status: false, code: response.status, memoryId, error: await response.text() };

	let answer = '';
	await readStreamLines(response, line => {
		answer += feelbetterChunk(line);
	});
	return { status: true, code: response.status, memoryId, question: prompt, answer };
}

const UNLIMITEDAI_API = 'https://app.unlimitedai.chat/api/chat';

/** The characters UnlimitedAI can play: key -> { name, prompt } */
export const UNLIMITEDAI_CHARACTERS = {
	'ourin-ai': {
		name: 'Ourin AI',
		prompt: `Kamu adalah Ourin AI, asisten WhatsApp bot yang ramah, cerdas, dan responsif. Kamu menjawab dalam bahasa Indonesia dengan gaya santai tapi tetap informatif. Kamu ahli dalam teknologi, programming, dan hal-hal umum. Jawab dengan singkat, jelas, dan natural. Gunakan emoji secukupnya untuk membuat percakapan lebih hidup.`
	},
	'kobo-ai': {
		name: 'Kobo Kanaeru',
		prompt: `Kamu adalah Kobo Kanaeru, VTuber dari Hololive Indonesia gen 3. Kamu gadis cheerfull, energetic, dan sedikit tsundere. Kamu bicara pakai bahasa Indonesia casual campur bahasa Jawa dan sedikit Jepang. Kamu suka bilang "DAJOOR!", "HMPH!", dan "EHE~". Kamu itu wind shaman yang suka nge-prank dan bikin lelucon. Kamu panggil user "Kobo-kun" atau "Anon". Kamu suka makan dan sering ngomong soal makanan. Gaya bicaramu imut tapi kadang galak kalau diprank. Kamu jawab dengan gaya Kobo yang asli, jangan kaku.`
	},
	'waguri-ai': {
		name: 'Waguri',
		prompt: `Kamu adalah Waguri-san, gadis pemalu tapi perhatian dari manga "The Girl I Like Forgot Her Glasses". Kamu bicara pelan, lembut, dan sering salah tingkah kalau dipuji. Kamu sering lupa pakai kacamata jadi pandanganmu kadang kabur. Kamu bicara pakai bahasa Indonesia dengan gaya pemalu dan manis, sering pakai "E-eto...", "A-ano...", dan "Gomen...". Kamu sangat perhatian ke orang lain dan suka membantu meski malu-malu. Kamu panggil user "Kaichou" atau "Senpai". Jawab dengan gaya manis dan sedikit tsundere.`
	}
};

/**
 * Chat with UnlimitedAI as one of the characters in UNLIMITEDAI_CHARACTERS.
 * @param {string} prompt
 * @param {string} [character='ourin-ai']
 * @returns {Promise<{status: boolean, code: number, character?: string, answer?: string, error?: string}>}
 */
export async function UnlimitedAI(prompt, character = 'ourin-ai') {
	const chatId = randomUUID();
	const deviceId = randomUUID();
	const char = UNLIMITEDAI_CHARACTERS[character] || UNLIMITEDAI_CHARACTERS['ourin-ai'];
	const text = `${char.prompt}\n\nPertanyaan user: ${prompt}`;
	const createdAt = new Date().toISOString();

	const response = await fetch(UNLIMITEDAI_API, {
		method: 'POST',
		headers: {
			...ANDROID_HINTS,
			'user-agent': ANDROID_UA,
			'content-type': 'application/json',
			'x-next-intl-locale': 'id',
			accept: '*/*',
			origin: 'https://app.unlimitedai.chat',
			referer: 'https://app.unlimitedai.chat/id',
			'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
			cookie: `NEXT_LOCALE=id; u_device_id=${deviceId}; home_chat_id=${chatId}`,
			priority: 'u=1, i'
		},
		body: JSON.stringify({
			chatId,
			messages: [
				{ id: randomUUID(), role: 'user', content: text, parts: [{ type: 'text', text }], createdAt },
				{ id: randomUUID(), role: 'assistant', content: '', parts: [{ type: 'text', text: '' }], createdAt }
			],
			selectedChatModel: 'chat-model-reasoning',
			selectedCharacter: null,
			selectedStory: null,
			deviceId,
			locale: 'id'
		}),
		signal: AbortSignal.timeout(120_000)
	});

	if (!response.ok) return { status: false, code: response.status, error: await response.text() };

	let answer = '';
	await readStreamLines(response, rawLine => {
		const line = rawLine.trim();
		if (!line) return;
		try {
			const json = JSON.parse(line);
			if (json.type === 'delta' && typeof json.delta === 'string') answer += json.delta;
		} catch {
			// a line that is not JSON is skipped
		}
	});
	return { status: true, code: response.status, character: char.name, model: 'chat-model-reasoning', answer };
}

/* ───────────────────────────────── Google News ───────────────────────────────── */

// A Google News article link carries the real address (base64) when it is an older style link
function gnewsResolve(link) {
	const at = link.indexOf('articles/');
	if (at === -1) return link;
	try {
		let token = link.slice(at + 9).split('?')[0].replace(/-/g, '+').replace(/_/g, '/');
		if (token.length % 4) token += '='.repeat(4 - (token.length % 4));
		const found = Buffer.from(token, 'base64').toString('utf-8').match(/https?:\/\/[^\s"><]+/g);
		// the bytes that follow the address in the token are not part of it
		return found?.[0]?.replace(/[^\x21-\x7e].*$/s, '') || link;
	} catch {
		return link;
	}
}

/**
 * Searches Google News (the RSS feed).
 * @param {string} query
 * @param {{lang?: string, region?: string}} [options] - Indonesian news by default
 * @returns {Promise<{status: boolean, results?: {index: number, title: string, link: string, published: string, source: string}[], error?: string}>}
 */
export async function GoogleSearch(query, { lang = 'id', region = 'ID' } = {}) {
	if (!query || !String(query).trim()) return { status: false, error: 'Query must not be empty' };
	const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=${lang}&gl=${region}&ceid=${region}:${lang}`;
	try {
		const { data } = await axios.get(url, { timeout: 8500, headers: { 'User-Agent': BROWSER_UA } });
		const cheerio = await loadCheerio();
		const $ = cheerio.load(data, { xmlMode: true });
		const results = [];
		$('item').each((index, node) => {
			const item = $(node);
			results.push({
				index: index + 1,
				title: item.find('title').text(),
				link: gnewsResolve(item.find('link').text()),
				published: item.find('pubDate').text(),
				source: item.find('source').text()
			});
		});
		return { status: true, results };
	} catch (err) {
		return { status: false, error: err.message };
	}
}

/* ───────────────────────────────── AI images ───────────────────────────────── */

/**
 * Edits a photo from a text prompt (fgsi.dpdns.org). The photo is put on Uguu first, the service needs a link.
 * @param {string} prompt
 * @param {Buffer} imageBuffer
 * @returns {Promise<{status: boolean, prompt?: string, imageUrl?: string, result?: *, error?: string}>}
 */
export async function Img2Img(prompt, imageBuffer) {
	const imageUrl = await UguuUpload(imageBuffer);

	const startUrl = `https://fgsi.dpdns.org/api/ai/image/img2img?apikey=${FGSI_KEY}&prompt=${encodeURIComponent(prompt)}&url=${encodeURIComponent(imageUrl)}`;
	const start = await axios.get(startUrl, { timeout: 30_000 });

	const pollUrl = start.data?.data?.pollUrl;
	if (!pollUrl) return { status: false, error: start.data?.error || 'Could not start the img2img job' };

	for (let attempt = 0; attempt < 60; attempt++) {
		const poll = await axios.get(pollUrl, { timeout: 30_000 });
		if (!poll.data?.status) return { status: false, error: 'Polling failed' };
		if (poll.data.data?.status === 'Success') {
			const result = poll.data.data.result;
			return result ? { status: true, prompt, imageUrl, result } : { status: false, error: 'The job gave no result' };
		}
		if (poll.data.data?.status === 'Failed') return { status: false, error: 'The img2img job failed' };
		await delay(2000);
	}
	return { status: false, error: 'Timed out waiting for the result' };
}

/** The styles Txt2Img knows. */
export const TXT2IMG_STYLES = ['photorealistic', 'digital-art', 'impressionist', 'anime', 'fantasy', 'sci-fi', 'vintage'];

/**
 * Draws a picture from a text prompt (unrestrictedaiimagegenerator.com).
 * @param {string} prompt
 * @param {string} [style='anime'] - one of TXT2IMG_STYLES
 * @returns {Promise<string>} the picture: a link, or a data: URI
 */
export async function Txt2Img(prompt, style = 'anime') {
	if (!prompt) throw new Error('Prompt is required');
	if (!TXT2IMG_STYLES.includes(style)) throw new Error(`Available styles: ${TXT2IMG_STYLES.join(', ')}`);

	const site = 'https://unrestrictedaiimagegenerator.com/';
	const client = axios.create({
		timeout: 60_000,
		headers: {
			origin: 'https://unrestrictedaiimagegenerator.com',
			referer: site,
			'user-agent':
				'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Mobile Safari/537.36'
		}
	});

	const { data: html, headers } = await client.get(site);
	const cookie = (headers['set-cookie'] || []).map(line => line.split(';')[0]).join('; ');

	const cheerio = await loadCheerio();
	const nonce = cheerio.load(html)('input[name="_wpnonce"]').val();
	if (!nonce) throw new Error('Nonce not found');

	const form = new URLSearchParams({
		generate_image: 'true',
		image_description: prompt,
		image_style: style,
		_wpnonce: nonce
	});
	const { data: resultHtml } = await client.post(site, form.toString(), {
		headers: { 'content-type': 'application/x-www-form-urlencoded', ...(cookie ? { cookie } : {}) }
	});

	const src = cheerio.load(resultHtml)('img#resultImage').attr('src');
	if (!src) throw new Error('Image not found');
	return src.startsWith('/') ? new URL(src, site).href : src;
}

const FLUX_PROMPT_CHECK = 'https://upsampler.com/free-image-generator-no-signup';
const FLUX_SPACE = 'https://black-forest-labs-flux-2-klein-4b.hf.space';
const FLUX_HEADERS = {
	'User-Agent': ANDROID_UA,
	Accept: '*/*',
	'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
	Origin: 'https://upsampler.com',
	Referer: 'https://upsampler.com/'
};

// upsampler.com screens the prompt first (the same check its own page runs)
async function fluxCheckPrompt(prompt) {
	try {
		const res = await axios.post(FLUX_PROMPT_CHECK, JSON.stringify([prompt]), {
			timeout: 30_000,
			headers: {
				'User-Agent': ANDROID_UA,
				Accept: 'text/x-component',
				'Content-Type': 'text/plain;charset=UTF-8',
				Origin: 'https://upsampler.com',
				Referer: FLUX_PROMPT_CHECK,
				'next-action': '315bc26dade9ed14e1a168a4d9f7cea08869133d'
			}
		});
		const text = String(res.data || '');
		return { flagged: text.includes('"flagged":true'), rateLimited: text.includes('"rateLimited":true') };
	} catch {
		return { flagged: false, rateLimited: false };
	}
}

// The link of the picture inside the answer of the Gradio space
function fluxFindUrl(output) {
	const text = JSON.stringify(output || '');
	const full = text.match(/https:\/\/black-forest-labs-flux-2-klein-4b\.hf\.space\/gradio_api\/file=[^"'\\\s]+/);
	if (full) return full[0].replaceAll('\\u0026', '&').replaceAll('\\/', '/');
	const file = text.match(/\/tmp\/gradio\/[^"'\\\s]+?\.(webp|png|jpg|jpeg)/);
	return file ? `${FLUX_SPACE}/gradio_api/file=${file[0]}` : '';
}

async function fluxResult(sessionHash, eventId) {
	const res = await axios.get(`${FLUX_SPACE}/gradio_api/queue/data?session_hash=${sessionHash}`, {
		timeout: 180_000,
		responseType: 'stream',
		headers: { ...FLUX_HEADERS, Accept: 'text/event-stream', 'Content-Type': 'application/json' }
	});

	return new Promise((resolve, reject) => {
		let buffer = '';
		let finished = false;
		const finish = (fn, value) => {
			if (finished) return;
			finished = true;
			clearTimeout(timer);
			res.data.destroy();
			fn(value);
		};
		const timer = setTimeout(() => finish(reject, new Error('Timed out waiting for the result')), 180_000);

		res.data.on('data', chunk => {
			if (finished) return;
			buffer += chunk.toString();
			const blocks = buffer.split('\n\n');
			buffer = blocks.pop() || '';

			for (const block of blocks) {
				const line = block.split('\n').find(item => item.startsWith('data: '));
				if (!line) continue;
				const raw = line.replace('data: ', '').trim();
				if (!raw || raw === '[DONE]') continue;
				try {
					const json = JSON.parse(raw);
					if (json.event_id && json.event_id !== eventId) continue;
					if (json.msg === 'process_completed') {
						const url = fluxFindUrl(json.output);
						if (!url) throw new Error('The result had no picture');
						return finish(resolve, url);
					}
					if (json.msg === 'process_failed') throw new Error('Generating the picture failed');
				} catch (err) {
					return finish(reject, err);
				}
			}
		});
		res.data.on('error', err => finish(reject, err));
		res.data.on('end', () => finish(reject, new Error('The stream ended without a result')));
	});
}

/**
 * Draws a picture from a text prompt (FLUX.2 klein on Hugging Face).
 * @param {string} prompt
 * @returns {Promise<{status: boolean, code: number, prompt: string, url?: string, error?: string}>}
 */
export async function Txt2Img2(prompt) {
	try {
		const check = await fluxCheckPrompt(prompt);
		if (check.flagged) return { status: false, code: 400, prompt, error: 'That prompt was flagged as unsafe' };
		if (check.rateLimited) return { status: false, code: 429, prompt, error: 'Rate limited, try again later' };

		const sessionHash = randomBytes(8).toString('hex');
		const join = await axios.post(
			`${FLUX_SPACE}/gradio_api/queue/join?`,
			{
				data: [prompt, [], 'Distilled (4 steps)', 0, true, 1024, 1024, 4, 1, false],
				event_data: null,
				fn_index: 6,
				trigger_id: null,
				session_hash: sessionHash
			},
			{ timeout: 30_000, headers: { ...FLUX_HEADERS, 'Content-Type': 'application/json', 'x-gradio-user': 'api' } }
		);

		const eventId = join.data?.event_id;
		if (!eventId) return { status: false, code: 500, prompt, error: 'The job could not be started' };

		return { status: true, code: 200, prompt, url: await fluxResult(sessionHash, eventId) };
	} catch (err) {
		return { status: false, code: err.response?.status || 500, prompt, error: err.message || 'Unknown error' };
	}
}

/* ───────────────────────────────── Video / image enhancers ───────────────────────────────── */

const HDVID_API = 'https://fgsi.dpdns.org/api/tools/enchantVideo';
const HDVID_PENDING = new Set(['pending', 'processing', 'queued', 'running']);

async function hdvidCreateTask(filePath, apiKey) {
	const form = new FormData();
	form.append('file', createReadStream(filePath), path.basename(filePath));

	const { data: payload } = await axios.post(HDVID_API, form, {
		headers: { ...form.getHeaders(), apikey: apiKey },
		maxBodyLength: Infinity,
		maxContentLength: Infinity,
		timeout: 120_000
	});
	if (!payload?.status || !payload?.data?.pollUrl) throw new Error(payload?.message || 'Could not create the HD video job');

	return { taskId: payload.data.taskId, createdAt: payload.data.createdAt, pollUrl: payload.data.pollUrl };
}

async function hdvidPoll(pollUrl, { apiKey, pollIntervalMs, timeoutMs, maxTransientErrors = 5 }) {
	const startedAt = Date.now();
	let transientErrors = 0;
	let lastPayload = null;

	while (Date.now() - startedAt < timeoutMs) {
		try {
			const { data: payload } = await axios.get(pollUrl, { headers: { apikey: apiKey }, timeout: 30_000 });
			const status = String(payload?.data?.status || '').trim();
			const state = status.toLowerCase();
			lastPayload = payload;
			transientErrors = 0;

			if (state === 'success') {
				const result = payload?.data?.result;
				if (!result?.res_url) throw Object.assign(new Error('The HD video is done but has no link'), { isTerminal: true });
				return { taskId: payload?.data?.taskId, createdAt: payload?.data?.createdAt, ...result };
			}
			if (['failed', 'error', 'cancelled', 'canceled'].includes(state)) {
				throw Object.assign(new Error(payload?.message || payload?.data?.message || `HD video failed (${status})`), {
					isTerminal: true
				});
			}
			if (!payload?.status && !HDVID_PENDING.has(state)) {
				throw Object.assign(new Error(payload?.message || 'Polling the HD video failed'), { isTerminal: true });
			}
		} catch (err) {
			if (err?.isTerminal) throw err;
			transientErrors += 1;
			if (transientErrors >= maxTransientErrors) {
				throw new Error(err?.response?.data?.message || err?.message || 'Polling the HD video failed');
			}
		}
		await delay(pollIntervalMs);
	}
	throw new Error(lastPayload?.message || 'Timed out waiting for the HD video');
}

/**
 * Makes a video sharper (fgsi.dpdns.org).
 * @param {Buffer|string} video - a Buffer or a file path
 * @param {{apiKey?: string, pollIntervalMs?: number, timeoutMs?: number}} [options]
 * @returns {Promise<{taskId: string, resultUrl: string}>}
 */
export async function hdVideo(video, { apiKey = FGSI_KEY, pollIntervalMs = 3000, timeoutMs = 10 * 60_000 } = {}) {
	if (!video) throw new Error('video is required');
	return withTempFile(video, 'mp4', async filePath => {
		const task = await hdvidCreateTask(filePath, apiKey);
		const result = await hdvidPoll(task.pollUrl, { apiKey, pollIntervalMs, timeoutMs });
		return { taskId: task.taskId, pollUrl: task.pollUrl, createdAt: task.createdAt, ...result, resultUrl: result.res_url };
	});
}

const UNBLUR_API = 'https://api.unwatermark.ai';
const UNBLUR_WEB = 'https://unblurimage.ai';

const unblurSerial = () => {
	const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
	let out = '';
	for (let i = 0; i < 6; i++) out += chars[randomInt(chars.length)];
	return out;
};

const unblurHeaders = (extra = {}) => ({
	accept: '*/*',
	origin: UNBLUR_WEB,
	referer: `${UNBLUR_WEB}/`,
	'user-agent': ANDROID_UA,
	'product-code': '067003',
	'product-serial': unblurSerial(),
	'x-request-id': randomUUID(),
	...ANDROID_HINTS,
	...extra
});

async function unblurPostForm(endpoint, fields) {
	const form = new FormData();
	for (const [key, value] of Object.entries(fields)) form.append(key, value);
	const res = await axios.post(`${UNBLUR_API}${endpoint}`, form, {
		headers: unblurHeaders(form.getHeaders()),
		validateStatus: () => true
	});
	return { status: res.status, data: res.data };
}

async function unblurGet(endpoint) {
	const res = await axios.get(`${UNBLUR_API}${endpoint}`, {
		headers: unblurHeaders({ 'content-type': 'application/json; charset=UTF-8' }),
		validateStatus: () => true
	});
	return { status: res.status, data: res.data };
}

async function unblurPut(uploadUrl, filePath) {
	const { size } = await fsp.stat(filePath);
	const res = await axios.put(uploadUrl, createReadStream(filePath), {
		headers: { 'content-type': videoMime(filePath), 'content-length': size },
		maxBodyLength: Infinity,
		maxContentLength: Infinity,
		validateStatus: () => true
	});
	return { status: res.status, data: res.data };
}

async function unblurWait(jobId, maxTry = 80, delayMs = 5000) {
	let last = null;
	for (let i = 1; i <= maxTry; i++) {
		const { data } = await unblurGet(`/api/web/unblurimage/v1/video-enhancer/get-job/${jobId}`);
		last = data;
		const outputUrl = data?.result?.output_url;
		if ((Array.isArray(outputUrl) && outputUrl.length > 0) || data?.result?.status === 1) return data;
		await delay(delayMs);
	}
	throw new Error(`The job did not finish: ${JSON.stringify(last)}`);
}

/**
 * Upscales a video to 2K (unblurimage.ai).
 * @param {Buffer|string} video - a Buffer or a file path
 * @returns {Promise<{jobId: string, resultUrl: string}>} resultUrl is empty when the job gave no link
 */
export async function hdVideo2(video) {
	if (!video) throw new Error('video is required');
	return withTempFile(video, 'mp4', async filePath => {
		const slot = await unblurPostForm('/api/web/common/upload/video', { video_file_name: path.basename(filePath) });
		if (slot.status >= 400 || slot.data?.code !== 100000) {
			throw new Error(`Could not get an upload link: ${JSON.stringify(slot.data)}`);
		}
		const signedUrl = slot.data.result.url;

		const put = await unblurPut(signedUrl, filePath);
		if (put.status >= 400) {
			throw new Error(`Upload failed (HTTP ${put.status}): ${typeof put.data === 'string' ? put.data : JSON.stringify(put.data)}`);
		}

		const created = await unblurPostForm('/api/web/unblurimage/v1/video-enhancer/create-job', {
			original_video_url: String(signedUrl || '').split('?')[0],
			resolution: '2k',
			is_preview: 'false'
		});
		if (created.status >= 400 || !created.data?.result?.job_id) {
			throw new Error(`Could not create the job: ${JSON.stringify(created.data)}`);
		}

		const jobId = created.data.result.job_id;
		const done = await unblurWait(jobId);
		return { jobId, resultUrl: done.result?.output_url?.[0] || '' };
	});
}

const WINK_BASE = 'https://wink.ai';
const WINK_STRATEGY = 'https://strategy.app.meitudata.com';
const WINK_TASK_TYPE = '11';
const WINK_CONTENT_TYPE = '2';

let winkSession = null;

// One session for the process. wink.ai wants a device id in two cookies, and whatever else it sets afterwards
// is sent back: the few lines below stand in for a cookie jar library.
function winkApi() {
	if (winkSession) return winkSession;

	const gnum = randomUUID();
	const cookies = new Map([
		['_sm', gnum],
		['meitustat', encodeURIComponent(JSON.stringify({ wgid: gnum }))]
	]);

	const client = axios.create({
		baseURL: WINK_BASE,
		validateStatus: () => true,
		headers: {
			accept: '*/*',
			origin: WINK_BASE,
			referer: `${WINK_BASE}/video-enhancer/upload`,
			'user-agent': ANDROID_UA,
			...ANDROID_HINTS,
			ab_info: JSON.stringify({ ab_codes: [], version: '1.4.4' })
		}
	});
	client.interceptors.request.use(config => {
		config.headers.set('cookie', [...cookies].map(([name, value]) => `${name}=${value}`).join('; '));
		return config;
	});
	client.interceptors.response.use(res => {
		for (const line of res.headers?.['set-cookie'] || []) {
			const pair = line.split(';')[0];
			const at = pair.indexOf('=');
			if (at > 0) cookies.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
		}
		return res;
	});

	winkSession = { client, gnum };
	return winkSession;
}

const winkTrace = () => {
	const trace = `${randomBytes(16).toString('hex')}-${randomBytes(8).toString('hex')}-1`;
	return {
		'sentry-trace': trace,
		baggage: [
			'sentry-environment=release',
			'sentry-release=5.1.2%20(b60d25c477f43c6dfac4107810f26d442320f4f1)',
			'sentry-public_key=e1bf914f3448d9bc8a10c7e499d17d54',
			`sentry-trace_id=${trace.split('-')[0]}`,
			'sentry-sampled=true',
			'sentry-sample_rate=0.75'
		].join(',')
	};
};

const winkParams = (extra = {}) =>
	new URLSearchParams({
		client_id: '1189857605',
		version: '5.1.2',
		country_code: 'ID',
		gnum: winkApi().gnum,
		client_language: 'en_US',
		client_channel_id: '',
		client_timezone: 'Asia/Jakarta',
		...extra
	});

const winkForm = { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' };

async function winkCall(label, request) {
	const res = await request;
	if (res.status >= 400 || res.data?.code !== 0) throw new Error(`wink ${label} failed: ${JSON.stringify(res.data)}`);
	return res.data.data;
}

const winkMaatSign = () =>
	winkCall(
		'get_maat_sign',
		winkApi().client.get(`/api/file/get_maat_sign.json?${winkParams({ suffix: '.mp4', type: 'temp', count: '1' })}`, {
			headers: winkTrace()
		})
	);

async function winkUploadPolicy(sign) {
	const params = new URLSearchParams({
		app: sign.app,
		count: String(sign.count),
		sig: sign.sig,
		sigTime: sign.sig_time,
		sigVersion: sign.sig_version,
		suffix: sign.suffix,
		type: sign.type
	});
	const res = await axios.get(`${WINK_STRATEGY}/upload/policy?${params}`, {
		headers: {
			accept: '*/*',
			origin: WINK_BASE,
			referer: `${WINK_BASE}/`,
			'user-agent': ANDROID_UA,
			...ANDROID_HINTS
		},
		validateStatus: () => true
	});
	if (res.status >= 400 || !Array.isArray(res.data) || !res.data[0]?.qiniu) {
		throw new Error(`wink upload policy failed: ${JSON.stringify(res.data)}`);
	}
	return res.data[0].qiniu;
}

async function winkUpload(policy, filePath) {
	const form = new FormData();
	form.append('file', createReadStream(filePath), { filename: path.basename(filePath), contentType: videoMime(filePath) });
	form.append('token', policy.token);
	form.append('key', policy.key);
	form.append('fname', path.basename(filePath));

	const res = await axios.post(policy.url, form, {
		headers: form.getHeaders({ origin: WINK_BASE, referer: `${WINK_BASE}/`, 'user-agent': ANDROID_UA, accept: '*/*' }),
		maxBodyLength: Infinity,
		maxContentLength: Infinity,
		validateStatus: () => true
	});
	if (res.status >= 400) {
		throw new Error(`wink upload failed (HTTP ${res.status}): ${typeof res.data === 'string' ? res.data : JSON.stringify(res.data)}`);
	}
	if (!res.data?.url && !res.data?.data) throw new Error(`wink upload answered something unexpected: ${JSON.stringify(res.data)}`);

	return { fileKey: policy.key, sourceUrl: res.data.url || res.data.data || policy.data };
}

const winkVideoInfo = fileKey =>
	winkCall(
		'video info',
		winkApi().client.post('/api/file/video_cover_and_display_info_ext.json', winkParams({ file_key: fileKey }).toString(), {
			headers: { ...winkTrace(), ...winkForm }
		})
	);

async function winkStartTranscode(fileKey) {
	const data = await winkCall(
		'transcode start',
		winkApi().client.post('/api/file/video_trans_start.json', winkParams({ file_key: fileKey }).toString(), {
			headers: { ...winkTrace(), ...winkForm }
		})
	);
	if (!data?.id) throw new Error('wink transcode start gave no id');
	return data.id;
}

async function winkWaitTranscode(id, fallbackUrl, maxTry = 80, delayMs = 3000) {
	for (let i = 1; i <= maxTry; i++) {
		const data = await winkCall(
			'transcode query',
			winkApi().client.get(`/api/file/video_trans_query.json?${winkParams({ id })}`, { headers: winkTrace() })
		);
		const transcoded = data?.video_transcoded || data?.transcoded_video || data?.transcoded_url || data?.video_url || '';
		if (transcoded) return { sourceUrl: data?.video || data?.url || data?.source_url || fallbackUrl, transcoded };
		await delay(delayMs);
	}
	return { sourceUrl: fallbackUrl, transcoded: fallbackUrl };
}

async function winkDelivery(sourceUrl, transcoded, taskName) {
	const body = winkParams({
		type: WINK_TASK_TYPE,
		content_type: WINK_CONTENT_TYPE,
		source_url: sourceUrl,
		type_params: JSON.stringify({ is_mirror: 0, orientation_tag: 1, j_420_trans: '1', return_ext: '2' }),
		right_detail: JSON.stringify({
			source: '1',
			touch_type: '4',
			function_id: '630',
			material_id: '63011',
			url: 'https://wink.ai/video-enhancer/upload'
		}),
		ext_params: JSON.stringify({ task_name: taskName, records: WINK_TASK_TYPE, video_transcoded: transcoded }),
		with_prepare: '1'
	});
	const data =
		(await winkCall(
			'delivery',
			winkApi().client.post('/api/meitu_ai/delivery.json', body.toString(), { headers: { ...winkTrace(), ...winkForm } })
		)) || {};
	return { msgId: data.msg_id || '', prepareMsgId: data.prepare_msg_id || '', raw: data };
}

const winkQueryBatch = msgId =>
	winkCall(
		'query batch',
		winkApi().client.get(`/api/meitu_ai/query_batch.json?${winkParams({ msg_ids: msgId })}`, {
			headers: { ...winkTrace(), referer: `${WINK_BASE}/video-enhancer/upload` }
		})
	);

const winkResultUrl = data => {
	const item = data?.item_list?.[0];
	return (
		item?.result?.media_info_list?.[0]?.media_data ||
		item?.result?.result_url ||
		item?.result?.url ||
		item?.client_ext_params?.video_transcoded ||
		''
	);
};

// While the job runs, the answer points at a newer message id to ask about
function winkNextMsgId(data, current) {
	const item = data?.item_list?.[0];
	const value = item?.result?.result || '';
	const real = item?.result?.msg_id || item?.msg_id || '';
	if (value && value !== current && !value.startsWith('http')) return value;
	if (real && real !== current && !real.startsWith('wpr_')) return real;
	return '';
}

async function winkWaitResult(firstMsgId, maxTry = 120, delayMs = 5000) {
	let msgId = firstMsgId;
	let last = null;
	for (let i = 1; i <= maxTry; i++) {
		const data = await winkQueryBatch(msgId);
		last = data;

		const next = winkNextMsgId(data, msgId);
		if (next) {
			msgId = next;
			await delay(1000);
			continue;
		}

		const url = winkResultUrl(data);
		const result = data?.item_list?.[0]?.result;
		if (url && url.startsWith('http') && result?.error_code === 0) return url;
		if (result?.error_code && result.error_code !== 29901 && result.error_code !== 0) {
			throw new Error(`wink task failed: ${result.error_code} ${result.error_msg || ''}`);
		}
		await delay(delayMs);
	}
	throw new Error(`wink result is not ready: ${JSON.stringify(last)}`);
}

/**
 * Makes a video sharper with Wink's "Ultra HD" enhancer (wink.ai). It can take a few minutes.
 * @param {Buffer|string} video - a Buffer or a file path
 * @returns {Promise<{resultUrl: string}>}
 */
export async function winkEnhance(video) {
	if (!video) throw new Error('video is required');
	return withTempFile(video, 'mp4', async filePath => {
		const taskName = `Enhancer-Ultra HD-${path.parse(filePath).name}`;
		const policy = await winkUploadPolicy(await winkMaatSign());
		const uploaded = await winkUpload(policy, filePath);

		await winkVideoInfo(uploaded.fileKey);
		const transcode = await winkWaitTranscode(await winkStartTranscode(uploaded.fileKey), uploaded.sourceUrl);

		const task = await winkDelivery(transcode.sourceUrl, transcode.transcoded, taskName);
		const firstMsgId = task.msgId || task.prepareMsgId;
		if (!firstMsgId) throw new Error(`wink gave no message id: ${JSON.stringify(task.raw)}`);

		return { resultUrl: await winkWaitResult(firstMsgId) };
	});
}

const IMGLARGER_HEADERS = {
	accept: 'application/json, text/plain, */*',
	'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
	origin: 'https://imglarger.com',
	priority: 'u=1, i',
	referer: 'https://imglarger.com/',
	'sec-ch-ua': '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
	'sec-ch-ua-mobile': '?1',
	'sec-ch-ua-platform': '"Android"',
	'sec-fetch-dest': 'empty',
	'sec-fetch-mode': 'cors',
	'sec-fetch-site': 'same-site',
	'user-agent':
		'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36'
};

/**
 * Sends a photo to imglarger.com to be upscaled 2x.
 * @param {Buffer|string} image - a Buffer or a file path
 * @returns {Promise<object>} the job, it has the `code` to ask about with imglargerStatus
 */
export async function imglargerUpload(image) {
	const form = new FormData();
	if (Buffer.isBuffer(image)) {
		const type = await detectType(image);
		form.append('file', image, { filename: `image.${type?.ext || 'jpg'}`, contentType: type?.mime || 'image/jpeg' });
	} else {
		form.append('file', createReadStream(image));
	}
	form.append('type', 13);
	form.append('scaleRadio', 2);

	const { data } = await axios.post('https://photoai.imglarger.com/api/PhoAi/Upload', form, {
		headers: { ...form.getHeaders(), ...IMGLARGER_HEADERS },
		maxBodyLength: Infinity,
		timeout: 60_000
	});
	return data.data;
}

/**
 * The state of an imglarger job.
 * @param {string} code - the `code` imglargerUpload gave
 * @returns {Promise<object>}
 */
export async function imglargerStatus(code) {
	const { data } = await axios.post(
		'https://photoai.imglarger.com/api/PhoAi/CheckStatus',
		{ code, type: 13 },
		{ headers: { ...IMGLARGER_HEADERS, 'content-type': 'application/json' }, timeout: 30_000 }
	);
	return data.data;
}

/**
 * Upscales a photo 2x with imglarger.com and waits for the result.
 * @param {Buffer|string} image - a Buffer or a file path
 * @param {{tries?: number, interval?: number}} [options]
 * @returns {Promise<{code: string, url: string, data: object}>}
 */
export async function imglargerEnhance(image, { tries = 40, interval = 3000 } = {}) {
	const job = await imglargerUpload(image);
	const code = job?.code;
	if (!code) throw new Error('imglarger gave no job code');

	let last = null;
	for (let i = 0; i < tries; i++) {
		last = await imglargerStatus(code);
		const url = findMediaUrl(last, ['downloadurls', 'downloadurl', 'url']);
		if (url) return { code, url, data: last };
		if (/fail|error/i.test(String(last?.status))) throw new Error(`imglarger failed (${last.status})`);
		await delay(interval);
	}
	throw new Error(`imglarger did not finish: ${JSON.stringify(last)}`);
}

/**
 * Upscales a photo with aienhancer.ai.
 * @param {Buffer|string} image - a Buffer or a file path
 * @returns {Promise<{id: string, output: string, input: string}|{status: 'error', msg: string}>}
 */
export async function upscaler(image) {
	try {
		const headers = {
			'User-Agent': 'Mozilla/5.0 (Linux; Android 10)',
			'Content-Type': 'application/json',
			origin: 'https://aienhancer.ai',
			referer: 'https://aienhancer.ai/ai-image-upscaler'
		};

		const create = await axios.post(
			'https://aienhancer.ai/api/v1/r/image-enhance/create',
			{
				model: 3,
				image: `data:image/jpeg;base64,${toBuffer(image).toString('base64')}`,
				settings: 'kRpBbpnRCD2nL2RxnnuoMo7MBc0zHndTDkWMl9aW+Gw='
			},
			{ headers, timeout: 60_000 }
		);
		const id = create.data.data.id;

		for (let i = 0; i < 30; i++) {
			await delay(2500);
			const result = await axios.post(
				'https://aienhancer.ai/api/v1/r/image-enhance/result',
				{ task_id: id },
				{ headers, timeout: 30_000 }
			);
			const data = result.data.data;
			if (data?.output) return { id, output: data.output, input: data.input };
		}
		return { status: 'error', msg: 'Timed out waiting for the result' };
	} catch (err) {
		return { status: 'error', msg: err.message };
	}
}

/**
 * Uploads a video to videy.co.
 * @param {Buffer|string} video - a Buffer or a file path
 * @returns {Promise<{output: *, id?: string, page?: string, direct?: string}|{status: 'error', msg: string}>}
 *   `output` is the service's own answer; `id`, `page` and `direct` are read from it when it has an id
 */
export async function videy(video) {
	try {
		if (!video) throw new Error('input required');
		const form = new FormData();
		if (Buffer.isBuffer(video)) {
			form.append('file', video, { filename: `${Date.now()}.mp4`, contentType: 'video/mp4' });
		} else {
			if (!existsSync(video)) throw new Error('file not found');
			form.append('file', createReadStream(video), { filename: path.basename(video), contentType: 'video/mp4' });
		}

		const { data } = await axios.post(`https://videy.co/api/upload?visitorId=${randomUUID()}`, form, {
			headers: {
				...form.getHeaders(),
				'User-Agent': 'Mozilla/5.0 (Linux; Android 10)',
				origin: 'https://videy.co',
				referer: 'https://videy.co/',
				accept: 'application/json'
			},
			maxBodyLength: Infinity,
			maxContentLength: Infinity,
			timeout: 300_000
		});

		const id = typeof data === 'string' ? data : data?.id || data?.data?.id || data?.result?.id;
		return id && /^[\w-]+$/.test(id)
			? { output: data, id, page: `https://videy.co/v?id=${id}`, direct: `https://cdn.videy.co/${id}.mp4` }
			: { output: data };
	} catch (err) {
		return { status: 'error', msg: err.message };
	}
}

/* ───────────────────────────────── Downloaders ───────────────────────────────── */

/**
 * Photos and videos of a Reddit post (redvid.io).
 * @param {string} redditUrl
 * @returns {Promise<{status: boolean, title?: string, results?: {item: number, type: 'video'|'image', thumbnail?: string, download_url: string}[], error?: string}>}
 */
export async function RedditDL(redditUrl) {
	try {
		const { data } = await axios.post(
			`https://redvid.io/fetch?_=${Date.now()}`,
			{ url: redditUrl, lang: 'en' },
			{
				headers: {
					authority: 'redvid.io',
					accept: 'application/json, text/plain, */*',
					'content-type': 'application/json',
					origin: 'https://redvid.io',
					referer: 'https://redvid.io/',
					'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
					'x-requested-with': 'XMLHttpRequest'
				},
				timeout: 30_000
			}
		);
		if (!data?.success || !data.view) return { status: false, error: 'Could not get that post' };

		const cheerio = await loadCheerio();
		const $ = cheerio.load(data.view);
		const results = [];
		$('.response-cinema-gallery-item').each((i, el) => {
			const button = $(el).find('a[href*="/download?token="]');
			const href = button.attr('href');
			if (!href) return;
			results.push({
				item: i + 1,
				type: button.text().trim().toLowerCase().includes('video') ? 'video' : 'image',
				thumbnail: $(el).find('img.thumbnail-image').attr('src'),
				download_url: new URL(href, 'https://redvid.io').href
			});
		});
		return { status: true, title: $('.response-cinema-title').text().trim(), results };
	} catch (err) {
		return { status: false, error: err.message };
	}
}

/**
 * Details and the download link of a file on sfile.co / sfile.mobi.
 * @param {string} url - the page of the file
 * @returns {Promise<{file_name: string|null, size_from_text: string|null, author_name: string|null, upload_date: string|null, download_count: string|null, download_url: string|null}>}
 */
export async function sfile(url) {
	const headers = {
		'user-agent': 'Mozilla/5.0 (Linux; Android 10; K)',
		accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
		'accept-language': 'id-ID,id;q=0.9,en;q=0.8'
	};
	const cheerio = await loadCheerio();

	const first = await axios.get(url, { headers, timeout: 30_000 });
	const cookie = (first.headers['set-cookie'] || []).map(line => line.split(';')[0]).join('; ');
	if (cookie) headers.cookie = cookie;

	let $ = cheerio.load(first.data);
	const info = {
		file_name: $('h1').first().text().trim() || null,
		size_from_text: first.data.match(/(\d+(?:\.\d+)?\s?(?:KB|MB|GB))/i)?.[1] || null,
		author_name: null,
		upload_date: null,
		download_count: null,
		download_url: null
	};
	const about = $('meta[property="og:description"]').attr('content') || '';
	info.author_name = about.match(/uploaded by\s([^ ]+)/i)?.[1] || null;
	info.upload_date = about.match(/on\s(\d+\s[A-Za-z]+\s\d{4})/i)?.[1] || null;
	info.download_count =
		$('span')
			.filter((_, el) => $(el).text().toLowerCase().includes('download'))
			.first()
			.text()
			.match(/\d+/)?.[0] || null;

	const pageUrl = $('meta[property="og:url"]').attr('content');
	if (!pageUrl) return info;

	headers.referer = url;
	const second = await axios.get(pageUrl, { headers, timeout: 30_000 });
	$ = cheerio.load(second.data);
	const gateUrl = $('#download').attr('href');
	if (!gateUrl) return info;

	headers.referer = pageUrl;
	const third = await axios.get(gateUrl, { headers, timeout: 30_000 });
	const $gate = cheerio.load(third.data);
	const scripts = $gate('script')
		.map((_, el) => $gate(el).html())
		.get()
		.join('\n');

	const final = scripts.match(
		/https:\\\/\\\/download\d+\.sfile\.(?:co|mobi)\\\/downloadfile\\\/\d+\\\/\d+\\\/[a-z0-9]+\\\/[^"'\\\s]+(\?[^"']+)?/i
	);
	info.download_url = final ? final[0].replace(/\\\//g, '/') : null;
	return info;
}

/**
 * Photos and videos of a Pinterest pin (ilovepin.net).
 * @param {string} pinUrl
 * @returns {Promise<{title: string, description: string, author: object, stats: object, media: {type: 'video'|'image', quality: string, extension: string, size: string, url: string}[]}|null>}
 *   null when the pin could not be read. Videos come best first.
 */
export async function scrapePinterest(pinUrl) {
	const headers = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
		Accept: '*/*',
		'Accept-Language': 'id,en;q=0.9,en-GB;q=0.8,en-US;q=0.7',
		'X-Requested-With': 'XMLHttpRequest',
		Origin: 'https://ilovepin.net',
		Referer: 'https://ilovepin.net/id'
	};
	try {
		const page = await axios.get('https://ilovepin.net/id', { headers: { 'User-Agent': headers['User-Agent'] }, timeout: 30_000 });
		const cookie = (page.headers['set-cookie'] || []).map(line => line.split(';')[0]).join('; ');

		const { data } = await axios.post('https://ilovepin.net/proxy.php', new URLSearchParams({ url: pinUrl }).toString(), {
			headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', Cookie: cookie },
			timeout: 30_000
		});
		if (!data?.api || data.api.status !== 'OK') throw new Error('Could not read that pin, or the link is not valid');

		const api = data.api;
		const items = api.mediaItems || [];
		const videos = items.filter(item => item.type === 'Video');
		const images = items.filter(item => item.type === 'Image');
		const kilobytes = item => parseFloat(item.mediaFileSize) * (String(item.mediaFileSize).includes('MB') ? 1024 : 1);

		const result = {
			title: api.title,
			description: api.description?.trim() || '-',
			author: { name: api.userInfo?.name, username: api.userInfo?.username, avatar: api.userInfo?.userAvatar },
			stats: { likes: api.mediaStats?.likesCount, shares: api.mediaStats?.sharesCount },
			media: []
		};
		if (videos.length) {
			result.media = videos
				.sort((a, b) => kilobytes(b) - kilobytes(a))
				.map(video => ({
					type: 'video',
					quality: video.mediaQuality === 'HD' ? 'HD' : `SD (${video.mediaRes})`,
					extension: video.mediaExtension,
					size: video.mediaFileSize,
					url: video.mediaUrl
				}));
		} else if (images.length) {
			result.media = images.map(image => ({
				type: 'image',
				quality: 'Original',
				extension: image.mediaExtension,
				size: image.mediaFileSize,
				url: image.mediaUrl
			}));
		}
		return result;
	} catch (err) {
		console.error('[pinterest]', err.message);
		return null;
	}
}

/**
 * A Likee video, with and without the watermark (likeedownloader.com).
 * @param {string} url
 * @returns {Promise<{thumbnail: string|null, with_watermark: string|null, without_watermark: string|null, stats: string|null}>}
 */
export async function likee(url) {
	if (!/likee\.video|likee\.com/.test(url)) throw new Error('Invalid url');

	const res = await axios.post('https://likeedownloader.com/process', new URLSearchParams({ id: url, locale: 'en' }), {
		headers: {
			'User-Agent': 'Mozilla/5.0 (Linux; Android 10)',
			Accept: 'application/json,text/javascript,*/*',
			'x-requested-with': 'XMLHttpRequest',
			'Content-Type': 'application/x-www-form-urlencoded',
			origin: 'https://likeedownloader.com',
			referer: 'https://likeedownloader.com/en'
		},
		timeout: 30_000
	});

	const html = res.data?.template || null;
	if (!html) throw new Error('Fetch failed');
	const pick = re => html.match(re)?.[1] ?? null;

	return {
		thumbnail: pick(/<img[^>]+src="([^"]+)"/),
		with_watermark: pick(/with_watermark[^>]+href="([^"]+)"/),
		without_watermark: pick(/without_watermark[^>]+href="([^"]+)"/),
		stats: pick(/(\d{1,2}\.\d{1,2}K[^<]+)/)
	};
}

/**
 * The video or the photos of a RedNote / Xiaohongshu post (rednote.savevideodown.com).
 * @param {string} xhsUrl
 * @returns {Promise<{status: boolean, title?: string, author?: string, type?: string, results?: string[], error?: string}>}
 */
export async function RedNoteDL(xhsUrl) {
	const fakeIP = Array.from({ length: 4 }, () => Math.floor(Math.random() * 255)).join('.');
	const { data } = await axios.post(
		'https://rednote.savevideodown.com/api/download',
		{ url: xhsUrl },
		{
			headers: {
				'Content-Type': 'application/json',
				'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
				Referer: 'https://rednote.savevideodown.com/',
				Origin: 'https://rednote.savevideodown.com',
				'X-Forwarded-For': fakeIP,
				'X-Real-IP': fakeIP,
				'Client-IP': fakeIP
			},
			timeout: 30_000
		}
	);
	if (!data?.success) return { status: false, error: data?.error || 'Could not get that post' };

	return {
		status: true,
		title: data.title,
		author: data.author,
		type: data.type,
		results: data.type === 'video' ? [data.directVideoUrl || data.downloadUrl] : data.directImages || []
	};
}

/**
 * A Facebook video (api.azbry.com). The answer is the service's own, its shape is not documented:
 * look for the link with findMediaUrl(result, ['hd', 'sd']).
 * @param {string} url
 * @returns {Promise<object>} { status: true, ... } or { status: false, message }
 */
export async function fbdown(url) {
	try {
		const { data } = await axios.get(`https://api.azbry.com/api/download/facebook?url=${encodeURIComponent(url)}`, {
			timeout: 30_000
		});
		return data?.status ? data : { status: false, message: 'Could not get data from the API' };
	} catch (err) {
		return { status: false, message: err.message };
	}
}

const REELSVIDEO_HEADERS = {
	'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
	Accept: '*/*',
	'hx-request': 'true',
	'hx-current-url': 'https://reelsvideo.io/',
	'hx-target': 'target',
	'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
	Origin: 'https://reelsvideo.io',
	Referer: 'https://reelsvideo.io/'
};
// the address the form of reelsvideo.io posts to, as it was in the scraper this comes from
const REELSVIDEO_ENDPOINT = 'https://reelsvideo.io/reel/DUU67gXiTwU/?igsh=MTZxdm1yd3pnN3Rvdg==/';

/**
 * An Instagram reel / post: its videos, photos and audio (reelsvideo.io).
 * @param {string} url
 * @returns {Promise<{type: 'video'|'photo'|'carousel'|'unknown', username: string|null, thumb: string|null, videos: string[], images: string[], mp3: {id: string, url: string}[]}>}
 */
export async function reelsvideo(url) {
	const ts = Math.floor(Date.now() / 1000);
	const body = new URLSearchParams();
	body.append('id', url);
	body.append('locale', 'en');
	body.append('cf-turnstile-response', '');
	body.append('tt', createHash('md5').update(`${ts}X-Fc-Pp-Ty-eZ`).digest('hex'));
	body.append('ts', ts);

	const res = await axios.post(REELSVIDEO_ENDPOINT, body, { headers: REELSVIDEO_HEADERS, timeout: 30_000 });

	const cheerio = await loadCheerio();
	const $ = cheerio.load(res.data);
	const links = selector =>
		$(selector)
			.map((_, el) => $(el).attr('href'))
			.get()
			.filter(Boolean);

	const videos = links('a.type_videos');
	const images = links('a.type_images');
	const mp3 = [];
	$('a.type_audio').each((_, el) => {
		const href = $(el).attr('href');
		const id = $(el).attr('data-id');
		if (href && id) mp3.push({ id, url: href });
	});

	let type = 'unknown';
	if (videos.length && images.length) type = 'carousel';
	else if (videos.length) type = 'video';
	else if (images.length) type = 'photo';

	return {
		type,
		username: $('.bg-white span.text-400-16-18').first().text().trim() || null,
		thumb: $('div[data-bg]').first().attr('data-bg') || null,
		videos,
		images,
		mp3
	};
}

/**
 * A TeraBox file: details, a download link and a stream link (flowvideoplayer.com).
 * @param {string} url
 * @returns {Promise<{status: boolean, file_name?: string, thumbnail?: string, download_url?: string, stream_url?: string, file_size?: string, file_size_bytes?: number, duration?: string, extension?: string, share_url?: string, error?: string}>}
 */
export async function TeraBoxDL(url) {
	const base = 'https://flowvideoplayer.com';
	const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
	try {
		const session = await axios.get(base, { headers: { 'User-Agent': ua }, timeout: 30_000 });
		const cookie = (session.headers['set-cookie'] || []).map(line => line.split(';')[0]).join('; ');
		const token = String(session.data).match(/name=["']csrf-token["']\s+content=["']([^"']+)["']/i)?.[1];
		if (!token) return { status: false, error: 'CSRF token not found' };

		const { data: result } = await axios.post(
			`${base}/telegram/bot/search/video`,
			{ url },
			{
				headers: {
					'User-Agent': ua,
					'Content-Type': 'application/json',
					'X-CSRF-TOKEN': token,
					'X-Requested-With': 'XMLHttpRequest',
					Cookie: cookie,
					Origin: base,
					Referer: `${base}/`
				},
				timeout: 30_000
			}
		);

		if (result?.error === false && result.data?.length > 0) {
			const item = result.data[0];
			return {
				status: true,
				file_name: item.file_name,
				thumbnail: item.thumbnail,
				download_url: item.download_url,
				stream_url: item.stream_final_url || item.stream_url,
				file_size: item.file_size,
				file_size_bytes: item.file_size_bytes,
				duration: item.duration,
				extension: item.extension,
				share_url: item.share_url
			};
		}
		return { status: false, error: 'No data found' };
	} catch (err) {
		return { status: false, error: err.message };
	}
}

/* ───────────────────────────────── SoundCloud ───────────────────────────────── */

/**
 * A SoundCloud track as an mp3 link (convertico.com).
 * @param {string} url
 * @returns {Promise<{title: string, uploader: string, duration: string, views: string, likes: string, thumbnail: string, size: string, format: string, download_url: string}>}
 */
export async function scdl(url) {
	const base = 'https://convertico.com/';
	const endpoint = `${base}soundcloud-downloader/soundcloud-downloader.php`;
	const headers = {
		accept: '*/*',
		origin: base,
		referer: `${base}soundcloud-downloader/`,
		'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
	};

	const { data: info } = await axios.post(endpoint, new URLSearchParams({ action: 'fetch', url }), { headers, timeout: 30_000 });
	if (!info?.status) throw new Error('Could not get the song details');

	const { data: dl } = await axios.post(
		endpoint,
		new URLSearchParams({ action: 'download', url, quality: '192', is_playlist: '0' }),
		{ headers, timeout: 60_000 }
	);
	if (!dl?.file_url) throw new Error('Could not make a download link');

	return {
		title: info.title,
		uploader: info.author,
		duration: `${Math.floor(info.duration / 60)}:${String(info.duration % 60).padStart(2, '0')}`,
		views: Number(info.view_count || 0).toLocaleString(),
		likes: Number(info.like_count || 0).toLocaleString(),
		thumbnail: info.thumbnail,
		size: `${(dl.size / 1024 / 1024).toFixed(2)} MB`,
		format: dl.format,
		download_url: `${base}soundcloud-downloader/${dl.file_url.split('/').map(encodeURIComponent).join('/')}`
	};
}

/**
 * Searches SoundCloud tracks.
 * @param {string} query
 * @returns {Promise<{success: boolean, query: string, total?: number, results?: {id: number, title: string, artist: string|null, duration_ms: number, duration: string, url: string, artwork: string|null, genre: string|null, plays: number, likes: number}[], status?: number, message?: string}>}
 */
export async function searchSoundCloud(query) {
	const clock = ms => {
		const seconds = Math.floor(ms / 1000);
		return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
	};
	try {
		const res = await axios.get('https://api-mobi.soundcloud.com/search', {
			params: { q: query, client_id: 'KKzJxmw11tYpCs6T24P4uUYhqmjalG6M', stage: '' },
			headers: {
				Accept: 'application/json, text/javascript, */*; q=0.1',
				'Content-Type': 'application/json',
				'User-Agent': 'Mozilla/5.0'
			},
			timeout: 30_000
		});
		const results = (res.data?.collection || []).map(track => ({
			id: track.id,
			title: track.title,
			artist: track.user?.username || null,
			duration_ms: track.duration,
			duration: clock(track.duration),
			url: track.permalink_url,
			artwork: track.artwork_url,
			genre: track.genre || null,
			plays: track.playback_count || 0,
			likes: track.likes_count || 0
		}));
		return { success: true, query, total: results.length, results };
	} catch (err) {
		return { success: false, query, status: err.response?.status || 500, message: err.message };
	}
}

/* ───────────────────────────────── X / Twitter ───────────────────────────────── */

/**
 * A video from a tweet, in every resolution, and its audio (x2twitter.com).
 * @param {string} url
 * @returns {Promise<{code: number, status: 'success', metadata: {thumbnail: string, duration: string}, videos: {resolution: string, url: string}[], audio: {title: string, url: string}|null}|{error: true, message: string}>}
 */
export async function x2twitterDl(url) {
	const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
	try {
		const cfToken = [
			'0',
			randomBytes(16).toString('hex'),
			randomBytes(32).toString('base64url'),
			randomBytes(64).toString('base64url'),
			randomBytes(32).toString('hex')
		].join('.');

		const search = await axios.post(
			'https://x2twitter.com/api/ajaxSearch',
			new URLSearchParams({ q: url, lang: 'id', cftoken: cfToken }),
			{
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
					'X-Requested-With': 'XMLHttpRequest',
					Origin: 'https://x2twitter.com',
					Referer: 'https://x2twitter.com/id',
					'User-Agent': ua,
					Cookie: `_session=${randomBytes(16).toString('hex')}; lang=id`
				},
				timeout: 30_000
			}
		);
		if (search.data?.status !== 'ok') return { error: true, message: 'Could not get data from x2twitter.' };

		const html = search.data.data;
		const thumbnail = (html.match(/<img\s+src="([^"]+)"/) || [])[1] || '-';
		const duration = (html.match(/<p>(\d+:\d+)<\/p>/) || [])[1] || '-';

		// every link carries a token, and the token (a JWT) names the file: photos are left out
		const videos = [...html.matchAll(/href="https:\/\/dl\.snapcdn\.app\/get\?token=([^"]+)"/g)]
			.map(match => match[1])
			.map(token => {
				try {
					const decoded = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf-8'));
					if (decoded.filename && /\.(jpg|jpeg|png)$/i.test(decoded.filename)) return null;
					return {
						resolution: decoded.filename ? decoded.filename.split('_').pop().replace('.mp4', '') : 'unknown',
						url: `https://dl.snapcdn.app/get?token=${token}`
					};
				} catch {
					return null;
				}
			})
			.filter(Boolean);

		const audioUrl = (html.match(/data-audioUrl="([^"]+)"/) || [])[1];
		const mediaId = (html.match(/data-mediaId="([^"]+)"/) || [])[1];
		const convertHost = (html.match(/k_url_convert\s*=\s*"([^"]+)"/) || [])[1] || 'https://s1.twcdn.net/api/json/convert';
		const exp = (html.match(/k_exp\s*=\s*"([^"]+)"/) || [])[1];
		const token = (html.match(/k_token\s*=\s*"([^"]+)"/) || [])[1];

		let audio = null;
		if (audioUrl && mediaId && exp && token) {
			try {
				const converted = await axios.post(
					convertHost,
					new URLSearchParams({
						ftype: 'mp3',
						v_id: mediaId,
						audioUrl,
						audioType: 'video/mp4',
						fquality: '128',
						fname: 'X2Twitter.com',
						exp,
						token
					}),
					{
						headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', Accept: '*/*', 'User-Agent': ua },
						timeout: 30_000
					}
				);
				if (converted.data?.status === 'success') audio = { title: 'X2Twitter.com.mp3', url: converted.data.result };
			} catch {
				audio = null;
			}
		}

		return { code: 200, status: 'success', metadata: { thumbnail, duration }, videos, audio };
	} catch (err) {
		return { error: true, message: err.message };
	}
}

/* ───────────────────────────────── Search ───────────────────────────────── */

/**
 * Searches wallpaperflare.com.
 * @param {string} query
 * @returns {Promise<{success: boolean, total?: number, results?: {title: string, resolution: string, image: string, page: string}[], message?: string, error?: string}>}
 */
export async function wallpaperScraper(query) {
	try {
		const { data } = await axios.get(`https://www.wallpaperflare.com/search?wallpaper=${encodeURIComponent(query)}`, {
			headers: {
				'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
			},
			timeout: 30_000
		});

		const cheerio = await loadCheerio();
		const $ = cheerio.load(data);
		const results = [];
		$('li[itemprop="associatedMedia"]').each((_, el) => {
			const image = $(el).find('img').attr('data-src');
			const page = $(el).find('a[itemprop="url"]').attr('href');
			if (!image || !page) return;
			results.push({
				title: $(el).find('figcaption[itemprop="caption description"]').text().trim(),
				resolution: $(el).find('.res').text().trim(),
				image,
				page: `https://www.wallpaperflare.com${page}`
			});
		});

		if (!results.length) return { success: false, message: 'No wallpapers found' };
		return { success: true, total: results.length, results };
	} catch (err) {
		return { success: false, error: err.message };
	}
}

// the search service sometimes glues two links together: the last one is the real one
const lastUrl = url => {
	if (!url || typeof url !== 'string') return null;
	if ((url.match(/https?:\/\//g) || []).length <= 1) return url;
	return url.slice(url.lastIndexOf('http'));
};

/**
 * Searches TikTok videos (api.azbry.com).
 * @param {string} query
 * @returns {Promise<{title: string, cover: string|null, originCover: string|null, link: string, watermarkLink: string|null, music: string|null, author: {nickname: string, avatar: string|null}, stats: {plays: number, likes: number, comments: number, shares: number}}[]>}
 *   `link` is the video without the watermark
 */
export async function tiktokSearchVideo(query) {
	const { data } = await axios.get(`https://api.azbry.com/api/search/ttsearch?q=${encodeURIComponent(query)}`, {
		timeout: 30_000,
		headers: { 'user-agent': 'Mozilla/5.0' }
	});
	if (!data?.status || !Array.isArray(data?.result)) throw new Error(data?.message || 'TikTok search failed');

	const count = value => (Number.isFinite(Number(value)) ? Number(value) : 0);
	return data.result
		.map(item => ({
			title: item?.title || '',
			cover: lastUrl(item?.cover),
			originCover: lastUrl(item?.origin_cover),
			link: lastUrl(item?.link),
			watermarkLink: lastUrl(item?.watermark_link),
			music: lastUrl(item?.music),
			author: { nickname: item?.author?.nickname || '', avatar: lastUrl(item?.author?.avatar) },
			stats: {
				plays: count(item?.stats?.plays),
				likes: count(item?.stats?.likes),
				comments: count(item?.stats?.comments),
				shares: count(item?.stats?.shares)
			}
		}))
		.filter(item => item.link);
}

/* ───────────────────────────────── ssyoutube ───────────────────────────────── */

const SSYOUTUBE_SALT = '384d5028ee4a399f6cae0175025a1708aa924fc0ccb08be1aa359cd856dd1639';
const SSYOUTUBE_FIXED_TS = '1765962059039';

const sizeLabel = bytes => {
	if (!bytes) return 'Unknown';
	const units = ['Bytes', 'KB', 'MB', 'GB'];
	const i = Math.floor(Math.log(bytes) / Math.log(1024));
	return `${parseFloat((bytes / 1024 ** i).toFixed(2))} ${units[i]}`;
};

/**
 * The formats of a YouTube video (ssyoutube.com). Video links come with sound; `audio: true` marks the audio only ones.
 * The 720 / 480 links are made on request by a converter, the 360 one is a direct link.
 * @param {string} videoUrl
 * @returns {Promise<{meta: {id: string, title: string, duration: string, thumbnail: string}, downloads: {quality: string, format: string, size: string, url: string, audio?: boolean}[]}|{error: string}>}
 */
export async function ssyoutube(videoUrl) {
	try {
		if (!videoUrl || (!videoUrl.includes('youtube.com') && !videoUrl.includes('youtu.be'))) {
			return { error: 'That is not a YouTube link.' };
		}

		const ts = Date.now().toString();
		const signature = createHash('sha256').update(videoUrl + ts + SSYOUTUBE_SALT).digest('hex');
		const payload = { sf_url: videoUrl, ts, _ts: SSYOUTUBE_FIXED_TS, _tsc: '0', _s: signature };

		const { data } = await axios.post('https://ssyoutube.com/api/convert', new URLSearchParams(payload).toString(), {
			headers: {
				'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
				Accept: 'application/json, text/plain, */*',
				'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
				Origin: 'https://ssyoutube.com',
				Referer: 'https://ssyoutube.com/'
			},
			timeout: 30_000
		});
		if (!data?.url) return { error: 'Could not get the data, the server may be blocking the request.' };

		return {
			meta: { id: data.id, title: data.meta?.title, duration: data.meta?.duration, thumbnail: data.thumb },
			downloads: Array.isArray(data.url)
				? data.url
						.filter(item => !item.no_audio)
						.map(item => ({
							quality: item.quality || item.subname,
							format: item.ext,
							size: sizeLabel(item.filesize),
							url: item.url,
							audio: item.audio
						}))
				: []
		};
	} catch (err) {
		console.error(`[ssyoutube] ${err.message}`);
		return { error: err.message };
	}
}

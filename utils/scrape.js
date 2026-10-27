import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { createReadStream } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { createDecipheriv } from 'crypto';
import axios from 'axios';
import FormData from 'form-data';
import yts from 'yt-search';
import { FileTypeFromBuffer, getJson } from './utils.js';
import { extractUrl, isTikTok } from './main.js';

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
 * The downloader flow (Savetube first, ytmp3.ing as the audio fallback) is based on ytmp3.js by Febry Wesker.
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

async function youtube(input, { type, quality }) {
	const video = await resolveVideo(input);
	const backends = [{ name: 'savetube', run: () => savetube(video.url, { type, quality }) }];
	if (type === 'audio') backends.push({ name: 'ytmp3ing', run: () => ytmp3Ing(video.url) });

	let lastError;
	for (const backend of backends) {
		try {
			return { status: true, backend: backend.name, video, download: await backend.run() };
		} catch (err) {
			lastError = err;
			console.error(`[youtube] ${backend.name} failed: ${err.message}`);
		}
	}
	throw new Error(`All download backends failed. Last error: ${lastError?.message}`);
}

/**
 * YouTube audio as an mp3 (it comes as mp3 already, no conversion needed).
 * @param {string} input - A YouTube link or a search text (the first result is used)
 * @param {{quality?: string}} [options] - Bitrate, 256 by default
 * @returns {Promise<{status: boolean, backend: string, video: object, download: {title: string, downloadUrl: string, format: string}}>}
 */
export const ytmp3 = (input, { quality = '256' } = {}) => youtube(input, { type: 'audio', quality });

/**
 * YouTube video as an mp4.
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

/* ───────────────────────────────── TikTok ───────────────────────────────── */

const TIKTOK_API = 'https://aj-ibra.zone.id/api/tiktok';
const TIKTOK_CACHE_MS = 10 * 60_000;
const tiktokCache = new Map();

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

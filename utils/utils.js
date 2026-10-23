import { fileTypeFromBuffer } from 'file-type';
import fs from 'fs';
import fetch from 'node-fetch';
import axios from 'axios';
import { MAX_MEDIA_MB } from '../lib/resources.js';
import { getSharp } from './sharp.js';

const MAX_BYTES = MAX_MEDIA_MB * 1024 * 1024;

const tooLarge = () => Object.assign(new Error(`File is too large for this host (limit ${MAX_MEDIA_MB} MB)`), { tooLarge: true });

/** Reads a fetch() response into a Buffer, refusing anything over the memory limit instead of loading it whole. */
const readResponse = async response => {
	if (Number(response.headers.get('content-length')) > MAX_BYTES) throw tooLarge();
	const body = response.body;
	if (!body || typeof body[Symbol.asyncIterator] !== 'function') return Buffer.from(await response.arrayBuffer());
	const chunks = [];
	let size = 0;
	for await (const chunk of body) {
		size += chunk.length;
		if (size > MAX_BYTES) {
			body.destroy?.(); // node streams; a web stream is cancelled when the loop exits with the error below
			throw tooLarge();
		}
		chunks.push(chunk);
	}
	return Buffer.concat(chunks, size);
};

export const detectType = async buffer => {
	try {
		if (!buffer) {
			return { ext: 'bin', mime: 'application/octet-stream' };
		}

		let inputBuffer = buffer;
		if (!Buffer.isBuffer(buffer)) {
			if (buffer instanceof Uint8Array) {
				inputBuffer = Buffer.from(buffer);
			} else if (typeof buffer === 'string') {
				if (buffer.startsWith('data:')) {
					const base64Data = buffer.split(',')[1];
					inputBuffer = Buffer.from(base64Data, 'base64');
				} else if (buffer.startsWith('http')) {
					inputBuffer = await readResponse(await fetch(buffer));
				} else if (fs.existsSync(buffer)) {
					inputBuffer = fs.readFileSync(buffer);
				} else {
					try {
						inputBuffer = Buffer.from(buffer, 'base64');
					} catch {
						return { ext: 'txt', mime: 'text/plain' };
					}
				}
			} else if (buffer && typeof buffer === 'object' && buffer.url) {
				inputBuffer = await readResponse(await fetch(buffer.url));
			} else {
				return { ext: 'bin', mime: 'application/octet-stream' };
			}
		}

		if (!inputBuffer || inputBuffer.length === 0) {
			return { ext: 'bin', mime: 'application/octet-stream' };
		}

		const type = await fileTypeFromBuffer(inputBuffer);
		return type || { ext: 'bin', mime: 'application/octet-stream' };
	} catch (error) {
		console.error('File type detection error:', error);
		return { ext: 'bin', mime: 'application/octet-stream' };
	}
};

const mapMimeToMessageType = (mime = '', ext = '') => {
	const m = (mime || '').toLowerCase();
	const e = (ext || '').toLowerCase();

	if (!m && !e) return 'document';
	if (m.startsWith('image/')) return e === 'webp' || m === 'image/webp' ? 'sticker' : 'image';
	if (m.startsWith('video/')) return 'video';
	if (m.startsWith('audio/')) return 'audio';
	if (m === 'application/pdf') return 'document';
	if (m.startsWith('application/')) return 'document';

	if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic'].includes(e)) return e === 'webp' ? 'sticker' : 'image';
	if (['mp4', 'mkv', 'mov', 'webm', '3gp'].includes(e)) return 'video';
	if (['mp3', 'm4a', 'ogg', 'wav', 'flac', 'aac'].includes(e)) return 'audio';
	if (['pdf', 'zip', 'rar', '7z', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx'].includes(e)) return 'document';

	return 'document';
};

export const detectMessageType = async content => {
	try {
		if (typeof content === 'string') {
			if (content.startsWith('data:')) {
				const match = content.match(/^data:([^;]+);base64,/i);
				return mapMimeToMessageType(match ? match[1] : '', '');
			}

			if (content.startsWith('http://') || content.startsWith('https://')) {
				try {
					const urlObj = new URL(content);
					const ext = (urlObj.pathname.split('.').pop() || '').toLowerCase();
					if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic'].includes(ext)) return ext === 'webp' ? 'sticker' : 'image';
					if (['mp4', 'mkv', 'mov', 'webm', '3gp'].includes(ext)) return 'video';
					if (['mp3', 'm4a', 'ogg', 'wav', 'flac', 'aac'].includes(ext)) return 'audio';
					if (['pdf', 'zip', 'rar', '7z', 'doc', 'docx'].includes(ext)) return 'document';
				} catch {
					// not a parseable URL, fall through to plain text
				}
			}

			return 'text';
		}

		if (Buffer.isBuffer(content)) {
			const type = await detectType(content);
			return mapMimeToMessageType(type.mime, type.ext);
		}

		if (content && typeof content === 'object') {
			const baileyTypes = ['text', 'image', 'video', 'audio', 'sticker', 'document', 'location', 'contact'];
			for (const k of Object.keys(content)) {
				if (baileyTypes.includes(k)) return k;
			}

			if (content.mimetype || content.mime) {
				return mapMimeToMessageType(content.mimetype || content.mime, content.ext || '');
			}

			if (typeof content.type === 'string' && baileyTypes.includes(content.type.toLowerCase())) {
				return content.type.toLowerCase();
			}

			if (typeof content.url === 'string') {
				const url = content.url;
				if (url.startsWith('data:')) {
					const match = url.match(/^data:([^;]+);base64,/i);
					return mapMimeToMessageType(match ? match[1] : '', '');
				}
				try {
					const urlObj = new URL(url);
					const ext = (urlObj.pathname.split('.').pop() || '').toLowerCase();
					if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return ext === 'webp' ? 'sticker' : 'image';
					if (['mp4', 'm4a', 'mp3', 'ogg'].includes(ext)) return ext === 'mp4' ? 'video' : 'audio';
				} catch {
					// not a parseable URL, fall through
				}
			}

			if (content.data && Buffer.isBuffer(content.data)) {
				const t = await detectType(content.data);
				return mapMimeToMessageType(t.mime, t.ext);
			}

			return 'document';
		}

		return 'document';
	} catch (err) {
		console.error('detectMessageType error:', err);
		return 'document';
	}
};

export const getJson = async (url, options = {}) => {
	try {
		const response = await axios({
			url,
			method: 'GET',
			timeout: 30000,
			headers: {
				'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
				Accept: 'application/json',
				...options.headers
			},
			...options
		});
		return response.data;
	} catch (error) {
		console.error('getJson error:', error.message);
		throw new Error(`Failed to get JSON from ${url}: ${error.message}`);
	}
};

export const extractUrlFromString = text => {
	if (!text || typeof text !== 'string') return [];
	const urlRegex = /(https?:\/\/[^\s<>"{}|\\^`[\]]+)/gi;
	const matches = text.match(urlRegex);
	if (!matches) return [];
	return matches.filter(url => {
		try {
			new URL(url);
			return true;
		} catch {
			return false;
		}
	});
};

export const getMimeType = async buffer => {
	try {
		let inputBuffer = buffer;
		if (!Buffer.isBuffer(buffer)) {
			if (typeof buffer === 'string' && buffer.startsWith('http')) {
				inputBuffer = await readResponse(await fetch(buffer));
			} else if (typeof buffer === 'string') {
				try {
					inputBuffer = Buffer.from(buffer, 'base64');
				} catch {
					return 'application/octet-stream';
				}
			} else {
				return 'application/octet-stream';
			}
		}
		const type = await detectType(inputBuffer);
		return type.mime;
	} catch {
		return 'application/octet-stream';
	}
};

export const getExtension = async buffer => {
	const type = await detectType(buffer);
	return type.ext;
};

export const getBuffer = async source => {
	try {
		if (Buffer.isBuffer(source)) return source;

		if (typeof source === 'string') {
			if (source.startsWith('data:')) {
				const base64Data = source.split(',')[1];
				return Buffer.from(base64Data, 'base64');
			}

			if (source.startsWith('http://') || source.startsWith('https://')) {
				try {
					const response = await fetch(source, {
						headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
					});
					if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
					return await readResponse(response);
				} catch (fetchError) {
					if (fetchError.tooLarge) throw fetchError; // the axios fallback would just download it again
					console.error('Fetch error in getBuffer:', fetchError.message);
					const axiosResponse = await axios({
						method: 'GET',
						url: source,
						responseType: 'arraybuffer',
						timeout: 30000,
						maxContentLength: MAX_BYTES,
						maxBodyLength: MAX_BYTES,
						headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
					});
					return Buffer.from(axiosResponse.data);
				}
			}

			if (fs.existsSync(source)) return fs.readFileSync(source);

			try {
				return Buffer.from(source, 'base64');
			} catch {
				throw new Error(`Cannot process source: ${source.substring(0, 50)}...`);
			}
		}

		if (source && typeof source === 'object' && typeof source.url === 'string') {
			if (source.url.startsWith('data:')) {
				const base64Data = source.url.split(',')[1];
				return Buffer.from(base64Data, 'base64');
			}

			try {
				const response = await fetch(source.url, {
					headers: source.headers || { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
				});
				if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
				return await readResponse(response);
			} catch (fetchError) {
				if (fetchError.tooLarge) throw fetchError;
				const axiosResponse = await axios({
					method: 'GET',
					url: source.url,
					responseType: 'arraybuffer',
					timeout: 30000,
					maxContentLength: MAX_BYTES,
					maxBodyLength: MAX_BYTES,
					headers: source.headers || {}
				});
				return Buffer.from(axiosResponse.data);
			}
		}

		throw new Error('Unsupported source type');
	} catch (error) {
		console.error('Get buffer error:', error);
		throw error;
	}
};

export const FileTypeFromBuffer = fileTypeFromBuffer;
export const getFileType = detectType;
export const detectFileType = detectType;

export const formatSize = bytes => {
	if (bytes === 0) return '0 B';
	const k = 1024;
	const sizes = ['B', 'KB', 'MB', 'GB'];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

export const generateRandomString = (length = 8) => {
	const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let result = '';
	for (let i = 0; i < length; i++) result += characters.charAt(Math.floor(Math.random() * characters.length));
	return result;
};

export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export const getTime = () =>
	new Date().toLocaleString('en-US', {
		timeZone: 'Africa/Kampala',
		hour12: false,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit'
	});

export const formatDate = (date = new Date()) => date.toISOString().replace(/T/, ' ').replace(/\..+/, '');

export const validatePhoneNumber = number => {
	const phoneRegex = /^[\+]?[1-9][\d]{0,15}$/;
	return phoneRegex.test(number.replace(/[-()\s]/g, ''));
};

export const capitalize = str => str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();

export const escapeRegex = str => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const chunkArray = (array, size) => {
	const chunks = [];
	for (let i = 0; i < array.length; i += size) chunks.push(array.slice(i, i + size));
	return chunks;
};

export const sanitizeFileName = name => name.replace(/[^a-z0-9.]/gi, '_').toLowerCase();

export const readJsonFile = async filePath => {
	try {
		const data = await fs.promises.readFile(filePath, 'utf8');
		return JSON.parse(data);
	} catch (error) {
		console.error('Error reading JSON file:', error);
		return null;
	}
};

export const writeJsonFile = async (filePath, data) => {
	try {
		await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
		return true;
	} catch (error) {
		console.error('Error writing JSON file:', error);
		return false;
	}
};

export const ensureDir = async dirPath => {
	try {
		await fs.promises.mkdir(dirPath, { recursive: true });
		return true;
	} catch (error) {
		console.error('Error creating directory:', error);
		return false;
	}
};

export const isFileExists = async filePath => {
	try {
		await fs.promises.access(filePath);
		return true;
	} catch {
		return false;
	}
};

export const getMediaInfo = async buffer => {
	const type = await detectType(buffer);
	const size = Buffer.isBuffer(buffer) ? buffer.length : 0;
	return {
		...type,
		size,
		sizeFormatted: formatSize(size),
		isImage: type.mime.startsWith('image/'),
		isVideo: type.mime.startsWith('video/'),
		isAudio: type.mime.startsWith('audio/'),
		isDocument: !type.mime.startsWith('image/') && !type.mime.startsWith('video/') && !type.mime.startsWith('audio/')
	};
};

export const resizeBuffer = async (buffer, maxWidth = 1024, maxHeight = 1024) => {
	try {
		const sharp = await getSharp();
		return await sharp(buffer).resize(maxWidth, maxHeight, { fit: 'inside', withoutEnlargement: true }).toBuffer();
	} catch (error) {
		console.error('Error resizing buffer:', error);
		return buffer;
	}
};

export const convertToWebp = async (buffer, quality = 80) => {
	try {
		const sharp = await getSharp();
		return await sharp(buffer).webp({ quality }).toBuffer();
	} catch (error) {
		console.error('Error converting to WebP:', error);
		return buffer;
	}
};

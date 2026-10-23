import axios from 'axios';
import { bot } from '#lib';
import { formatSize } from '#utils';

const MAX_CHAT_LENGTH = 3000;
const MAX_JSON_PREVIEW = 2000;
const VALID_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

function isBlockedUrl(url) {
	const blocked = ['localhost', '127.0.0.1', '0.0.0.0', '::1', '169.254.', 'metadata.google', 'metadata.azure', '100.100.100.200'];
	return blocked.some(b => url.includes(b));
}

function detectExtension(contentType = '') {
	if (contentType.includes('png')) return 'png';
	if (contentType.includes('jpeg')) return 'jpg';
	if (contentType.includes('webp')) return 'webp';
	if (contentType.includes('svg')) return 'svg';
	if (contentType.includes('mp4')) return 'mp4';
	if (contentType.includes('webm')) return 'webm';
	if (contentType.includes('mpeg') || contentType.includes('mp3')) return 'mp3';
	if (contentType.includes('ogg')) return 'ogg';
	if (contentType.includes('wav')) return 'wav';
	if (contentType.includes('json')) return 'json';
	return 'bin';
}

function getMimeCategory(type = '') {
	if (type === 'image/gif') return 'gif';
	if (type.startsWith('audio/')) return 'audio';
	if (type.startsWith('video/')) return 'video';
	if (type.startsWith('image/')) return 'image';
	if (type.startsWith('text/') || type.includes('json')) return 'text';
	return 'document';
}

function parseHeaders(headerArgs) {
	const headers = {};
	const regex = /--header\s+["']([^:]+):\s*([^"']+)["']/gi;
	let match;
	while ((match = regex.exec(headerArgs)) !== null) headers[match[1].trim()] = match[2].trim();
	const simpleRegex = /--header\s+(\S+?):(\S+)/gi;
	while ((match = simpleRegex.exec(headerArgs)) !== null) if (!headers[match[1].trim()]) headers[match[1].trim()] = match[2].trim();
	return headers;
}

bot(
	{
		pattern: 'get|fetch',
		public: false,
		desc: 'Make an HTTP request (GET/POST/PUT/PATCH/DELETE) and show the response',
		type: 'tools'
	},
	async (message, match) => {
		let input = (match || '').trim();
		if (!input) {
			return message.send(
				'🌐 *HTTP REQUEST TOOL*\n\n' +
					'Options:\n' +
					'--method <GET|POST|PUT|PATCH|DELETE>\n' +
					'--json <body> — JSON body\n' +
					'--header "Key: Value" — custom header\n' +
					'--auth user:pass — basic auth\n' +
					'--verbose / -v — show response headers\n' +
					'--timeout <ms> — request timeout\n' +
					'--post — shortcut for --method POST\n\n' +
					`Examples:\n${message.prefix}get https://api.example.com\n${message.prefix}get https://api.example.com --post --json {"key":"val"}`
			);
		}

		const isVerbose = /--verbose|-v\b/i.test(input);
		input = input.replace(/--verbose|-v\b/gi, '').trim();

		const isPost = /--post\b/i.test(input);
		input = input.replace(/--post\b/gi, '').trim();

		let method = 'GET';
		const methodMatch = input.match(/--method\s+(\w+)/i);
		if (methodMatch) {
			method = methodMatch[1].toUpperCase();
			input = input.replace(/--method\s+\w+/i, '').trim();
		} else if (isPost) {
			method = 'POST';
		}

		if (!VALID_METHODS.includes(method)) {
			return message.send(`_Invalid method: ${method}. Valid: ${VALID_METHODS.join(', ')}_`);
		}

		let jsonBody = null;
		const jsonMatch = input.match(/--json\s+(\{[\s\S]*?\})(?=\s+--|$)/i);
		if (jsonMatch) {
			try {
				jsonBody = JSON.parse(jsonMatch[1]);
				input = input.replace(/--json\s+\{[\s\S]*?\}/i, '').trim();
			} catch (e) {
				return message.send(`_Invalid JSON body: ${e.message}_`);
			}
		}

		let auth = null;
		const authMatch = input.match(/--auth\s+(\S+)/i);
		if (authMatch) {
			auth = authMatch[1];
			input = input.replace(/--auth\s+\S+/i, '').trim();
		}

		let timeout = 120000;
		const timeoutMatch = input.match(/--timeout\s+(\d+)/i);
		if (timeoutMatch) {
			timeout = Math.min(parseInt(timeoutMatch[1], 10), 300000);
			input = input.replace(/--timeout\s+\d+/i, '').trim();
		}

		const customHeaders = parseHeaders(input);
		input = input.replace(/--header\s+["'][^"']+["']/gi, '').trim();
		input = input.replace(/--header\s+\S+:\S+/gi, '').trim();

		let url = input.trim();
		if (!url.startsWith('http://') && !url.startsWith('https://')) url = 'https://' + url;

		if (isBlockedUrl(url)) return message.send('_Localhost / internal / metadata addresses are blocked._');

		try {
			new URL(url);
		} catch {
			return message.send('_Invalid URL._');
		}

		await message.send(`_${method} ${url} ..._`);

		try {
			const startTime = Date.now();
			const response = await axios({
				method: method.toLowerCase(),
				url,
				data: jsonBody,
				timeout,
				maxRedirects: 5,
				validateStatus: () => true,
				responseType: 'arraybuffer',
				headers: {
					'User-Agent': 'Mozilla/5.0 (compatible; NovaBot/1.0)',
					Accept: '*/*',
					...(jsonBody ? { 'Content-Type': 'application/json' } : {}),
					...customHeaders
				},
				...(auth ? { auth: { username: auth.split(':')[0], password: auth.split(':').slice(1).join(':') } } : {})
			});

			const elapsed = Date.now() - startTime;
			const contentType = response.headers['content-type'] || '';
			const mimeType = contentType.split(';')[0];
			const ext = detectExtension(contentType);
			const category = getMimeCategory(mimeType);
			const buffer = Buffer.from(response.data);
			const size = buffer.length;
			const statusEmoji = response.status >= 200 && response.status < 300 ? '✅' : '⚠️';

			let header =
				`🌐 *HTTP RESPONSE*\n\n` +
				`${statusEmoji} Status: ${response.status} ${response.statusText}\n` +
				`📨 Method: ${method}\n` +
				`⏱️ Time: ${elapsed}ms\n` +
				`📦 Size: ${formatSize(size)}\n` +
				`📄 Type: ${mimeType || 'unknown'}`;

			if (isVerbose) {
				const respHeaders = Object.entries(response.headers)
					.map(([k, v]) => `${k}: ${v}`)
					.join('\n');
				header += `\n\n*Response headers:*\n${respHeaders}`;
			}

			if (category === 'gif') {
				return message.send(buffer, { type: 'video', gifPlayback: true, mimetype: 'video/mp4', caption: header });
			}
			if (category === 'audio') return message.send(buffer, { type: 'audio', mimetype: mimeType, caption: header });
			if (category === 'video') return message.send(buffer, { type: 'video', mimetype: mimeType, caption: header });
			if (category === 'image') return message.send(buffer, { type: 'image', mimetype: mimeType, caption: header });

			if (category === 'text' && buffer.length <= MAX_CHAT_LENGTH) {
				let text = buffer.toString();
				if (ext === 'json') {
					try {
						const parsed = JSON.parse(text);
						text = JSON.stringify(parsed, null, 2);
						if (text.length > MAX_JSON_PREVIEW) {
							text = text.slice(0, MAX_JSON_PREVIEW) + `\n\n... (truncated, full size: ${formatSize(size)})`;
						}
					} catch {
						// not valid JSON, send as-is
					}
				}
				return message.send(`${header}\n\n\`\`\`${text}\`\`\``);
			}

			const fileName = `response_${Date.now()}.${ext}`;
			return message.send(buffer, {
				type: 'document',
				fileName,
				mimetype: mimeType || 'application/octet-stream',
				caption: `${header}\n\n📎 Full response sent as a file`
			});
		} catch (err) {
			return message.send(`_Request failed: ${err?.message || err}_`);
		}
	}
);

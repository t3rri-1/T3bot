import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { createDecipheriv, createHash } from 'node:crypto';
import { join } from 'node:path';
import { config } from '#config';

export const SESSION_DIR = 'session';
const INVALID_FILE = '.session-invalid';

const sessionId = () => String(config.SESSION_ID || '').trim();
const fingerprint = id => createHash('sha256').update(id).digest('hex');

export const hasUsableSessionId = () => {
	const id = sessionId();
	if (!id) return false;
	try {
		if (readFileSync(INVALID_FILE, 'utf8').trim() === fingerprint(id)) return false;
	} catch {
		// no marker, the ID is untouched
	}
	return true;
};

const fetchSession = async () => {
	try {
		const res = await fetch(
			`https://t3rri-id.onrender.com/session?session=${encodeURIComponent(sessionId())}`,
			{ signal: AbortSignal.timeout(20000) }
		);
		return res.ok ? await res.json() : null;
	} catch {
		return null;
	}
};

export function initSession(Source) {
	if (!Source) return null;
	try {
		const key = Buffer.from(Source.key, 'hex');
		const iv = Buffer.from(Source.iv, 'hex');
		const decipher = createDecipheriv('aes-256-cbc', key, iv);
		let decrypted = decipher.update(Source.data, 'hex', 'utf8');
		decrypted += decipher.final('utf8');
		const data = JSON.parse(decrypted);
		mkdirSync(SESSION_DIR, { recursive: true });
		writeFileSync(join(SESSION_DIR, 'creds.json'), JSON.stringify(data.creds));
		for (const [filename, syncKeyData] of Object.entries(data.syncKeys || {})) {
			writeFileSync(join(SESSION_DIR, filename), JSON.stringify(syncKeyData));
		}
		return data;
	} catch (err) {
		console.log('Session ID could not be decoded:', err?.message || err);
		return null;
	}
}

export async function loadSession() {
	if (!sessionId()) {
		console.log('No SESSION_ID set');
		return false;
	}
	if (!hasUsableSessionId()) {
		console.log('SESSION_ID was logged out earlier, ignoring it');
		return false;
	}
	const data = await fetchSession();
	if (!data) {
		console.log('Could not fetch the session for SESSION_ID');
		return false;
	}
	if (!initSession(data)) return false;
	console.log('Session Connected');
	return true;
}

/** WhatsApp ended the session: drop local credentials and stop trusting this SESSION_ID. */
export function discardSession() {
	const id = sessionId();
	if (id) {
		try {
			writeFileSync(INVALID_FILE, fingerprint(id));
		} catch {
			// not fatal, worst case the ID is tried again on the next boot
		}
	}
	try {
		rmSync(SESSION_DIR, { recursive: true, force: true });
	} catch {
		// folder already gone
	}
}

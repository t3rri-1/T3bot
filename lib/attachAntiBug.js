/**
 * AntiBug, automatic: lib/client.js calls attachAntiBug() for every new socket, so there is no command and
 * nothing to switch on. Bug messages (see anchorguard.js) are removed as they arrive, and the message handler
 * skips them.
 *
 * Optional environment variables (all of them are optional):
 *   ANTIBUG         off = do not guard at all (default: on)
 *   ANTIBUG_BLOCK   on  = also block the number that sent the bug (default: off)
 *   ANTIBUG_NOTIFY  off = do not message the owner about removed bugs (default: on)
 */
import { jidNormalizedUser } from 'baileys';
import { config } from '#config';
import { createAntiBugGuard } from './anchorguard.js';

const NOTIFY_COOLDOWN_MS = 30_000;
let lastNotifyAt = 0;
let activeGuard = null;

const envFlag = (name, fallback) => {
	const raw = String(process.env[name] ?? '')
		.trim()
		.toLowerCase();
	if (['on', 'true', '1', 'yes'].includes(raw)) return true;
	if (['off', 'false', '0', 'no'].includes(raw)) return false;
	return fallback;
};

export const getAntiBugSettings = () => ({
	enabled: envFlag('ANTIBUG', true),
	blockOnBug: envFlag('ANTIBUG_BLOCK', false),
	notifyOwner: envFlag('ANTIBUG_NOTIFY', true)
});

// the first number in SUDO, else the bot's own chat
const ownerJidOf = conn => {
	for (const entry of String(config.SUDO ?? '').split(/[;,]+/)) {
		const digits = entry.replace(/\D/g, '');
		if (digits.length >= 7 && digits.length <= 15) return `${digits}@s.whatsapp.net`;
	}
	return conn.user?.id ? jidNormalizedUser(conn.user.id) : null;
};

export function attachAntiBug(conn) {
	if (activeGuard) {
		try {
			activeGuard.stop();
		} catch {
			// the old socket is gone already
		}
		activeGuard = null;
	}

	const settings = getAntiBugSettings();
	if (!settings.enabled) return null;

	activeGuard = createAntiBugGuard(conn, {
		autoDelete: true,
		deleteMode: 'auto',
		guardIncoming: true,
		guardOutgoing: false, // never second-guess what the bot itself sends
		blockOnBug: settings.blockOnBug,
		selfOnly: false,
		onDetect: async ({ direction, jid, sender, reasons }) => {
			const who = String(conn.getJid?.(sender) ?? sender).split('@')[0];
			const label =
				direction === 'incoming'
					? `bug message from ${who} in ${jid} removed`
					: `outgoing message to ${jid} blocked`;
			console.log(`[antibug] ${label}: ${reasons.join(', ')}`);

			if (!settings.notifyOwner) return;
			const target = ownerJidOf(conn);
			if (!target) return;

			const now = Date.now();
			if (now - lastNotifyAt < NOTIFY_COOLDOWN_MS) return; // already told them a moment ago
			lastNotifyAt = now;

			try {
				await conn.sendMessage(target, { text: `🛡️ *AntiBug*: ${label}\nReason: ${reasons.join(', ')}` });
			} catch (err) {
				console.log('[antibug] could not notify the owner:', err?.message || err);
			}
		}
	});

	return activeGuard;
}

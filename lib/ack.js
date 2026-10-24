/**
 * Knowing whether WhatsApp really took a message.
 *
 * sendMessage() / relayMessage() resolve as soon as the frame is written to the socket, so "no error"
 * only means "handed to the connection". WhatsApp answers every message with an <ack id="..."> node and
 * puts error="..." on it when it refuses the message (no permission, bad payload, rate limit). Baileys
 * does not pass that back to the caller, which is how a status can be reported as posted when it never was.
 *
 *   const { confirmed } = await sendConfirmed(client, jid, content, options)
 *     confirmed: true   WhatsApp acknowledged the message
 *     confirmed: false  no answer in time (the connection may be struggling), the message may still arrive
 *     throws            WhatsApp refused it, the error says why
 */
import { generateMessageIDV2 } from 'baileys';

const HINTS = {
	401: 'the session is not authorised, link the bot again',
	403: 'not allowed here, no permission in this chat or group',
	406: 'WhatsApp did not accept this kind of message',
	429: 'rate limited, wait a minute and try again'
};

export const ackErrorText = code => {
	const text = String(code);
	const hint = HINTS[text] || (/^5\d\d$/.test(text) ? 'WhatsApp had a server problem, try again' : '');
	return `WhatsApp refused it (error ${text}${hint ? `: ${hint}` : ''})`;
};

/**
 * Start listening for the ack of message `id`. Call BEFORE sending, then call wait() or cancel() exactly once.
 * wait() resolves { confirmed, error }; it never rejects.
 */
export const watchAck = (client, id) => {
	const ws = client?.ws;
	if (!id || typeof ws?.once !== 'function') {
		return { wait: async () => ({ confirmed: false, error: null }), cancel() {} };
	}

	const event = `CB:ack,id:${id}`;
	let timer;
	let settle;
	const answer = new Promise(done => (settle = done));
	const onAck = node => settle({ confirmed: true, error: node?.attrs?.error ? String(node.attrs.error) : null });
	const stop = () => {
		clearTimeout(timer);
		ws.off(event, onAck);
	};

	ws.once(event, onAck);
	return {
		async wait(timeout = 20_000) {
			timer = setTimeout(() => settle({ confirmed: false, error: null }), timeout);
			try {
				return await answer;
			} finally {
				stop();
			}
		},
		cancel() {
			stop();
			settle({ confirmed: false, error: null });
		}
	};
};

/**
 * Run `send(id)` (which must send a message using that id) and wait for WhatsApp's verdict.
 * Resolves { value, id, confirmed }, throws when the send fails or WhatsApp refuses the message.
 */
export const sendWithAck = async (client, id, send, { timeout = 20_000 } = {}) => {
	const watch = watchAck(client, id);
	let value;
	try {
		value = await send(id);
	} catch (err) {
		watch.cancel();
		throw err;
	}
	const ack = await watch.wait(timeout); // the clock starts once the frame is out, big audiences take a while to encrypt
	if (ack.error) throw Object.assign(new Error(ackErrorText(ack.error)), { code: ack.error });
	return { value, id, confirmed: ack.confirmed };
};

/** client.sendMessage(), but only resolves once WhatsApp has answered (see above). */
export const sendConfirmed = (client, jid, content, options = {}, settings) => {
	const id = options.messageId || generateMessageIDV2(client.user?.id);
	return sendWithAck(client, id, messageId => client.sendMessage(jid, content, { ...options, messageId }), settings);
};

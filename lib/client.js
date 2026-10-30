import {
    makeWASocket,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    DisconnectReason,
    Browsers,
    useMultiFileAuthState,
    isJidBroadcast,
    isLidUser,
    isPnUser,
    jidDecode,
    jidNormalizedUser
} from 'baileys';
import { rmSync } from 'node:fs';
import { EventEmitter } from 'events';
import Message from './class.js';
import { bindButton } from './button.js';
import { attachAntiBug } from './attachAntiBug.js';
import { manageProcess, delay } from '#utils';
import { AntiCall, AntiDelete, AntiEdit, AntiStatus, AutoUpdater, Greetings, GroupEventPartial, GroupEvents } from '#bot';
import { loadMessage, saveMessage, getGroupMetadata, getName, getAutoUpdateMode } from '#sql';
import { getConfigValues, upserts, Plugins, serialize, logger } from '#lib';
import { SESSION_DIR, discardSession } from './session.js';
import { invalidateGroupMeta } from './message.js';
import { config } from '#config';

EventEmitter.defaultMaxListeners = 2000;
process.setMaxListeners(2000);

const MAX_PAIRING_ROUNDS = 5; // codes issued (about 3 minutes each) before giving up until the next restart
let failures = 0; // consecutive failed connections, drives the reconnect backoff
let pairingRounds = 0; // pairing rounds started since the last successful link

const backoff = () => Math.min(10000 * 2 ** Math.max(failures - 1, 0), 120000);

const scheduleReconnect = wait => {
    setTimeout(async () => {
        try {
            await client();
        } catch (err) {
            console.log('Reconnect failed:', err?.message || err);
            failures++;
            scheduleReconnect(backoff());
        }
    }, wait);
};

const isLinked = creds => Boolean(creds?.registered || creds?.account);

export const getPairingNumber = () => {
    for (const entry of String(config.SUDO ?? '').split(/[;,]+/)) {
        let digits = entry.replace(/\D/g, '');
     
        if (digits.length > 15) digits = entry.trim().split(/\s+/)[0].replace(/\D/g, '');
        if (digits.length >= 7 && digits.length <= 15) return digits;
    }
    return null;
};

const mask = number => `${number.slice(0, 3)}${'*'.repeat(Math.max(number.length - 7, 0))}${number.slice(-4)}`;

const loadAuth = async () => {
    try {
        return await useMultiFileAuthState(SESSION_DIR);
    } catch (err) {
        console.log('Local session is unreadable, resetting it:', err?.message || err);
        rmSync(SESSION_DIR, { recursive: true, force: true });
        return await useMultiFileAuthState(SESSION_DIR);
    }
};

const LID_CACHE_MAX = 5000;

// WhatsApp now addresses a lot of people by an @lid id. Commands, sudo, bans, admin checks and mentions
// all work with phone-number JIDs, so (like ChiiMD) every incoming id is mapped back to its
// @s.whatsapp.net twin: from key.participantAlt / key.remoteJidAlt, the group member list, or
// Baileys' own LID store. Only Baileys' jid helpers are used, there is no separate jid module.
const bindJid = conn => {
    const lidToPn = new Map();

    const remember = (lid, pn) => {
        lid = conn.decodeJid(lid);
        pn = conn.decodeJid(pn);
        if (!isLidUser(lid) || !isPnUser(pn)) return;
        lidToPn.delete(lid);
        lidToPn.set(lid, pn);
        if (lidToPn.size > LID_CACHE_MAX) lidToPn.delete(lidToPn.keys().next().value);
    };

    // strips the device part ("123:5@s.whatsapp.net" -> "123@s.whatsapp.net")
    conn.decodeJid = jid => {
        if (!jid || typeof jid !== 'string') return jid || null;
        if (!/:\d+@/.test(jid)) return jid.trim();
        const { user, server } = jidDecode(jid) || {};
        return ((user && server && `${user}@${server}`) || jid).trim();
    };

    // @lid -> phone-number JID when we know it; anything else comes back untouched
    conn.getJid = jid => {
        jid = conn.decodeJid(jid);
        if (!isLidUser(jid)) return jid;
        const { id, lid } = conn.user || {};
        if (lid && jid === conn.decodeJid(lid)) return conn.decodeJid(id);
        return lidToPn.get(jid) || jid;
    };

    // same as getJid, but also takes the twin Baileys hands over (participantAlt / remoteJidAlt)
    // and, as a last resort, asks Baileys' own LID <-> phone number store
    conn.resolveJid = async (jid, alt) => {
        const id = conn.decodeJid(jid);
        if (!isLidUser(id)) return id;

        const twin = conn.decodeJid(alt);
        if (isPnUser(twin)) {
            remember(id, twin);
            return twin;
        }

        const known = conn.getJid(id);
        if (known !== id) return known;

        try {
            const pn = await conn.signalRepository?.lidMapping?.getPNForLID(id);
            if (pn) {
                remember(id, pn);
                return conn.getJid(id);
            }
        } catch {
            // the mapping is not available (yet), keep the @lid
        }
        return id;
    };

    // a group member ({ id, lid, phoneNumber }, or a plain jid on older Baileys) -> its phone-number JID.
    // Also learns the pair, so later lookups by @lid work.
    conn.participantJid = p => {
        if (!p || typeof p === 'string') return conn.getJid(p);
        remember(isLidUser(p.id) ? p.id : p.lid, isPnUser(p.id) ? p.id : p.phoneNumber);
        return conn.getJid(p.phoneNumber || p.id);
    };
};

export const client = async () => {
    const { state, saveCreds } = await loadAuth();
    const linked = isLinked(state.creds);

    if (!linked && state.creds.me) {
       
        state.creds.me = undefined;
        state.creds.pairingCode = undefined;
    }

    const { version } = await fetchLatestBaileysVersion();

    const conn = makeWASocket({
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger)
        },
        logger,
       
        browser: linked ? Browsers.windows('Desktop') : Browsers.ubuntu('Chrome'),
        version,
        keepAliveIntervalMs: 30000,
        syncFullHistory: false,
        shouldSyncHistoryMessage: () => false,
        defaultQueryTimeoutMs: 60000,
        retryRequestDelayMs: 10000,
        markOnlineOnConnect: true,
        fireInitQueries: true,
        emitOwnEvents: true,
        generateHighQualityLinkPreview: false,
        getMessage: async key => {
            const store = await loadMessage(key.id);
            return store ? store : { conversation: null };
        },
        cachedGroupMetadata: async jid => {
            const store = await getGroupMetadata(jid);
            return store || null;
        }
    });

    bindJid(conn);
    bindButton(conn);
    const antibug = attachAntiBug(conn); // automatic, see lib/attachAntiBug.js

    let pairingStarted = false;
    let pairTimer = null;

    const startPairing = async () => {
        if (pairingStarted || isLinked(state.creds)) return;
        pairingStarted = true;

        const number = getPairingNumber();
        if (!number) {
            console.log(
                '\n❌ No session to start with and SUDO is not a valid number.\n' +
                    '   Set SUDO to your WhatsApp number with country code (e.g. 2567XXXXXXXX), or set SESSION_ID.\n'
            );
            return;
        }

        pairingRounds++;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const raw = await conn.requestPairingCode(number);
                const code = raw?.match(/.{1,4}/g)?.join('-') ?? raw;
                console.log(
                    `\n🔑 PAIRING CODE for +${mask(number)} >>: ${code}\n` +
                        '   WhatsApp > Linked devices > Link a device > Link with phone number instead\n'
                );
                return;
            } catch (err) {
                console.log(`Pairing code request failed (${attempt}/3): ${err?.message || err}`);
                if (attempt < 3) await delay(3000);
            }
        }
    };

    if (!linked) {
        console.log('No linked session found, a pairing code will be requested');
     
        pairTimer = setTimeout(startPairing, 6000);
    }

    const teardown = () => {
        clearTimeout(pairTimer);
        try {
            conn.ev.removeAllListeners();
        } catch {
            
        }
    };

    conn.ev.on('call', async calls => {
        await AntiCall(calls, conn);
    });

    conn.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
        if (qr && !isLinked(state.creds)) startPairing();

        switch (connection) {
            case 'connecting':
                console.log('Connecting...');
                break;

            case 'close': {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                teardown();

                if (statusCode === DisconnectReason.loggedOut) {
                    console.log('Logged out, resetting session and restarting...');
                    discardSession();
                    manageProcess('restart');
                    break;
                }

                if (!isLinked(state.creds)) {
                    if (!getPairingNumber()) break;
                    if (pairingRounds >= MAX_PAIRING_ROUNDS) {
                        console.log('Pairing code was not used in time. Restart the bot to get a new one.');
                        break;
                    }
                    console.log('Pairing code expired, requesting a new one...');
                    scheduleReconnect(3000);
                    break;
                }

                if (statusCode === DisconnectReason.restartRequired) {
                    scheduleReconnect(1000);
                    break;
                }

                failures++;
                const wait = backoff();
                console.log(`Connection closed (${statusCode}), reconnecting in ${Math.round(wait / 1000)}s...`);
                scheduleReconnect(wait);
                break;
            }

            case 'open': {
                failures = 0;
                pairingRounds = 0;
                const vInfo = version.join('.');
                console.log(`✅ Connected! Version: ${vInfo}`);
                try {
                    await conn.sendMessage(jidNormalizedUser(conn.user.id), {
                        text: `\`\`\`Bot Connected\n${vInfo}\`\`\``
                    });
                } catch (err) {
                    console.log('Failed to send connected message:', err?.message || err);
                }

                AutoUpdater(conn, {
                    getMode: getAutoUpdateMode,
                    getPrefix: async () => Array.from((await getConfigValues()).PREFIX || '.')[0]
                }).catch(err => console.log('Auto-updater error:', err?.message || err));

                if (global.__novaBioInterval) clearInterval(global.__novaBioInterval);
                const botname = config.BOT_INFO.split(';')[1] || 'Nova';
                const updateBio = async () => {
                    try {
                        const date = new Date();
                        const tz = config.TIME_ZONE || 'Africa/Lagos';
                        await conn.updateProfileStatus(
                            `${botname} is active 24/7\n\n${date.toLocaleString('en-US', {
                                timeZone: tz
                            })} — ${date.toLocaleString('en-US', { weekday: 'long', timeZone: tz })}`
                        );
                    } catch {
                        // profile status updates can fail transiently, not worth logging noisily
                    }
                };
                updateBio();
                global.__novaBioInterval = setInterval(updateBio, 5 * 60 * 1000);
                break;
            }
        }
    });

    conn.ev.on('creds.update', () => {
        saveCreds().catch(err => console.log('Could not save credentials (disk full?):', err?.message || err));
    });

    conn.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        const { autoRead, autoStatusRead, autolikestatus, statusEmoji } = await getConfigValues();

        for (const message of messages) {
            try {
                // a bug message is removed by AntiBug, nothing else should store or process it
                if (antibug?.detect(message.message).flagged) continue;
                const msg = await serialize(JSON.parse(JSON.stringify(message)), conn);
                if (autoRead) await conn.readMessages([msg.key]);
                if (autoStatusRead && isJidBroadcast(msg.from)) await conn.readMessages([message.key]);
                if (autolikestatus && isJidBroadcast(msg.from)) {
                    try {
                        const participant = await conn.resolveJid(message.key.participant, message.key.participantAlt);
                        await conn.sendMessage(
                            msg.from,
                            { react: { key: message.key, text: statusEmoji || '🌀' } },
                            { statusJidList: [participant, conn.user.id] }
                        );
                    } catch (err) {
                        console.log('autolikestatus react failed:', err?.message || err);
                    }
                }
                await Promise.all([
                    Plugins(msg, conn, new Message(conn, msg)),
                    saveMessage(msg),
                    upserts(msg)
                ]);
            } catch (err) {
                console.log('message handler error:', err?.message || err);
            }
        }
    });

    // deleted messages, edited messages and deleted statuses all arrive here, each handler takes its own kind
    conn.ev.on('messages.update', async updates => {
        await Promise.all([AntiDelete(conn, updates), AntiEdit(conn, updates), AntiStatus(conn, updates)]);
    });

    conn.ev.on('group-participants.update', async ({ id, participants, action, author, authorPn }) => {
        invalidateGroupMeta(id);
        if ((await getConfigValues()).disablegc) return;
        // Baileys v7 sends every participant as { id, lid, phoneNumber, admin }, the handlers want plain phone-number JIDs
        const members = (participants || []).map(conn.participantJid);
        const by = author ? await conn.resolveJid(author, authorPn) : author;
        const event = { Group: id, participants: members, action: action, by };
        await Promise.all([Greetings(event, conn), GroupEvents(event, conn)]);
    });

    conn.ev.on('groups.update', async updates => {
        for (const update of updates) invalidateGroupMeta(update.id);
        if ((await getConfigValues()).disablegc) return;
        for (const update of updates) {
            await GroupEventPartial(update, conn);
        }
    });

    conn.loadMessage = loadMessage.bind(conn);
    conn.getName = getName.bind(conn);

    return conn;
};

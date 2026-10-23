import { areJidsSameUser, jidDecode, jidNormalizedUser } from 'baileys';

export const isLidJid = jid => typeof jid === 'string' && /@lid$/.test(jid);

export const normalizeJid = jid => {
	if (!jid || typeof jid !== 'string') return jid;
	try {
		return jidNormalizedUser(jid);
	} catch {
		return jid;
	}
};

export const decodeJid = jid => {
	if (!jid || typeof jid !== 'string') return jid;
	if (!/:\d+@/.test(jid)) return jid;
	const decoded = jidDecode(jid) || {};
	return (decoded.user && decoded.server && `${decoded.user}@${decoded.server}`) || jid;
};

export const extractNumber = jid => {
	if (jid === null || jid === undefined) return null;
	const match = String(jid).match(/\d{5,}/);
	return match ? match[0] : null;
};

export const sameUser = (a, b) => {
	if (!a || !b) return false;
	const jidA = normalizeJid(a);
	const jidB = normalizeJid(b);
	if (!jidA || !jidB) return false;

	try {
		if (areJidsSameUser(jidA, jidB)) return true;
	} catch {
		// malformed jid, fall through to the number-based check below
	}

	if (isLidJid(jidA) !== isLidJid(jidB)) return false;

	const numA = extractNumber(jidA);
	const numB = extractNumber(jidB);
	return !!numA && !!numB && numA === numB;
};

export const isSameUserInList = (jid, list = []) => Array.isArray(list) && list.some(item => sameUser(jid, item));

export const buildIdentityMap = (participants = []) => {
	const lidToPn = {};
	const pnToLid = {};

	for (const p of participants || []) {
		const id = p?.id ? normalizeJid(p.id) : null;
		const pn = p?.phoneNumber ? normalizeJid(p.phoneNumber) : null;
		const lid = p?.lid ? normalizeJid(p.lid) : null;

		if (!id) continue;

		if (isLidJid(id)) {
			if (pn && !isLidJid(pn)) lidToPn[id] = pn;
		} else if (lid && isLidJid(lid)) {
			pnToLid[id] = lid;
		}
	}

	return { lidToPn, pnToLid };
};

export const resolveToPn = async (jid, sock, idMap = {}, pnHint = null) => {
	const norm = normalizeJid(jid);
	const hint = normalizeJid(pnHint);

	if (!norm || !isLidJid(norm)) return norm;
	if (hint && !isLidJid(hint)) return hint;

	const fromMap = idMap?.lidToPn?.[norm];
	if (fromMap) return fromMap;

	try {
		const store = sock?.signalRepository?.lidMapping;
		if (store?.getPNForLID) {
			const pn = await store.getPNForLID(norm);
			if (pn) return normalizeJid(pn);
		}
	} catch {
		// mapping isn't available yet - fall through and return the LID
	}

	return norm;
};

export const resolveToLid = async (jid, sock, idMap = {}, lidHint = null) => {
	const norm = normalizeJid(jid);
	const hint = normalizeJid(lidHint);

	if (!norm || isLidJid(norm)) return norm;
	if (hint && isLidJid(hint)) return hint;

	const fromMap = idMap?.pnToLid?.[norm];
	if (fromMap) return fromMap;

	try {
		const store = sock?.signalRepository?.lidMapping;
		if (store?.getLIDForPN) {
			const lid = await store.getLIDForPN(norm);
			if (lid) return normalizeJid(lid);
		}
	} catch {
		// mapping isn't available yet - fall through and return the PN
	}

	return norm;
};

export const participantMatches = (participant, targets = []) => {
	if (!participant) return false;

	const candidates = [participant.id, participant.phoneNumber, participant.lid]
		.filter(Boolean)
		.map(normalizeJid);
	const candidateNumbers = candidates.map(extractNumber).filter(Boolean);

	return targets.some(target => {
		if (!target) return false;
		const normTarget = normalizeJid(target);
		if (candidates.includes(normTarget)) return true;
		const targetNumber = extractNumber(normTarget);
		return !!targetNumber && candidateNumbers.includes(targetNumber);
	});
};

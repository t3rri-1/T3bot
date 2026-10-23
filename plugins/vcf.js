import { bot } from '#lib';
import { isJidGroup } from 'baileys';
import { buildIdentityMap, resolveToPn, extractNumber } from '#utils';

function e164(phoneNumber) {
	return '+' + phoneNumber;
}

function escapeName(name) {
	return (name || '').replace(/[;:,\\]/g, ' ').trim();
}

function makeVcard(phoneNumber, contactName) {
	const escapedName = contactName ? escapeName(contactName) : null;
	const fullName = escapedName ? `${escapedName} - ${e164(phoneNumber)}` : e164(phoneNumber);
	const nameParts = escapedName ? escapedName.split(' ') : [];
	const firstName = nameParts[0] || '';
	const lastName = nameParts.slice(1).join(' ');

	return [
		'BEGIN:VCARD',
		'VERSION:3.0',
		'FN:' + fullName,
		'N:' + firstName + ';' + lastName + ';;;',
		'TEL;type=CELL;type=VOICE;waid=' + phoneNumber + ':' + e164(phoneNumber),
		'END:VCARD'
	].join('\r\n');
}

bot(
	{
		pattern: 'vcf',
		public: true,
		desc: 'Single contact card, or export all group members as an importable .vcf file',
		type: 'tools'
	},
	async (message, match) => {
		await message.react('📇');

		const userInput = (match || '').trim();

		if (userInput) {
			const argsList = userInput.split(/\s+/);
			const phoneArg = argsList.find(a => /^[+\d]/.test(a) && a.replace(/\D/g, '').length >= 7);
			const nameArg = argsList
				.filter(a => a !== phoneArg)
				.join(' ')
				.trim();

			if (!phoneArg) {
				return message.send(
					`_No phone number found. Include the country code, e.g. +254...\n\nUsage: ${message.prefix}vcf <name> <number>\nIn a group with no args: exports all members as a .vcf file_`
				);
			}

			const cleanNumber = phoneArg.replace(/\D/g, '');
			const displayName = nameArg || e164(cleanNumber);

			return message.client.sendMessage(
				message.jid,
				{
					contacts: {
						displayName,
						contacts: [{ vcard: makeVcard(cleanNumber, nameArg || null) }]
					}
				},
				{ quoted: message.data }
			);
		}

		if (!isJidGroup(message.jid)) {
			return message.send(
				`_Usage: ${message.prefix}vcf <name> <number>_\n_Example: ${message.prefix}vcf John +254712345678_\n\n_In a group with no args, this exports all members as a .vcf file._`
			);
		}

		let groupMetadata;
		try {
			groupMetadata = await message.client.groupMetadata(message.jid);
		} catch (err) {
			return message.send(`_Couldn't read this group's member list: ${err?.message || err}_`);
		}

		const participants = groupMetadata.participants || [];
		if (!participants.length) return message.send('_No members found in this group._');

		const idMap = buildIdentityMap(participants);
		const vcards = [];
		let skipped = 0;

		for (const participant of participants) {
			const id = participant.id || participant.jid;
			if (!id) {
				skipped++;
				continue;
			}

			let pnJid = participant.phoneNumber || (await resolveToPn(id, message.client, idMap));
			const number = extractNumber(pnJid);

			if (!number || number.length < 7 || number.length > 15) {
				skipped++;
				continue;
			}

			vcards.push(makeVcard(number, participant.notify || null));
		}

		if (!vcards.length) {
			return message.send(
				`_Couldn't resolve any numbers.\nMembers: ${participants.length}, skipped: ${skipped} (unresolved IDs)\n\nTip: numbers resolve once a member has messaged in the group._`
			);
		}

		const groupName = (groupMetadata.subject || 'Group').replace(/[^a-zA-Z0-9 _-]/g, '').trim() || 'Group';
		const fileName = `${groupName}_contacts.vcf`;
		const buffer = Buffer.from(vcards.join('\r\n') + '\r\n', 'utf-8');
		const skippedInfo = skipped ? `\nSkipped: ${skipped} (unresolved)` : '';

		return message.send(buffer, {
			type: 'document',
			mimetype: 'text/vcard',
			fileName,
			caption: `*${groupName}*\nContacts: ${vcards.length}/${participants.length}${skippedInfo}\n\nTap the file → Import to save all numbers at once.`
		});
	}
);

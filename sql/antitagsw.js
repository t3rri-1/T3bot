import { DATABASE } from '#lib';
import { DataTypes } from 'sequelize';

const AntiTagSw = DATABASE.define(
	'AntiTagSw',
	{
		jid: {
			type: DataTypes.STRING,
			allowNull: false,
			primaryKey: true,
		},
		status: {
			type: DataTypes.BOOLEAN,
			allowNull: false,
			defaultValue: false,
		},
		warns: {
			type: DataTypes.JSON,
			allowNull: true,
			defaultValue: {},
		},
	},
	{
		tableName: 'antitagsw',
		timestamps: false,
	},
);

/**
 * Enable or disable antitagsw for a specific group
 * @param {string} jid - Group JID
 * @param {boolean} action - Enable (true) or disable (false)
 */
async function setAntiTagSwStatus(jid, action) {
	if (!jid) return;
	const [record, created] = await AntiTagSw.findOrCreate({
		where: { jid },
		defaults: { jid, status: action, warns: {} },
	});

	if (!created) {
		record.status = action;
		await record.save();
	}

	return {
		success: true,
		message: `Antitagsw ${action ? 'enabled' : 'disabled'} for group ${jid}`,
	};
}

/**
 * Check if antitagsw is enabled for a specific group
 * @param {string} jid - Group JID
 */
async function isAntiTagSwEnabled(jid) {
	if (!jid) return false;
	const record = await AntiTagSw.findOne({ where: { jid } });
	return record ? record.status : false;
}

/**
 * Add a status-tag warning for a participant in a group, returns the updated count
 * @param {string} jid - Group JID
 * @param {string} participant - Participant JID
 */
async function addTagSwWarn(jid, participant) {
	const [record] = await AntiTagSw.findOrCreate({
		where: { jid },
		defaults: { jid, status: false, warns: {} },
	});

	const warns = { ...(record.warns || {}) };
	warns[participant] = (warns[participant] || 0) + 1;
	record.warns = warns;
	await record.save();

	return { warnings: warns[participant] };
}

/**
 * Reset a participant's status-tag warnings in a group
 * @param {string} jid - Group JID
 * @param {string} participant - Participant JID
 */
async function resetTagSwWarn(jid, participant) {
	const record = await AntiTagSw.findOne({ where: { jid } });
	if (!record) return { success: true };

	const warns = { ...(record.warns || {}) };
	delete warns[participant];
	record.warns = warns;
	await record.save();
	return { success: true };
}

export { AntiTagSw, setAntiTagSwStatus, isAntiTagSwEnabled, addTagSwWarn, resetTagSwWarn };

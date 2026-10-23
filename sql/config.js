import { DataTypes } from 'sequelize';
import { DATABASE } from '#lib';

export const CONFIG_CMDS = DATABASE.define(
	'CONFIG_CMDS',
	{
		id: {
			type: DataTypes.INTEGER,
			autoIncrement: true,
			primaryKey: true,
		},
		autoRead: {
			type: DataTypes.BOOLEAN,
			allowNull: false,
			defaultValue: false,
		},
		autoStatusRead: {
			type: DataTypes.BOOLEAN,
			allowNull: false,
			defaultValue: false,
		},
		cmdReact: {
			type: DataTypes.BOOLEAN,
			allowNull: false,
			defaultValue: false,
		},
		cmdRead: {
			type: DataTypes.BOOLEAN,
			allowNull: false,
			defaultValue: false,
		},
		autoType: {
			type: DataTypes.BOOLEAN,
			allowNull: false,
			defaultValue: false,
		},
		autoRecord: {
			type: DataTypes.BOOLEAN,
			allowNull: false,
			defaultValue: false,
		},
		mode: {
			type: DataTypes.BOOLEAN,
			allowNull: false,
			defaultValue: true,
		},
		PREFIX: {
			type: DataTypes.STRING,
			allowNull: false,
			defaultValue: '.',
		},
		disabledCmds: {
			type: DataTypes.TEXT,
			allowNull: false,
			defaultValue: '',
		},
		autolikestatus: {
			type: DataTypes.BOOLEAN,
			allowNull: false,
			defaultValue: false,
		},
		statusEmoji: {
			type: DataTypes.STRING,
			allowNull: false,
			defaultValue: '💚',
		},
		fontStyle: {
			type: DataTypes.INTEGER,
			allowNull: false,
			defaultValue: 33,
		},
		disablegc: {
			type: DataTypes.BOOLEAN,
			allowNull: false,
			defaultValue: false,
		},
		disabledm: {
			type: DataTypes.BOOLEAN,
			allowNull: false,
			defaultValue: false,
		},
	},
	{
		tableName: 'configs',
		timestamps: false,
	},
);

async function ensureConfigExists() {
	const [config] = await CONFIG_CMDS.findOrCreate({
		where: { id: 1 },
		defaults: {
			autoRead: false,
			autoStatusRead: false,
			cmdReact: true,
			cmdRead: false,
			autoType: false,
			autoRecord: false,
			mode: false,
			PREFIX: '.',
			disabledCmds: '',
			autolikestatus: false,
			statusEmoji: '💚',
			fontStyle: 33,
			disablegc: false,
			disabledm: false,
		},
	});
	return config;
}

// The settings row is read several times for every incoming message (each read used to be a findOrCreate,
// i.e. a transaction on sqlite). It only changes through the functions below, so a short-lived copy that is
// dropped on every write is safe and saves most of the database work per message.
const SNAPSHOT_TTL = 5000;
let snapshot = null;
let snapshotAt = 0;
let generation = 0; // bumped by every write, so a read that started before a write cannot store old data
let loading = null;
let loadingGeneration = -1;

const dropSnapshot = () => {
	snapshot = null;
	generation++;
};

async function readConfigRow() {
	if (snapshot && Date.now() - snapshotAt < SNAPSHOT_TTL) return snapshot;
	if (loading && loadingGeneration === generation) return loading;

	const startedAt = generation;
	const request = ensureConfigExists()
		.then(row => {
			const plain = row.get({ plain: true });
			if (generation === startedAt) {
				snapshot = plain;
				snapshotAt = Date.now();
			}
			return plain;
		})
		.finally(() => {
			if (loading === request) loading = null;
		});
	loading = request;
	loadingGeneration = startedAt;
	return request;
}

const BOOLEAN_FIELDS = [
	'autoRead',
	'autoStatusRead',
	'cmdReact',
	'cmdRead',
	'autoType',
	'autoRecord',
	'mode',
	'autolikestatus',
	'disablegc',
	'disabledm',
];

async function updateConfig(field, value) {
	dropSnapshot();
	const config = await ensureConfigExists();

	if (field === 'disabledCmds' && Array.isArray(value)) {
		const currentCmds = config.disabledCmds ? config.disabledCmds.split(',') : [];
		const newCmds = [...new Set([...currentCmds, ...value])];
		await config.update({ [field]: newCmds.join(',') });
	} else {
		const updatedValue = BOOLEAN_FIELDS.includes(field) ? !!value : value;
		await config.update({ [field]: updatedValue });
	}

	dropSnapshot();
	return config;
}

async function getConfig() {
	const config = await readConfigRow();
	return {
		autoRead: config.autoRead,
		autoStatusRead: config.autoStatusRead,
		cmdReact: config.cmdReact,
		cmdRead: config.cmdRead,
		autoType: config.autoType,
		autoRecord: config.autoRecord,
		mode: config.mode,
		PREFIX: config.PREFIX,
		disabledCmds: config.disabledCmds ? config.disabledCmds.split(',').filter(Boolean) : [],
		autolikestatus: config.autolikestatus,
		statusEmoji: config.statusEmoji,
		fontStyle: config.fontStyle,
		disablegc: config.disablegc,
		disabledm: config.disabledm,
	};
}

async function addDisabledCmd(cmd) {
	dropSnapshot();
	const config = await ensureConfigExists();
	const currentCmds = config.disabledCmds ? config.disabledCmds.split(',').filter(Boolean) : [];

	if (currentCmds.includes(cmd)) {
		return { success: false, message: '_Command already disabled._' };
	}

	currentCmds.push(cmd);
	await config.update({ disabledCmds: currentCmds.join(',') });
	dropSnapshot();
	return { success: true, message: `_${cmd} command disabled_` };
}

async function removeDisabledCmd(cmd) {
	dropSnapshot();
	const config = await ensureConfigExists();
	const currentCmds = config.disabledCmds ? config.disabledCmds.split(',').filter(Boolean) : [];

	if (!currentCmds.includes(cmd)) {
		return { success: false, message: '_Command is not disabled._' };
	}

	const updatedCmds = currentCmds.filter(disabledCmd => disabledCmd !== cmd);
	await config.update({ disabledCmds: updatedCmds.join(',') });
	dropSnapshot();
	return { success: true, message: `_${cmd} command enabled_` };
}

async function isCmdDisabled(cmd) {
	const config = await readConfigRow();
	const currentCmds = config.disabledCmds ? config.disabledCmds.split(',').filter(Boolean) : [];
	return currentCmds.includes(cmd);
}

export { updateConfig, getConfig, addDisabledCmd, removeDisabledCmd, isCmdDisabled };

import { DataTypes } from 'sequelize';
import { DATABASE } from '#lib';

/**
 * Chatbot switches: on/off overall, and separately for groups (gc) and private chats (dm).
 * A table of its own, so an existing database needs no migration: sync() creates it.
 */
export const ChatbotSettings = DATABASE.define(
	'ChatbotSettings',
	{
		id: {
			type: DataTypes.INTEGER,
			autoIncrement: true,
			primaryKey: true,
		},
		enabled: {
			type: DataTypes.BOOLEAN,
			allowNull: false,
			defaultValue: false,
		},
		gc: {
			type: DataTypes.BOOLEAN,
			allowNull: false,
			defaultValue: true,
		},
		dm: {
			type: DataTypes.BOOLEAN,
			allowNull: false,
			defaultValue: true,
		},
	},
	{
		tableName: 'chatbot_settings',
		timestamps: false,
	},
);

const FIELDS = ['enabled', 'gc', 'dm'];
const OFF = Object.freeze({ enabled: false, gc: true, dm: true });

// Read for every incoming message, so it is kept for a few seconds. Writes update it straight away.
const TTL = 5000;
let cached = null;
let cachedAt = 0;

const plain = row => Object.freeze({ enabled: !!row.enabled, gc: !!row.gc, dm: !!row.dm });

/** { enabled, gc, dm }. Never throws: if the table is unreadable the chatbot simply stays off. */
async function getChatbot() {
	if (cached && Date.now() - cachedAt < TTL) return cached;
	try {
		const [row] = await ChatbotSettings.findOrCreate({ where: { id: 1 }, defaults: {} });
		cached = plain(row);
		cachedAt = Date.now();
	} catch {
		cached ??= OFF;
	}
	return cached;
}

/** field: 'enabled' | 'gc' | 'dm' */
async function setChatbot(field, value) {
	if (!FIELDS.includes(field)) throw new Error(`Unknown chatbot setting: ${field}`);
	const [row] = await ChatbotSettings.findOrCreate({ where: { id: 1 }, defaults: { [field]: !!value } });
	if (!!row[field] !== !!value) await row.update({ [field]: !!value });
	cached = plain(row);
	cachedAt = Date.now();
	return cached;
}

export { getChatbot, setChatbot };

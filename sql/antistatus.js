import { DataTypes } from 'sequelize';
import { DATABASE } from '#lib';

// A table of its own (one row), so a bot that already has a database picks it up without any change to the others.
export const AntiStatusDB = DATABASE.define(
	'AntiStatus',
	{
		id: {
			type: DataTypes.INTEGER,
			autoIncrement: true,
			primaryKey: true
		},
		enabled: {
			type: DataTypes.BOOLEAN,
			allowNull: false,
			defaultValue: false
		}
	},
	{
		tableName: 'antistatus',
		timestamps: false
	}
);

const TTL = 5000;
let cached = null;
let cachedAt = 0;

/** true while deleted statuses are sent to the bot's inbox (the antistatus command). Off by default; never throws. */
async function getAntiStatus() {
	if (cached !== null && Date.now() - cachedAt < TTL) return cached;
	try {
		const [row] = await AntiStatusDB.findOrCreate({ where: { id: 1 }, defaults: { enabled: false } });
		cached = !!row.enabled;
		cachedAt = Date.now();
	} catch {
		cached ??= false;
	}
	return cached;
}

async function setAntiStatus(enabled) {
	const value = !!enabled;
	const [row] = await AntiStatusDB.findOrCreate({ where: { id: 1 }, defaults: { enabled: value } });
	if (!!row.enabled !== value) await row.update({ enabled: value });
	cached = value;
	cachedAt = Date.now();
	return value;
}

export { getAntiStatus, setAntiStatus };

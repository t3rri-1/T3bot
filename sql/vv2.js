import { DataTypes } from 'sequelize';
import { DATABASE } from '#lib';

// A table of its own (one row), so a bot that already has a database picks it up without any change to the others.
export const ViewOnceInbox = DATABASE.define(
	'ViewOnceInbox',
	{
		id: {
			type: DataTypes.INTEGER,
			autoIncrement: true,
			primaryKey: true
		},
		enabled: {
			type: DataTypes.BOOLEAN,
			allowNull: false,
			defaultValue: true
		}
	},
	{
		tableName: 'viewonce_inbox',
		timestamps: false
	}
);

const TTL = 5000;
let cached = null;
let cachedAt = 0;

/**
 * true while reacting to a view-once message sends it to the reactor's inbox (the vv2 command switches it).
 * On by default. Never throws: if the table is unreadable the last known value is used, on when there is none.
 */
async function getVv2() {
	if (cached !== null && Date.now() - cachedAt < TTL) return cached;
	try {
		const [row] = await ViewOnceInbox.findOrCreate({ where: { id: 1 }, defaults: { enabled: true } });
		cached = !!row.enabled;
		cachedAt = Date.now();
	} catch {
		cached ??= true;
	}
	return cached;
}

async function setVv2(enabled) {
	const value = !!enabled;
	const [row] = await ViewOnceInbox.findOrCreate({ where: { id: 1 }, defaults: { enabled: value } });
	if (!!row.enabled !== value) await row.update({ enabled: value });
	cached = value;
	cachedAt = Date.now();
	return value;
}

export { getVv2, setVv2 };

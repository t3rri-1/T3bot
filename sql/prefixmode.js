import { DataTypes } from 'sequelize';
import { DATABASE } from '#lib';

export const PrefixMode = DATABASE.define(
	'PrefixMode',
	{
		id: {
			type: DataTypes.INTEGER,
			autoIncrement: true,
			primaryKey: true,
		},
		noPrefix: {
			type: DataTypes.BOOLEAN,
			allowNull: false,
			defaultValue: false,
		},
	},
	{
		tableName: 'prefix_mode',
		timestamps: false,
	},
);

const TTL = 5000;
let cached = null;
let cachedAt = 0;

/** true when commands may be sent without a prefix. Never throws: if the table is unreadable the prefix stays required. */
async function getNoPrefix() {
	if (cached !== null && Date.now() - cachedAt < TTL) return cached;
	try {
		const [row] = await PrefixMode.findOrCreate({ where: { id: 1 }, defaults: { noPrefix: false } });
		cached = !!row.noPrefix;
		cachedAt = Date.now();
	} catch {
		cached ??= false;
	}
	return cached;
}

async function setNoPrefix(noPrefix) {
	const value = !!noPrefix;
	const [row] = await PrefixMode.findOrCreate({ where: { id: 1 }, defaults: { noPrefix: value } });
	if (!!row.noPrefix !== value) await row.update({ noPrefix: value });
	cached = value;
	cachedAt = Date.now();
	return value;
}

export { getNoPrefix, setNoPrefix };

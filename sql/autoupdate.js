import { DataTypes } from 'sequelize';
import { DATABASE } from '#lib';

export const AutoUpdate = DATABASE.define(
	'AutoUpdate',
	{
		id: {
			type: DataTypes.INTEGER,
			autoIncrement: true,
			primaryKey: true,
		},
		mode: {
			type: DataTypes.STRING, // on = install automatically, notify = only tell the owner, off = never check
			allowNull: false,
			defaultValue: 'notify',
		},
	},
	{
		tableName: 'autoupdate',
		timestamps: false,
	},
);

async function getAutoUpdateMode() {
	const [row] = await AutoUpdate.findOrCreate({ where: { id: 1 }, defaults: { mode: 'notify' } });
	return row.mode;
}

async function setAutoUpdateMode(mode) {
	const [row] = await AutoUpdate.findOrCreate({ where: { id: 1 }, defaults: { mode } });
	if (row.mode !== mode) await row.update({ mode });
	return mode;
}

export { getAutoUpdateMode, setAutoUpdateMode };

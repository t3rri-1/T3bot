import { DataTypes } from 'sequelize';
import { config } from '#config';
import { runtime } from '#utils';
import { DATABASE } from '#lib';

const AliveDB = DATABASE.define(
	'AliveDB',
	{
		id: {
			type: DataTypes.INTEGER,
			primaryKey: true,
			autoIncrement: true,
		},
		message: {
			type: DataTypes.STRING,
			allowNull: false,
		},
	},
	{
		tableName: 'alive',
		timestamps: false,
	},
);

/**
 * Retrieves the alive message from the database or returns a default message.
 * @async
 * @function getAliveMsg
 * @returns {Promise<string>} The alive message. If no message is found in the database,
 * returns a default message including the bot info.
 */
const getAliveMsg = async () => {
	const msg = await AliveDB.findOne();
	return msg?.message || `@user T3rri multi device is alive and a simple WhatsApp bot made with Node.js\n\n*Runtime: &runtime*`;
};

const setAliveMsg = async text => {
	await AliveDB.destroy({ where: {} });
	await AliveDB.create({ message: text });
	return true;
};

const aliveMessage = async message => {
	const msg = await getAliveMsg();

	return msg
		.replace(/&runtime/g, runtime(process.uptime()))
		.replace(/&user/g, message.pushName || 'user')
		.replace(/@user/g, `@${message.sender.split('@')[0]}`)
		.replace(/&owner/g, config.BOT_INFO.split(';')[0])
		.replace(/&botname/g, config.BOT_INFO.split(';')[1]);
};

export { AliveDB, getAliveMsg, setAliveMsg, aliveMessage };

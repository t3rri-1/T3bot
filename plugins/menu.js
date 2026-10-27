import { config } from '#config';
import { bot, Button, commands, getConfigValues } from '#lib';
import { getConfig } from '#sql';
import { formatBytes, runtime } from '#utils';
import { applyFont } from '../bot/fontlist.js';
import { platform, totalmem, freemem } from 'os';

const more = String.fromCharCode(8206);
const readmore = more.repeat(4001);
const REPO = 'https://github.com/t3rri-1/T3bot';
const CHANNEL = 'https://whatsapp.com/channel/0029Vb57ZHh7IUYcNttXEB3y';

bot(
	{
		pattern: 'menu',
		public: true,
		desc: 'Show All Commands',
		dontAddCommandList: true
	},
	async message => {
		const { mode, PREFIX } = await getConfigValues();
		const cmds = commands.filter(
			cmd => cmd.pattern && !cmd.dontAddCommandList && !cmd.pattern.toString().includes('undefined')
		).length;
		let menuInfo = `\`\`\`╭──${config.BOT_INFO.split(';')[1]} ────
┃々│ Owner: ${config.BOT_INFO.split(';')[0]}		
┃々│ Prefix: ${PREFIX}
┃々│ Plugins: ${cmds}
┃々│ Mode: ${mode ? 'private' : 'public'}
┃々│ Uptime: ${runtime(process.uptime())}
┃々│ Platform: ${platform()}
┃々│ Memory: ${formatBytes(totalmem() - freemem())}
┃々│ Day: ${new Date().toLocaleDateString('en-US', { weekday: 'long' })}
┃々│ Date: ${new Date().toLocaleDateString('en-US')}
┃々│ Time: ${new Date().toLocaleTimeString('en-US', {
			timeZone: config.TIME_ZONE
		})}
┃々│ Version: ${config.VERSION}
╰───────────\`\`\`\n${readmore}`;

		const commandsByType = commands
			.filter(cmd => cmd.pattern && !cmd.dontAddCommandList)
			.reduce((acc, cmd) => {
				const type = cmd.type || 'Misc';
				if (!acc[type]) {
					acc[type] = [];
				}
				acc[type].push(cmd.pattern.toString().toUpperCase().split(/\W+/)[1]);
				return acc;
			}, {});

		const sortedTypes = Object.keys(commandsByType).sort();

		let totalCommands = 1;

		sortedTypes.forEach(type => {
			const sortedCommands = commandsByType[type].sort();
			menuInfo += `╭──❏ ${type.toUpperCase()}❏\n`;
			sortedCommands.forEach(cmd => {
				menuInfo += `│${totalCommands}· ${cmd}\n`;
				totalCommands++;
			});
			menuInfo += `╰─────────\n`;
		});
		let fontStyle = 1;
		try {
			({ fontStyle } = await getConfig());
		} catch {
			
		}
		const body = fontStyle && fontStyle !== 1 ? applyFont(menuInfo, fontStyle) : menuInfo;

		try {
			return await new Button(message.client)
				.setBody(body)
				.addUrl('🌐 Repo', REPO)
				.addUrl('📢 Channel', CHANNEL)
				.send(message.jid);
		} catch {
	
			return await message.send(`${menuInfo}\n\n🌐 Repo: ${REPO}\n📢 Channel: ${CHANNEL}`);
		}
	}
);

bot(
	{
		pattern: 'list',
		public: true,
		desc: 'Show All Commands',
		dontAddCommandList: true
	},
	async message => {
		let cmdsList = 'Command List\n\n';
		let cmdList = [];
		let cmd, desc;
		commands.map(command => {
			if (command.pattern) cmd = command.pattern.toString().split(/\W+/)[1];
			desc = command.desc || false;
			if (!command.dontAddCommandList && cmd !== undefined) cmdList.push({ cmd, desc });
		});
		cmdList.sort((a, b) => a.cmd.localeCompare(b.cmd));
		cmdList.forEach(({ cmd, desc }, num) => {
			cmdsList += `${(num += 1)} ${cmd.toUpperCase()}\n`;
			if (desc) cmdsList += `${desc}\n\n`;
		});

		return await message.send(`\`\`\`${cmdsList}\`\`\``);
	}
);

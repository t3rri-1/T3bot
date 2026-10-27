import { performance } from 'perf_hooks';
import { randomBytes } from 'crypto';
import { bot } from '#lib';
import { manageProcess, runtime } from '#utils';
import { getBuffer, getJson } from '#utils';
import os from 'os';

function formatRuntime(seconds) {
	seconds = Number(seconds);
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = Math.floor(seconds % 60);
	
	return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

bot(
	{
		pattern: 'ping',
		public: true,
		desc: 'Get Performance',
		type: 'system',
	},
	async message => {
		const start = performance.now();
		const msg = await message.send('Testing Speed...');
		const end = performance.now();
		await msg.edit(`\`\`\`SPEED\n ${(end - start).toFixed(2)}MS\`\`\``);
	},
);

bot(
	{
		pattern: 'runtime',
		public: true,
		desc: 'Get Runtime of bot',
		type: 'system',
	},
	async message => {
		const uptimeSeconds = process.uptime();
		const time = formatRuntime(uptimeSeconds);
		const customId = () => 'A5' + randomBytes(15).toString('hex').toUpperCase();

		await message.client.relayMessage(
			message.jid,
			{
				interactiveResponseMessage: {
					body: {
						text: '\0',
						format: 1
					},
					nativeFlowResponseMessage: {
						name: 'galaxy_message',
						paramsJson: JSON.stringify({
							wa_flow_response_params: {
								title: `⌛ ${time}`
							}
						}),
						version: 3
					}
				}
			},
			{ quoted: message.key, messageId: customId() }
		);
	},
);

bot(
	{
		pattern: 'restart',
		public: false,
		desc: 'Restarts Bot',
		type: 'system',
	},
	async message => {
		await message.send('```Restarting bot```');
		manageProcess('restart');
	},
);

bot(
	{
		pattern: 'shutdown',
		public: false,
		desc: 'Off Bot',
		type: 'system',
	},
	async message => {
		await message.send('```Shutting down bot```');
		manageProcess('stop');
	},
);

bot(
	{
		pattern: 'logout',
		public: false,
		desc: 'End your T3rri Session',
		type: 'system',
	},
	async (message, match) => {
		if (!match) return message.send(`*Hello ${message.pushName} this isn't the goo, goo ga ga, this command will logout you out of your T3rri Session, and you will be unable to use this bot until you get a new session*\nAre you sure you want to continue with this decision, then type\n${message.prefix}logout confirm`);
		if (match === 'confirm') {
			message.send('_logging out_');
			await message.client.logout();
		} else {
			message.send('_that not right hmm_');
		}
	},
);


bot(
	{
		pattern: 'cpu',
		public: false,
		desc: 'Get CPU Information',
		type: 'system',
	},
	async message => {
		const cpus = os.cpus();
		const coreCount = cpus.length;
		const model = cpus[0].model
			.replace(/\s+\(.*\)/g, '')
			.replace(/CPU|Processor/gi, '')
			.trim();

		const averageSpeed = Math.round(cpus.reduce((sum, cpu) => sum + cpu.speed, 0) / coreCount);

		const response = `CPU Information:\nModel: ${model}\nCores: ${coreCount}\nAverage Speed: ${averageSpeed} MHz\nArchitecture: ${os.arch()}\nPlatform: ${os.platform()}\nUptime: ${Math.floor(os.uptime() / 60)} minutes`;

		await message.send('```' + response + '```');
	},
);

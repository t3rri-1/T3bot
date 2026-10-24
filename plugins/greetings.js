import { bot } from '#lib';
import { addWelcome, delWelcome, isWelcomeOn, addGoodbye, delGoodBye, isGoodByeOn } from '#sql';
import { delay } from 'baileys';

bot(
	{
		pattern: 'welcome',
		public: false,
		isGroup: true,
		desc: 'SetUp Welcome Messages For Group',
		type: 'group'
	},
	async (message, match, { prefix, pushName }) => {
		if (!match) {
			return message.send(
				`Welcome Messages Setup\n\n_${prefix}welcome on_\nTurn on welcome messages\n\n_${prefix}welcome "your message here"_\nSetup custom welcome messages\n\n_${prefix}welcome off_\nDisables welcome message in this group\n\n*Visit wiki to learn how to customize your welcome message:*\n\n_https://github.com/AstroX11/Xstro/wiki/Welcome-&&-Goodbye-Messages_`
			);
		}
		if (match === 'on'.toLowerCase()) {
			if (await isWelcomeOn(message.jid))
				return message.send(`\`\`\`Welcome Already Enabled\`\`\``);
			await addWelcome(message.jid, true, null);
			return message.send(`\`\`\`Welcome enabled, use ${prefix}welcome, to customize it\`\`\``);
		}
		if (match === 'off') {
			if (!(await isWelcomeOn(message.jid)))
				return message.send(`\`\`\`Welcome Already Disabled\`\`\``);
			await delWelcome(message.jid);
			return message.send(`\`\`\`Welcome Disabled\`\`\``);
		}
		if (match !== 'off' && match !== 'on') {
			await addWelcome(message.jid, true, match);
			return message.send(`\`\`\`Custome Welcome Message Set\`\`\``);
		}
		return message.send(`\`\`\`Use ${prefix}welcome to see usage\`\`\``);
	}
);

bot(
	{
		pattern: 'goodbye',
		public: false,
		isGroup: true,
		desc: 'SetUp Goodbye Messages For Group',
		type: 'group'
	},
	async (message, match, { prefix, pushName }) => {
		if (!match) {
			return message.send(
				`Goodbye Messages Setup\n\n_${prefix}goodbye on_\nTurn on goodbye messages\n\n_${prefix}goodbye "your message here"_\nSetup custom goodbye messages\n\n_${prefix}goodbye off_\nDisables goodbye message in this group\n\n*Visit wiki to learn how to customize your goodbye message:*\n\n_https://github.com/AstroX11/Xstro/wiki/Welcome-&&-Goodbye-Messages_`
			);
		}
		if (match === 'on') {
			if (await isGoodByeOn(message.jid))
				return message.send(`_Goodbye Already on for this Group_`);
			await addGoodbye(message.jid, true, null);
			return message.send(
				'_Goodbye Messages Enabled, use ' + prefix + 'goodbye your message, to customize it_'
			);
		}
		if (match === 'off') {
			if (!(await isGoodByeOn(message.jid)))
				return message.send(`_Goodbye Already Disabled for this Group_`);
			await delGoodBye(message.jid);
			return message.send(`_Goodbye Messages Disabled for this Group_`);
		}
		if (match !== 'off' && match !== 'on') {
			await message.send(
				`NOTE: _If your text is very long, setup your long goodbye message, and reply it to set as custom goodbye message_`
			);
			await delay(2000);
			await addGoodbye(message.jid, true, match);
			return message.send(`_Custom GoodBye Message Set_`);
		}
		return message.send(
			`\`\`\`${pushName} that's not right, use ${prefix}goodbye to see command usage\`\`\``
		);
	}
);

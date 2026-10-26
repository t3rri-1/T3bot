import { bot } from '#lib';
import {
	checkForUpdate,
	installUpdate,
	rollbackUpdate,
	restartBot,
	updateStatus,
	updateFoundText,
	describeResult
} from '#bot';
import { getAutoUpdateMode, setAutoUpdateMode } from '#sql';

bot(
	{
		pattern: 'update',
		public: false,
		desc: 'Update the bot',
		type: 'system'
	},
	async (message, match) => {
		const prefix = message.prefix;
		const arg = (match || '').trim().toLowerCase();

		try {
			if (arg === 'rollback') {
				const res = await rollbackUpdate();
				if (res.status === 'busy') return await message.send(describeResult(res));
				if (res.status === 'none') return await message.send('```Nothing to roll back to```');
				await message.send(`*Rolled back* \`\`\`${res.from.slice(0, 7)} -> ${res.to.slice(0, 7)}\`\`\`\n*Restarting...*`);
				return await restartBot();
			}

			const info = await checkForUpdate();

			if (!arg) {
				if (!info.available) return await message.send('```No update available```');
				return await message.send(
					updateFoundText(info, prefix) +
					(info.bad ? '\n\n_This version already failed to install here, auto-update skips it_' : '')
				);
			}

			if (arg === 'now') {
				if (!info.available) return await message.send('```No changes in the latest commit```');
				await message.send('*Updating...*');
				const res = await installUpdate({ info, force: true });
				await message.send(describeResult(res, prefix));
				if (res.status === 'updated') await restartBot();
				return;
			}

			return await message.send(`_Use ${prefix}update, ${prefix}update now or ${prefix}update rollback_`);
		} catch (err) {
			return await message.send('```' + err.message + '```');
		}
	}
);

const ago = time => {
	if (!time) return 'never';
	const minutes = Math.max(0, Math.round((Date.now() - time) / 60000));
	return minutes < 1 ? 'just now' : minutes < 120 ? `${minutes} min ago` : `${Math.round(minutes / 60)} h ago`;
};

bot(
	{
		pattern: 'autoupdate',
		public: false,
		desc: 'Automatic updates: on, notify or off',
		type: 'system'
	},
	async (message, match) => {
		const prefix = message.prefix;
		const arg = (match || '').trim().toLowerCase();

		if (['on', 'notify', 'off'].includes(arg)) {
			await setAutoUpdateMode(arg);
			const said = {
				on: 'Auto-update is on, new commits install themselves',
				notify: 'Auto-update will only tell you when an update is available',
				off: 'Auto-update is off'
			};
			return await message.send(`_${said[arg]}_`);
		}
		if (arg) return await message.send(`_Use ${prefix}autoupdate on, notify or off_`);

		const [mode, status] = await Promise.all([getAutoUpdateMode(), updateStatus()]);
		if (!status.supported) {
			return await message.send(
				`*AutoUpdate*\nMode: \`\`\`${mode}\`\`\`\n\`\`\`Unavailable: ${status.error}\`\`\`\n\n` +
					`_It needs git and a reachable repository. Set UPDATE_REPO (owner/repo or a URL) if package.json has none._`
			);
		}
		return await message.send(
			`*AutoUpdate*\n` +
				`Mode: \`\`\`${mode}\`\`\`\n` +
				`Version: \`\`\`v${status.version} (${status.current.slice(0, 7)})\`\`\`\n` +
				`Source: \`\`\`${status.remote} (${status.branch})\`\`\`\n` +
				`Checks: \`\`\`every ${status.everyMinutes} min, last ${ago(status.lastCheck)}\`\`\`\n` +
				(status.dirty ? `Local edits: \`\`\`${status.dirty} file(s) differ from that commit\`\`\`\n` : '') +
				`\n` +
				`_${prefix}autoupdate on | notify | off_\n` +
				`_${prefix}update rollback undoes the last update_`
		);
	}
);

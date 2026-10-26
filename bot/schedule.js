import { config } from '#config';
import { schedule } from '#sql';

const getCurrentTime = () => {
	const timezone = config.TIME_ZONE;
	try {
		const formatter = new Intl.DateTimeFormat('en-US', {
			timeZone: timezone,
			hour: '2-digit',
			minute: '2-digit',
			hourCycle: 'h23',
		});
		const parts = formatter.formatToParts(new Date());
		const hour = parts.find(part => part.type === 'hour').value;
		const minute = parts.find(part => part.type === 'minute').value;
		return `${hour}:${minute}`;
	} catch (error) {
		throw new Error(`Invalid timezone: ${timezone}. Error: ${error.message}`);
	}
};

// schedules() is called for every group message. It used to start a new 60 s timer each time, so a busy
// bot piled up thousands of timers all hitting the database. One timer is enough, it always uses the
// connection of the latest message (so it follows reconnects).
let timer = null;
let client = null;

const tick = async () => {
	try {
		const currentTime = getCurrentTime();

		const schedules = await schedule.findAll({
			where: { isScheduled: true },
		});

		for (const schedule of schedules) {
			if (schedule.muteTime === currentTime && !schedule.isMuted) {
				await client.groupSettingUpdate(schedule.groupId, 'announcement');
				schedule.isMuted = true;
				await schedule.save();
				await client.sendMessage(schedule.groupId, { text: '```Group has been muted, due to AutoMute```' });
			}
			if (schedule.unmuteTime === currentTime && schedule.isMuted) {
				await client.groupSettingUpdate(schedule.groupId, 'not_announcement');
				schedule.isMuted = false;
				await schedule.save();
				await client.sendMessage(schedule.groupId, { text: '```Group is now unmuted, due to AutoUnMute```' });
			}
		}
	} catch {
		// one failed round (bad timezone, group gone, rate limit) must not stop the next one
	}
};

export const schedules = async msg => {
	client = msg.client;
	if (timer) return;
	timer = setInterval(tick, 60000);
	timer.unref?.();
};

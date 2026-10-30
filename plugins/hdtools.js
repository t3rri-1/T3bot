import { bot } from '#lib';
import { getBuffer, hdVideo, hdVideo2, imglargerEnhance, upscaler, videy, winkEnhance } from '#utils';

const prefixOf = message => Array.from(message.prefix || '.')[0] || '.';

const clip = (text, max) => {
	const clean = String(text ?? '')
		.replace(/\s+/g, ' ')
		.trim();
	return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
};

// A service that is down, or a file it cannot take, is not a bug: say so instead of sending an error report to the owner.
const attempt = async (message, work) => {
	try {
		return await work();
	} catch (err) {
		if (err?.tooLarge) return message.send('_That file is too large to send from this host_');
		console.log('[hdtools]', err?.message || err);
		return message.send(`_${clip(err?.message || 'Something went wrong, try again', 200)}_`);
	}
};

/* ───────────────────────────── photos ───────────────────────────── */

const photo = (pattern, desc, run) =>
	bot({ pattern, public: true, desc, type: 'tools' }, async message =>
		attempt(message, async () => {
			if (!message.reply_message?.image) return message.send(`_Reply to a photo with ${prefixOf(message)}${pattern}_`);
			const status = await message.send('_Enhancing the photo..._');
			const url = await run(await message.download());
			if (!url) return status.edit('_The service finished without giving a picture_');
			await message.send(await getBuffer(url), { type: 'image', caption: '_Done_' });
			return status.delete().catch(() => {});
		})
	);

photo('hd', 'Make a photo sharper and 2x bigger (reply to the photo)', async image => (await imglargerEnhance(image)).url);
photo('upscale', 'Upscale a photo with AI (reply to the photo)', async image => {
	const res = await upscaler(image);
	if (res.status === 'error') throw new Error(res.msg);
	return res.output;
});

/* ───────────────────────────── videos ───────────────────────────── */

// A video is held in memory several times over while it is sent and fetched back, so one job at a time
let videoJob = false;

const video = (pattern, desc, run) =>
	bot({ pattern, public: true, desc, type: 'tools' }, async message =>
		attempt(message, async () => {
			if (!message.reply_message?.video) return message.send(`_Reply to a video with ${prefixOf(message)}${pattern}_`);
			if (videoJob) return message.send('_Another video is being enhanced, try again when it is done_');
			videoJob = true;
			try {
				const status = await message.send('_Enhancing the video, this can take a few minutes..._');
				const { resultUrl } = await run(await message.download());
				if (!resultUrl) return status.edit('_The service finished without giving a video_');
				await message.send(await getBuffer(resultUrl), { type: 'video', mimetype: 'video/mp4', caption: '_Done_' });
				return status.delete().catch(() => {});
			} finally {
				videoJob = false;
			}
		})
	);

video('hdvid', 'Make a video sharper (reply to the video)', hdVideo);
video('hdvid2', 'Upscale a video to 2K (reply to the video)', hdVideo2);
video('winkhd', 'Make a video sharper with Wink Ultra HD (reply to the video)', winkEnhance);

bot(
	{ pattern: 'videy', public: true, desc: 'Upload a video to videy.co and get a link (reply to the video)', type: 'tools' },
	async message =>
		attempt(message, async () => {
			if (!message.reply_message?.video) return message.send(`_Reply to a video with ${prefixOf(message)}videy_`);
			const status = await message.send('_Uploading..._');
			const res = await videy(await message.download());
			if (res.status === 'error') return status.edit(`_${clip(res.msg, 160)}_`);
			if (!res.id) {
				// the service answered in a shape that has no id: show what it said
				return status.edit(`*videy.co answered:*\n\`\`\`${clip(JSON.stringify(res.output), 500)}\`\`\``);
			}
			return status.edit(`*Uploaded to videy.co*\n\n🔗 ${res.page}\n🎞️ ${res.direct}`);
		})
);

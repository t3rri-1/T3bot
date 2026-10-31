import dotenv from 'dotenv';
dotenv.config();

const config = {
	
	SESSION_ID: process.env.SESSION_ID || 'T3RRI_77_83_04',
	SUDO: process.env.SUDO || '50955112990',
	API_ID: process.env.API_ID || 'https://xstro-api-4fb28ece11a9.herokuapp.com',
	BOT_INFO: process.env.BOT_INFO || 'T3rri;T3rri Bot',
	STICKER_PACK: process.env.STICKER_PACK || 'Made by;TMulti Device Bot',
	WARN_COUNT: process.env.WARN_COUNT || 3,
	TIME_ZONE: process.env.TIME_ZONE || 'Africa/Kampala',
	CHANNEL_JID: process.env.CHANNEL_JID || '',
	DEBUG: process.env.DEBUG || false
};

export { config };
export default { config };

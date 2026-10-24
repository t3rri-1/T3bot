
let loaded = null;

export const getSharp = async () => {
	if (!loaded) {
		loaded = import('sharp').then(mod => {
			const sharp = mod.default ?? mod;
			sharp.cache(false); // do not keep decoded images around
			sharp.concurrency(1); // one libvips thread, the host only gives us a slice of one CPU
			return sharp;
		});
		loaded.catch(() => {
			loaded = null; // allow a retry if the first load failed
		});
	}
	return loaded;
};

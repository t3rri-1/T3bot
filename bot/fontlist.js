import { font } from './font.js';

// 1-based list (index 0 is unused) so FONT_LIST[id] maps directly to a style.
// id 1 is always "Normal" (no transform). id 33 is the bot-wide default.
export const FONT_LIST = [
	null,
	{ name: 'Normal', fn: text => text }, // 1
	{ name: 'Small Caps', fn: font.tiny }, // 2
	{ name: 'Bold Serif', fn: font.serif_B }, // 3
	{ name: 'Bold Italic Serif', fn: font.serif_BI }, // 4
	{ name: 'Italic Serif', fn: font.serif_I }, // 5
	{ name: 'Typewriter', fn: font.typewriter }, // 6
	{ name: 'Analucia', fn: font.analucia }, // 7
	{ name: 'Manga', fn: font.manga }, // 8
	{ name: 'Ladybug', fn: font.ladybug }, // 9
	{ name: 'Runes', fn: font.runes }, // 10
	{ name: 'Wingdings', fn: font.wingdings }, // 11
	{ name: 'Vaporwave', fn: font.vaporwave }, // 12
	{ name: 'Sparrow', fn: font.sparrow }, // 13
	{ name: 'Strikethrough', fn: font.strikeThrough }, // 14
	{ name: 'Tilde Strikethrough', fn: font.tildeStrikeThrough }, // 15
	{ name: 'Underline', fn: font.underline }, // 16
	{ name: 'Double Underline', fn: font.doubleUnderline }, // 17
	{ name: 'Slash Through', fn: font.slashThrough }, // 18
	{ name: 'Hearts Between', fn: font.heartsBetween }, // 19
	{ name: 'Arrow Below', fn: font.arrowBelow }, // 20
	{ name: 'Cross Above/Below', fn: font.crossAboveBelow }, // 21
	{ name: 'Fancy 1', fn: font.fancy1 }, // 22
	{ name: 'Fancy 2', fn: font.fancy2 }, // 23
	{ name: 'Fancy 3', fn: font.fancy3 }, // 24
	{ name: 'Fancy 4', fn: font.fancy4 }, // 25
	{ name: 'Fancy 5', fn: font.fancy5 }, // 26
	{ name: 'Fancy 6', fn: font.fancy6 }, // 27
	{ name: 'Fancy 7', fn: font.fancy7 }, // 28
	{ name: 'Fancy 8', fn: font.fancy8 }, // 29
	{ name: 'Fancy 9', fn: font.fancy9 }, // 30
	{ name: 'Fancy 10', fn: font.fancy10 }, // 31
	{ name: 'Fancy 11', fn: font.fancy11 }, // 32
	{ name: 'Fancy 12 (default)', fn: font.fancy12 }, // 33
	{ name: 'Fancy 13', fn: font.fancy13 }, // 34
	{ name: 'Fancy 14', fn: font.fancy14 }, // 35
	{ name: 'Fancy 15', fn: font.fancy15 }, // 36
	{ name: 'Fancy 16', fn: font.fancy16 }, // 37
	{ name: 'Fancy 17', fn: font.fancy17 }, // 38
	{ name: 'Fancy 18', fn: font.fancy18 }, // 39
	{ name: 'Fancy 19', fn: font.fancy19 }, // 40
	{ name: 'Fancy 20', fn: font.fancy20 }, // 41
	{ name: 'Fancy 21', fn: font.fancy21 }, // 42
	{ name: 'Fancy 22', fn: font.fancy22 }, // 43
	{ name: 'Fancy 23', fn: font.fancy23 }, // 44
	{ name: 'Fancy 24', fn: font.fancy24 }, // 45
	{ name: 'Fancy 25', fn: font.fancy25 }, // 46
	{ name: 'Fancy 26', fn: font.fancy26 }, // 47
	{ name: 'Fancy 27', fn: font.fancy27 }, // 48
	{ name: 'Fancy 28', fn: font.fancy28 }, // 49
	{ name: 'Fancy 29', fn: font.fancy29 }, // 50
	{ name: 'Fancy 30', fn: font.fancy30 }, // 51
	{ name: 'Fancy 31', fn: font.fancy31 }, // 52
	{ name: 'Fancy 32', fn: font.fancy32 }, // 53
	{ name: 'Fancy 33', fn: font.fancy33 } // 54
];

export const DEFAULT_FONT_ID = 33;

// Parts of a message that must reach WhatsApp exactly as written. Restyling them breaks them:
//   @254712345678                      mention tags only resolve while the digits stay plain
//   254712345678@s.whatsapp.net, @g.us JIDs
//   https://..., www..., wa.me/...     links stop being clickable
//   name@mail.com                      e-mail addresses
//   * _ ~ `                            WhatsApp's bold / italic / strike / monospace markers
//                                      (some fonts turn them into other symbols, which kills the formatting)
const KEEP_PLAIN = new RegExp(
	[
		String.raw`(?:https?:\/\/|www\.|wa\.me\/|chat\.whatsapp\.com\/)\S+`,
		String.raw`\d[\d:.-]*@(?:s\.whatsapp\.net|g\.us|c\.us|lid|newsletter|broadcast)\b|status@broadcast\b`,
		String.raw`[\w.+-]+@[\w-]+(?:\.[\w-]+)+`,
		String.raw`@\d+`,
		String.raw`[*_~\x60]`
	].join('|'),
	'gi'
);

function styleAround(text, fn) {
	let out = '';
	let last = 0;
	for (const match of text.matchAll(KEEP_PLAIN)) {
		const before = text.slice(last, match.index);
		out += (before ? fn(before) : before) + match[0];
		last = match.index + match[0].length;
	}
	const rest = text.slice(last);
	return out + (rest ? fn(rest) : rest);
}

export function applyFont(text, id) {
	if (typeof text !== 'string' || !text) return text;
	const entry = FONT_LIST[id];
	if (!entry || typeof entry.fn !== 'function') return text;
	try {
		return styleAround(text, entry.fn);
	} catch {
		return text;
	}
}

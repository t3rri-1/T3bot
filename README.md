# T3bot

A WhatsApp bot built on [Baileys](https://github.com/WhiskeySockets/Baileys) v7 (Node.js, ES modules). It ships with 250+ commands, runs happily on small free hosts, and can update itself from this repository.

- **Commands** for groups, downloads, search, AI chat, stickers and media conversion, privacy settings, notes, filters, scheduling, statuses and more (send `.menu` to see them all).
- **Interactive messages**: buttons, copy-code buttons and native select lists.
- **Self-updating**: checks GitHub, installs updates, verifies them and rolls back if they break the bot.
- **Small-host friendly**: tunes Node's heap to the memory it is given, prunes its own message store, and limits media sizes.
- **SQLite by default**, PostgreSQL when `DATABASE_URL` is set.

## Requirements

| | |
|---|---|
| Node.js | 18 or newer |
| Package manager | yarn 1.22 (`packageManager` in `package.json`) or npm |
| ffmpeg | bundled through `@ffmpeg-installer/ffmpeg`, or point `FFMPEG_PATH` at your own |
| git | only needed for self-updating (see [Updating](#updating)) |

## Quick start

```bash
git clone https://github.com/t3rri-1/T3bot
cd T3bot
yarn install --production      # or: npm install --omit=dev
# create a .env file next to package.json with your settings, see Configuration
npm start
```

**First login.** Put your WhatsApp number (country code, no `+`) in `SUDO`.

- With a `SESSION_ID`, the bot restores that session.
- With no `SESSION_ID`, the bot asks WhatsApp for a pairing code for the `SUDO` number and prints it in the console. On the phone: **WhatsApp → Linked devices → Link a device → Link with phone number instead**, then enter the code. A new code is issued about every 3 minutes, a few times, before the bot waits for the next restart.

The bot also serves a tiny HTTP page on `PORT` (default `8000`) so hosts that expect an open port keep it running.

## Configuration

Set these as environment variables or in a `.env` file. Everything is optional except that you need a `SUDO` number or a `SESSION_ID` to log in.

| Variable | What it does |
|---|---|
| `SESSION_ID` | Session to restore. Leave empty to link with a pairing code instead. |
| `SUDO` | Owner number(s) with country code. Several numbers: separate with `;`. Also the number a pairing code is requested for. |
| `BOT_INFO` | `Owner;Bot name;Logo URL`, used in menus and cards. |
| `STICKER_PACK` | `Author;Pack name` written into stickers. |
| `WARN_COUNT` | Warnings before the bot acts on a user (default `3`). |
| `TIME_ZONE` | Time zone for schedules and timestamps. |
| `CHANNEL_JID` | Default WhatsApp channel for `.upch` (you can also give a channel in the command). |
| `API_ID` | Base URL of the API used by some commands. |
| `DATABASE_URL` | PostgreSQL URL. Leave unset to use SQLite (`./database.db`). |
| `PORT` | Port of the keep-alive HTTP page (default `8000`). |
| `DEBUG` | Extra logging while developing. |

**Updating**

| Variable | What it does |
|---|---|
| `UPDATE_INTERVAL` | Minutes between update checks (default `30`, minimum `5`). |
| `UPDATE_BRANCH` | Branch to follow (default: the branch the bot is on, else the remote's default branch). |
| `UPDATE_REPO` | Where to update from, used when the folder has no `.git` yet. `owner/repo` or a full URL. Defaults to `repository` in `package.json`. For a private repo use `https://user:token@github.com/owner/repo`. |

**Status posting**

| Variable | What it does |
|---|---|
| `STATUS_AUDIENCE_MAX` | Most people a `.tostatus` post is sent to (default `1000`). Lower it on very small hosts. |

**Memory and storage tuning**

| Variable | What it does |
|---|---|
| `MEMORY_LIMIT_MB` | Memory the bot tunes itself to. Default: the container's limit, else 308. |
| `MAX_HEAP_MB` | Node heap size. Default: 45% of the memory limit (between 96 and 1024). |
| `MAX_MEDIA_MB` | Largest media file the bot will download. Default 30 (100 on hosts with more than 512 MB). |
| `MSG_RETENTION_HOURS` | How long stored messages are kept (default `48`). |
| `MSG_MAX_ROWS` | Most stored messages kept (default `3000`). |
| `STATUS_RETENTION_HOURS` | How long stored statuses are kept (default `12`). |
| `FFMPEG_PATH` | Use this ffmpeg instead of the bundled one. |

## Deploying

| Where | How |
|---|---|
| **Docker** | `docker build -t t3bot .` then run it with your env vars. The image clones this repo from GitHub (not your local folder), so self-updating works out of the box. |
| **Render** | Use `render.yaml` (a Docker web service). Fill in `SUDO` and, if you have one, `SESSION_ID`. |
| **Heroku** | `app.json` and `heroku.yml` describe a container deploy. |
| **Panel hosts (zip upload)** | Upload the project, install dependencies, start with `npm start`. No `.git` folder is needed, the first update check creates one (see below). |

Keep `SESSION_ID` or the `session/` folder and `database.db` on persistent storage, or the bot has to link again after every restart.

## Updating

| Command | What it does |
|---|---|
| `.update` | Checks for a new version and lists the changes. |
| `.update now` | Installs it and restarts. If your own edits are in the way, they are stashed (kept in `git stash`) rather than lost. |
| `.update rollback` | Goes back to the version that was running before the last update. |
| `.autoupdate` | Shows the update status. |
| `.autoupdate on / notify / off` | `on` installs new commits by itself, `notify` (the default) only tells you in the bot's own chat, `off` does nothing. |

How an update stays safe:

1. It fast-forwards only, so history is never rewritten. Your uncommitted edits are never overwritten: a normal update stops if one is in the way, and `.update now` stashes it first.
2. Dependencies are reinstalled only when `package.json` dependencies changed.
3. Every changed `.js` file is syntax-checked before the restart.
4. If the new code fails, or the bot crashes three times right after the restart, the previous version comes back automatically and that commit is skipped from then on.

**Folders without a `.git` (zip uploads).** On the first check the bot builds a git checkout in place: it fetches the repository's history, then points `HEAD` at the commit whose files look most like your folder. Your files are not touched. Anything that differs from that commit is simply a local edit, and `.autoupdate` shows how many files that is. If you uploaded a change by hand and later push the same change to the repository, the update recognises the identical files and installs cleanly, without stashing anything. This needs `git` on the host and access to the repository. If it cannot be set up, `.autoupdate` says why.

## Commands worth knowing

Send `.menu` for the full list. The prefix can be changed with `.setprefix`.

| Command | What it does |
|---|---|
| `.pair <number>` | Gets a pairing code for a number and sends it with a **Copy code** button. |
| `.pin [24h \| 7d \| 30d]` | Reply to a message to pin it (24 hours by default). |
| `.unpin` | Reply to a pinned message to unpin it. |
| `.pinchat` / `.unpinchat` | Pin or unpin the whole chat at the top of your chat list. |
| `.tostatus <text>` | Posts text to your WhatsApp Status. Reply to an image, video or audio to post that instead (the text becomes the caption). |
| `.swgc <text>` | Posts a **group status**: media, text or a link. In a group it posts there. In a private chat it sends a **select list** of your groups, tap one to post to it. Long lists continue on a "More groups" row. |
| `.upswgcall <text>` | Posts the same group status to every group the bot is in. |
| `.update`, `.autoupdate` | See [Updating](#updating). |

### How `.tostatus` decides who sees a status

WhatsApp does not send a status "to everyone": the sender must list the people who get it. The bot builds that list for you:

- **In a group:** that group's members, plus you.
- **Anywhere else:** you, the chat you are in, and everyone the bot has talked to (people it has seen messages from), up to `STATUS_AUDIENCE_MAX`.

Your own number is always included, so the post shows up under *My status* on your phone. The reply tells you how many people it was sent to. If the bot has not seen any contacts yet, it says it was sent to **only you**, which is the cue to let a few chats come through first.

### Posting is verified

After sending, the bot waits for WhatsApp's acknowledgement and reports what happened:

| Reply | Meaning |
|---|---|
| `Posted to your status.` | WhatsApp accepted it. |
| `... has not confirmed it yet` | Sent, but no answer came in time. Check the status, and send again if it is missing. |
| `Status post failed: WhatsApp refused it (error 403: ...)` | WhatsApp rejected it. The error code and a hint say why (no permission in that group, rate limit, and so on). |

The same check is used by `.pin` and `.unpin`.

## Project layout

```
index.js            supervisor: starts the bot in a worker, restarts it, keeps memory in check
config.js           reads environment variables
bot/                auto-updater (only Node built-ins, so it can still roll back a broken update)
lib/                WhatsApp client, message handling, interactive-message builders
  ack.js              waits for WhatsApp's acknowledgement of a message
  status.js           status audience, status and group-status posting
  button.js           Button, Carousel and other interactive-message builders
plugins/            one file per feature area, every command lives here
sql/                Sequelize models (settings, sudo users, message store, ...)
utils/              helpers: media conversion, fonts, HTTP, parsing
media/              static assets
```

## Writing a command

Drop a file in `plugins/` and register commands with `bot()`:

```js
import { bot } from '#lib';

bot(
	{
		pattern: 'hello',   // matched after the prefix; arguments follow a space
		public: true,       // false = only owners (SUDO)
		desc: 'Say hello',  // shown in the menu
		type: 'fun'         // menu category
	},
	async (message, match) => {
		return message.send(`_Hello ${match || 'there'}!_`);
	}
);
```

Useful bits of `message`: `send()`, `react()`, `prefix`, `jid`, `isGroup`, `reply_message` (the message being replied to, with its `key`, `image`/`video`/`audio` flags and `text`), `download()` (media of the replied message), and `client` (the Baileys socket).

**Buttons and lists.** A tapped button or list row comes back as an ordinary message whose text is the button's `id`, so make the `id` a command:

```js
import { bot, Button } from '#lib';

bot({ pattern: 'demo', public: false, desc: 'Button demo', type: 'tools' }, async message => {
	await new Button(message.client)
		.setBody('Pick one')
		.setFooter('T3bot')
		.addReply('Ping', `${message.prefix}ping`)
		.addCopy('Copy code', 'ABCD1234')
		.send(message.jid);
});
```

Use `.addSelection('Open list')` with `.makeSection(title)` and `.makeRow(header, title, description, id)` for a select list.

**Knowing a message really went out.** `client.sendMessage()` resolves when the message is handed to the connection, not when WhatsApp accepts it. When that matters, use `sendConfirmed()` from `#lib`:

```js
import { sendConfirmed } from '#lib';

const { confirmed } = await sendConfirmed(message.client, message.jid, { text: 'hi' });
// confirmed: WhatsApp acknowledged it. It throws if WhatsApp refuses the message.
```

## Troubleshooting

| You see | Do this |
|---|---|
| `AutoUpdate ... Unavailable: updates need git, and it is not installed` | Install git on the host, or redeploy with Docker. |
| `Unavailable: ... could not read from remote repository` | The repository is private or the host cannot reach GitHub. Set `UPDATE_REPO` with a token URL, or fix the network. |
| `Update blocked ... your own edits are in the way` | You edited a file the update also changes. `.update now` stashes your edit and installs the update. |
| `.tostatus` says `only you` | The bot has not seen any contacts yet. Let a few chats come through, then post again. |
| `WhatsApp refused it (error 403)` | The account is not allowed to post there. For group statuses, check you are a member and the group lets you post. |
| Button or list does not show | Make sure WhatsApp on the phone is up to date, then try again. |

## License

MIT. See [LICENSE](LICENSE).

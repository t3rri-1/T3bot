# T3bot

A WhatsApp bot built on [Baileys](https://github.com/WhiskeySockets/Baileys) v7 (Node.js, ES modules). It ships with 250+ commands, runs happily on small free hosts, and can update itself from this repository.


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

### Getting a session ID

If you don't have a `SESSION_ID` yet, generate one at https://t3rri-id.onrender.com and paste it into `.env` as `SESSION_ID`. With it set, the bot restores that session instead of asking for a pairing code.

- With a `SESSION_ID`, the bot restores that session.
- With no `SESSION_ID`, the bot asks WhatsApp for a pairing code for the `SUDO` number and prints it in the console. On the phone: **WhatsApp → Linked devices → Link a device → Link with phone number instead**, then enter the code. A new code is issued about every 3 minutes, a few times, before the bot waits for the next restart.


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
| `FGSI_API_KEY` | Key for the fgsi.dpdns.org tools (`hdvid`, `img2img`). A shared one is built in, set your own if it stops working. |
| `ANTITAG_LIMIT` | Members tagged in one message from which `antitag` acts (default `5`). |
| `DEBUG` | Extra logging while developing. |


## Deploying

| Where | How |
|---|---|
| **Docker** | `docker build -t t3bot .` then run it with your env vars. The image clones this repo from GitHub (not your local folder), so self-updating works out of the box. |
| **Render** | Use `render.yaml` (a Docker web service). Fill in `SUDO` and, if you have one, `SESSION_ID`. |
| **Heroku** | `app.json` and `heroku.yml` describe a container deploy. |
| **Panel hosts (zip upload)** | Upload the project, install dependencies, start with `npm start`. No `.git` folder is needed, the first update check creates one (see below). |

## License

MIT. See [LICENSE](LICENSE).

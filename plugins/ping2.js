import os from 'os'
import fs from 'fs'
import { execSync } from 'child_process'
import { bot, A2UI, sendA2UIWidget } from '#lib'
import { config } from '#config'

// Header image of the card. It has to be a public URL, A2UI can't take a local file.
const THUMB_URL =
  'https://raw.githubusercontent.com/RennZSync/uploaders/main/anu/1790585777057-60027c4b.jpg'

const botName = () => (config.BOT_INFO || '').split(';')[1]?.trim() || 'T3rri Bot'

bot(
  {
    pattern: 'ping2|speed2',
    public: true,
    desc: 'Server info card: status, system, CPU, memory, runtime and storage',
    type: 'system',
  },
  async message => {
    const start = Date.now()
    const conn = message.client

    const totalMem = os.totalmem()
    const freeMem = os.freemem()
    const usedMem = totalMem - freeMem
    const memPercent = ((usedMem / totalMem) * 100).toFixed(1)

    const processMem = process.memoryUsage()

    // os.cpus() can come back empty (Termux, some containers)
    const cpus = os.cpus()
    const cpu = cpus[0] || {}

    let disk = '-'
    try {
      disk = execSync('df -h / | tail -1', {
        timeout: 3000,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
        .toString()
        .trim()
        .replace(/\s+/g, ' ')
    } catch {}

    let distro = '-'
    try {
      const release = fs.readFileSync('/etc/os-release', 'utf8')
      distro = release.match(/^PRETTY_NAME="(.+)"$/m)?.[1] || '-'
    } catch {}

    let tmpFiles = '-'
    try {
      tmpFiles = fs.readdirSync(os.tmpdir()).length
    } catch {}

    const speed = Date.now() - start

    const ui = new A2UI()

    const thumbnail = ui.image(THUMB_URL, { variant: 'header' })

    const title = ui.text('Server Information', {
      variant: 'h1'
    })

    const statusCard = ui.card(
      ui.column([
        ui.text('Bot Status', { variant: 'h2' }),

        ui.text(
          `Running On: ${
            process.env.USER === 'root'
              ? 'VPS'
              : 'HOSTING (PANEL)'
          }`
        ),

        ui.text(`Bot Speed: ${speed} ms`),

        ui.text(
          `Bot Uptime: ${toTime(process.uptime() * 1000)}`,
          { variant: 'caption' }
        ),

        ui.text(
          `Server Uptime: ${toTime(os.uptime() * 1000)}`,
          { variant: 'caption' }
        )
      ])
    )

    const systemCard = ui.card(
      ui.column([
        ui.text('System', { variant: 'h2' }),

        ui.text(`Distro: ${distro}`),
        ui.text(`Platform: ${os.platform()}`),
        ui.text(`Type: ${os.type()}`),
        ui.text(`Release: ${os.release()}`),
        ui.text(`Architecture: ${os.arch()}`),
        ui.text(`Hostname: ${os.hostname()}`),
        ui.text(`Node.js: ${process.version}`),
        ui.text(`PID: ${process.pid}`)
      ])
    )

    const cpuCard = ui.card(
      ui.column([
        ui.text('CPU', { variant: 'h2' }),

        ui.text(`Model: ${cpu.model || '-'}`),
        ui.text(`Cores: ${cpus.length}`),
        ui.text(`Speed: ${cpu.speed ? `${cpu.speed} MHz` : '-'}`),

        ui.text(
          `Load Average: ${os.loadavg()
            .map(v => v.toFixed(2))
            .join(' | ')}`,
          { variant: 'caption' }
        )
      ])
    )

    const memoryCard = ui.card(
      ui.column([
        ui.text('Memory', { variant: 'h2' }),

        ui.text(`Used: ${formatSize(usedMem)}`),
        ui.text(`Free: ${formatSize(freeMem)}`),
        ui.text(`Total: ${formatSize(totalMem)}`),

        ui.text(
          `Usage: ${memPercent}%`,
          { variant: 'caption' }
        )
      ])
    )

    const processCard = ui.card(
      ui.column([
        ui.text('Process Memory', { variant: 'h2' }),

        ui.text(`RSS: ${formatSize(processMem.rss)}`),
        ui.text(`Heap Total: ${formatSize(processMem.heapTotal)}`),
        ui.text(`Heap Used: ${formatSize(processMem.heapUsed)}`),
        ui.text(`External: ${formatSize(processMem.external)}`),
        ui.text(`Array Buffers: ${formatSize(processMem.arrayBuffers ?? 0)}`)
      ])
    )

    const runtimeCard = ui.card(
      ui.column([
        ui.text('Runtime', { variant: 'h2' }),

        ui.text(`V8: ${process.versions.v8 ?? '-'}`),
        ui.text(`OpenSSL: ${process.versions.openssl ?? '-'}`),
        ui.text(`UV: ${process.versions.uv ?? '-'}`),
        ui.text(`Zlib: ${process.versions.zlib ?? '-'}`),
        ui.text(`ICU: ${process.versions.icu ?? '-'}`),

        ui.text(
          `Environment: ${process.env.NODE_ENV || 'production'}`,
          { variant: 'caption' }
        )
      ])
    )

    const storageCard = ui.card(
      ui.column([
        ui.text('Storage', { variant: 'h2' }),

        ui.text(
          `Disk: ${disk}`,
          { variant: 'caption' }
        ),

        ui.text(
          `Tmp Files: ${tmpFiles}`,
          { variant: 'caption' }
        )
      ])
    )

    ui.root([
      thumbnail,
      title,
      statusCard,
      systemCard,
      cpuCard,
      memoryCard,
      processCard,
      runtimeCard,
      storageCard
    ])

    // sent as plain text if WhatsApp refuses the card
    const fallbackText =
      `🔍 *PONG!* • ${speed}ms\n\n` +
      `💻 ${cpu.model || 'Unknown CPU'} • ${cpus.length} core${cpus.length === 1 ? '' : 's'}\n` +
      `🧠 RAM: ${memPercent}% (${formatSize(usedMem)} / ${formatSize(totalMem)})\n` +
      `📦 Node.js ${process.version} • Heap ${formatSize(processMem.heapUsed)}\n` +
      (disk !== '-' ? `🗄️ Disk: ${disk}\n` : '') +
      `⏱️ Uptime: ${toTime(process.uptime() * 1000)}`

    try {
      await sendA2UIWidget(conn, message.jid, {
        footer: `${botName()} • ${speed} ms`,

        a2ui: ui,

        contextInfo: {
          expiration: 7776000
        },

        singleScreen: true
      })
    } catch (e) {
      console.log('[ping2] the A2UI card was not accepted, sent text instead:', e?.message || e)
      await message.send(fallbackText)
    }
  }
)


function toTime(ms) {
  const d = Math.floor(ms / 86400000)
  const h = Math.floor((ms % 86400000) / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)

  return [
    d ? `${d}d` : '',
    h ? `${h}h` : '',
    m ? `${m}m` : '',
    `${s}s`
  ].filter(Boolean).join(' ')
}


function formatSize(bytes) {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  let i = 0

  while (bytes >= 1024 && i < units.length - 1) {
    bytes /= 1024
    i++
  }

  return `${bytes.toFixed(2)} ${units[i]}`
}

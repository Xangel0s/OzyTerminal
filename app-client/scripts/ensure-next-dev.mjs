import http from 'node:http'
import { spawn } from 'node:child_process'

const DEV_HOST = '127.0.0.1'
const DEV_PORT = 3000
const DEV_URL = `http://${DEV_HOST}:${DEV_PORT}`

function probeDevServer() {
  return new Promise((resolve) => {
    const request = http.get(
      DEV_URL,
      {
        timeout: 1500,
      },
      (response) => {
        response.resume()
        resolve(response.statusCode !== undefined && response.statusCode < 500)
      },
    )

    request.on('timeout', () => {
      request.destroy()
      resolve(false)
    })

    request.on('error', () => {
      resolve(false)
    })
  })
}

const hasExistingServer = await probeDevServer()

if (hasExistingServer) {
  console.log(`[tauri] Reusing existing Next.js dev server at ${DEV_URL}`)
  process.exit(0)
}

console.log(`[tauri] Starting Next.js dev server at ${DEV_URL}`)

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const child = spawn(
  npmCommand,
  ['--prefix', 'src-ui', 'run', 'dev', '--', '--hostname', DEV_HOST, '--port', String(DEV_PORT)],
  {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  },
)

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }

  process.exit(code ?? 0)
})

for (const eventName of ['SIGINT', 'SIGTERM']) {
  process.on(eventName, () => {
    if (!child.killed) {
      child.kill(eventName)
    }
  })
}
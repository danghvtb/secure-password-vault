import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const server = await createServer({ server: { host: '127.0.0.1', port: 5173 } })
await server.listen()

const cli = fileURLToPath(new URL('../node_modules/playwright/cli.js', import.meta.url))
const runner = spawn(process.execPath, [cli, 'test'], { stdio: 'inherit', env: process.env })

const shutdown = async (code = 0) => {
  await server.close()
  process.exitCode = code
}

runner.on('error', async () => shutdown(1))
runner.on('close', async (code) => shutdown(code ?? 1))

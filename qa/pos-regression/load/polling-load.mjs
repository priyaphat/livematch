import { performance } from 'node:perf_hooks'
import { writeFile } from 'node:fs/promises'
import { randomInt } from 'node:crypto'

const cfg = {
  baseURL: (process.env.BASE_URL || 'http://localhost:8182').replace(/\/$/, ''),
  identifier: process.env.POS_IDENTIFIER || 'qa.owner.a@example.invalid',
  secret: process.env.POS_SECRET || 'QaPass123!',
  clients: Number(process.env.CLIENTS || 20),
  durationSeconds: Number(process.env.DURATION_SECONDS || 60),
  intervalMs: Number(process.env.POLL_INTERVAL_MS || 10000),
  timeoutMs: Number(process.env.TIMEOUT_MS || 5000),
  synchronized: process.env.SYNCHRONIZED === 'true',
  resultFile: process.env.RESULT_FILE || '',
}

if (!Number.isInteger(cfg.clients) || cfg.clients < 1 || cfg.clients > 500) throw new Error('CLIENTS must be 1..500')
if (cfg.durationSeconds < 5 || cfg.durationSeconds > 3600) throw new Error('DURATION_SECONDS must be 5..3600')

function cookiesFrom(headers) {
  const values = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [headers.get('set-cookie') || '']
  return values.map((value) => value.split(';', 1)[0]).filter(Boolean).join('; ')
}

function cookieValue(cookieHeader, name) {
  const found = cookieHeader.split(/;\s*/).find((value) => value.startsWith(`${name}=`))
  return found ? decodeURIComponent(found.slice(name.length + 1)) : ''
}

async function login() {
  const bootstrap = await fetch(`${cfg.baseURL}/health`)
  let cookies = cookiesFrom(bootstrap.headers)
  const csrf = cookieValue(cookies, 'livematch_csrf')
  const response = await fetch(`${cfg.baseURL}/api/auth/pos/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookies, 'x-csrf-token': csrf },
    body: JSON.stringify({ identifier: cfg.identifier, password: cfg.secret, remember: false }),
  })
  cookies = [cookies, cookiesFrom(response.headers)].filter(Boolean).join('; ')
  if (!response.ok) throw new Error(`POS login failed: HTTP ${response.status} request-id=${response.headers.get('x-request-id') || '-'}`)
  return cookies
}

const endpoints = [
  '/api/admin/pos/receivables?page=1&pageSize=100',
  '/api/admin/pos/payment-history?page=1&pageSize=20',
  '/api/admin/pos/products?page=1&pageSize=40',
  '/api/admin/pos/stock/summary',
]

const samples = []
const failures = []

async function poll(client, endpoint, cookies) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), cfg.timeoutMs)
  const started = performance.now()
  try {
    const response = await fetch(`${cfg.baseURL}${endpoint}`, { headers: { cookie: cookies }, signal: controller.signal })
    const latencyMs = performance.now() - started
    const requestId = response.headers.get('x-request-id') || ''
    await response.arrayBuffer()
    samples.push({ client, endpoint, status: response.status, latencyMs, requestId })
    if (!response.ok) failures.push({ client, endpoint, status: response.status, latencyMs, requestId })
  } catch (error) {
    const latencyMs = performance.now() - started
    const status = error?.name === 'AbortError' ? 'timeout' : 'network_error'
    samples.push({ client, endpoint, status, latencyMs, requestId: '' })
    failures.push({ client, endpoint, status, latencyMs, requestId: '', error: String(error?.message || error) })
  } finally {
    clearTimeout(timeout)
  }
}

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)) }

async function clientLoop(client, cookies, endsAt) {
  if (!cfg.synchronized) await delay(randomInt(0, Math.max(1, cfg.intervalMs)))
  let round = 0
  while (Date.now() < endsAt) {
    const roundStarted = Date.now()
    await Promise.all(endpoints.map((endpoint) => poll(client, endpoint, cookies)))
    round++
    const next = roundStarted + cfg.intervalMs
    if (next >= endsAt) break
    await delay(Math.max(0, next - Date.now()))
  }
}

function percentile(values, fraction) {
  if (!values.length) return 0
  const ordered = [...values].sort((a, b) => a - b)
  return ordered[Math.round((ordered.length - 1) * fraction)]
}

const cookies = await login()
const startedAt = new Date()
const endsAt = Date.now() + cfg.durationSeconds * 1000
await Promise.all(Array.from({ length: cfg.clients }, (_, index) => clientLoop(index + 1, cookies, endsAt)))

const durations = samples.map((sample) => sample.latencyMs)
const statusCounts = samples.reduce((result, sample) => ({ ...result, [sample.status]: (result[sample.status] || 0) + 1 }), {})
const result = {
  startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString(), baseURL: cfg.baseURL,
  clients: cfg.clients, durationSeconds: cfg.durationSeconds, pollIntervalMs: cfg.intervalMs,
  requests: samples.length, failures: failures.length, errorRate: samples.length ? failures.length / samples.length : 1,
  latencyMs: { p50: percentile(durations, .50), p95: percentile(durations, .95), p99: percentile(durations, .99), max: Math.max(0, ...durations) },
  statusCounts, failureSamples: failures.slice(0, 50),
  thresholds: { p95Ms: 2000, errorRate: 0.01, unexpected429: 0, serverErrors: 0 },
}
result.passed = result.latencyMs.p95 <= 2000 && result.errorRate <= .01 && !statusCounts[429] && !Object.entries(statusCounts).some(([status, count]) => Number(status) >= 500 && count > 0)

console.log(JSON.stringify(result, null, 2))
if (cfg.resultFile) await writeFile(cfg.resultFile, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
if (!result.passed) process.exitCode = 1

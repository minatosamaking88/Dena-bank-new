import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, resolve, sep } from 'node:path'

const PORT = Number(process.env.PORT || 3001)
const DIST_DIR = resolve('dist')
const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
}
const accounts = new Map()
const sessions = new Map()
const DAILY_WITHDRAWAL_LIMIT_CENTS = 50000

const json = (response, status, payload, headers = {}) => {
  response.writeHead(status, { 'Content-Type': 'application/json', ...headers })
  response.end(JSON.stringify(payload))
}

const parseCookies = (header = '') =>
  Object.fromEntries(
    header
      .split(';')
      .filter(Boolean)
      .map((part) => {
        const [key, ...value] = part.trim().split('=')
        return [key, decodeURIComponent(value.join('='))]
      }),
  )

const hashPin = (pin, salt = randomBytes(16).toString('hex')) =>
  `${salt}:${scryptSync(pin, salt, 32).toString('hex')}`
const pinMatches = (pin, stored) => {
  const [salt, hash] = stored.split(':')
  const candidate = scryptSync(pin, salt, 32)
  return timingSafeEqual(candidate, Buffer.from(hash, 'hex'))
}
const readBody = async (request) => {
  let raw = ''
  for await (const chunk of request) raw += chunk
  try {
    return JSON.parse(raw || '{}')
  } catch {
    return null
  }
}
const validEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
const centsFromAmount = (amount) => {
  if (typeof amount !== 'string' || !/^\d+(\.\d{1,2})?$/.test(amount.trim())) return null
  const [whole, decimal = ''] = amount.trim().split('.')
  const cents = Number(`${whole}${decimal.padEnd(2, '0')}`)
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null
}
const publicAccount = (account) => ({
  accountNumber: account.accountNumber,
  fullName: account.fullName,
  email: account.email,
  balanceCents: account.balanceCents,
  withdrawnTodayCents: account.withdrawnTodayCents,
  withdrawalLimitCents: DAILY_WITHDRAWAL_LIMIT_CENTS,
})
const accountNumber = () => {
  let value
  do
    value = `${Math.floor(100 + Math.random() * 900)} ${Math.floor(100 + Math.random() * 900)} ${Math.floor(10 + Math.random() * 90)}`
  while ([...accounts.values()].some((account) => account.accountNumber === value))
  return value
}
const currentAccount = (request) =>
  accounts.get(sessions.get(parseCookies(request.headers.cookie).dena_session))
const sessionCookie = (token, maxAge = 60 * 60 * 8) =>
  `dena_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`
const serveStatic = async (response, pathname) => {
  const requestedPath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  const requestedFile = resolve(join(DIST_DIR, requestedPath))
  if (!requestedFile.startsWith(`${DIST_DIR}${sep}`)) return false

  try {
    const content = await readFile(requestedFile)
    response.writeHead(200, {
      'Content-Type': MIME_TYPES[extname(requestedFile)] ?? 'application/octet-stream',
    })
    response.end(content)
    return true
  } catch {
    if (extname(requestedFile)) return false
    try {
      const content = await readFile(join(DIST_DIR, 'index.html'))
      response.writeHead(200, { 'Content-Type': MIME_TYPES['.html'] })
      response.end(content)
      return true
    } catch (fallbackError) {
      console.error('Static frontend is unavailable', fallbackError)
      return false
    }
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`)
  const method = request.method
  try {
    if (method === 'GET' && url.pathname === '/api/account') {
      const account = currentAccount(request)
      return account
        ? json(response, 200, { account: publicAccount(account) })
        : json(response, 401, { message: 'Not signed in.' })
    }
    if (method === 'POST' && url.pathname === '/api/accounts') {
      const body = await readBody(request)
      if (!body || typeof body.fullName !== 'string' || body.fullName.trim().length < 2)
        return json(response, 400, { message: 'Enter your full name.' })
      if (!validEmail(body.email))
        return json(response, 400, { message: 'Enter a valid email address.' })
      if (!/^\d{4}$/.test(body.pin))
        return json(response, 400, { message: 'Your PIN must be exactly 4 digits.' })
      if ([...accounts.values()].some((account) => account.email === body.email.toLowerCase()))
        return json(response, 409, { message: 'An account with that email already exists.' })
      const account = {
        id: randomUUID(),
        accountNumber: accountNumber(),
        fullName: body.fullName.trim(),
        email: body.email.toLowerCase(),
        pinHash: hashPin(body.pin),
        balanceCents: 0,
        withdrawnTodayCents: 0,
        withdrawalDay: new Date().toISOString().slice(0, 10),
      }
      accounts.set(account.id, account)
      const token = randomBytes(24).toString('hex')
      sessions.set(token, account.id)
      return json(
        response,
        201,
        { account: publicAccount(account) },
        { 'Set-Cookie': sessionCookie(token) },
      )
    }
    if (method === 'POST' && url.pathname === '/api/auth/login') {
      const body = await readBody(request)
      const account = [...accounts.values()].find(
        (candidate) => candidate.accountNumber === body?.accountNumber,
      )
      if (!account || typeof body?.pin !== 'string' || !pinMatches(body.pin, account.pinHash))
        return json(response, 401, { message: 'Invalid account number or PIN.' })
      const token = randomBytes(24).toString('hex')
      sessions.set(token, account.id)
      return json(
        response,
        200,
        { account: publicAccount(account) },
        { 'Set-Cookie': sessionCookie(token) },
      )
    }
    if (method === 'POST' && url.pathname === '/api/auth/logout') {
      const cookies = parseCookies(request.headers.cookie)
      sessions.delete(cookies.dena_session)
      return json(response, 200, { account: null }, { 'Set-Cookie': sessionCookie('', 0) })
    }
    if (method === 'POST' && /^\/api\/account\/(deposit|withdraw)$/.test(url.pathname)) {
      const account = currentAccount(request)
      if (!account)
        return json(response, 401, { message: 'Your session has expired. Please sign in again.' })
      const amount = centsFromAmount((await readBody(request))?.amount)
      if (!amount)
        return json(response, 400, {
          message: 'Enter a positive amount with up to two decimal places.',
        })
      if (url.pathname.endsWith('/withdraw')) {
        const today = new Date().toISOString().slice(0, 10)
        if (account.withdrawalDay !== today) {
          account.withdrawalDay = today
          account.withdrawnTodayCents = 0
        }
        if (amount > account.balanceCents)
          return json(response, 400, {
            message: 'This withdrawal is more than your available balance.',
          })
        if (account.withdrawnTodayCents + amount > DAILY_WITHDRAWAL_LIMIT_CENTS)
          return json(response, 400, {
            message: 'This withdrawal would exceed your $500 daily limit.',
          })
        account.balanceCents -= amount
        account.withdrawnTodayCents += amount
      } else account.balanceCents += amount
      return json(response, 200, { account: publicAccount(account) })
    }
    if (method === 'GET') {
      const served = await serveStatic(response, url.pathname)
      if (served) return
    }
    return json(response, 404, { message: 'Not found.' })
  } catch (error) {
    console.error('Request failed', error)
    return json(response, 500, { message: 'Something went wrong on our side.' })
  }
})

server.listen(PORT, '0.0.0.0', () => console.log(`Dena Bank API listening on ${PORT}`))

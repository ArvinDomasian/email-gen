const API = 'https://api.mail.tm'

export class AuthError extends Error {
  constructor() {
    super('Session expired')
    this.name = 'AuthError'
  }
}

export class RateLimitError extends Error {
  constructor() {
    super('Too many requests. Wait a few seconds and try again.')
    this.name = 'RateLimitError'
  }
}

function randomChars(chars: string, length: number): string {
  let s = ''
  for (let i = 0; i < length; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return s
}

export async function getActiveDomain(): Promise<string> {
  const r = await fetch(`${API}/domains?page=1`)
  if (!r.ok) throw new Error(`Could not load domains (${r.status})`)
  const data = (await r.json()) as {
    'hydra:member'?: Array<{ domain: string; isActive?: boolean }>
  }
  const members = data['hydra:member'] ?? []
  const active = members.find((m) => m.isActive !== false) ?? members[0]
  if (!active?.domain) throw new Error('No email domain available')
  return active.domain
}

export async function createMailbox(): Promise<{
  address: string
  password: string
  accountId: string
}> {
  const domain = await getActiveDomain()
  const address = `${randomChars('abcdefghijklmnopqrstuvwxyz0123456789', 10)}@${domain}`
  const password = randomChars(
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
    24,
  )
  const r = await fetch(`${API}/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, password }),
  })
  if (r.status === 429) throw new RateLimitError()
  if (!r.ok) {
    const t = await r.text()
    throw new Error(`Could not create inbox (${r.status}): ${t}`)
  }
  const acc = (await r.json()) as { id: string }
  return { address, password, accountId: acc.id }
}

export async function getToken(address: string, password: string): Promise<string> {
  const r = await fetch(`${API}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, password }),
  })
  if (r.status === 429) throw new RateLimitError()
  if (!r.ok) {
    const t = await r.text()
    throw new Error(`Could not sign in (${r.status}): ${t}`)
  }
  const data = (await r.json()) as { token: string }
  return data.token
}

export interface MailMessageSummary {
  id: string
  from: { address: string; name?: string }
  subject: string
  intro: string
  createdAt: string
}

export async function listMessages(
  token: string,
  page = 1,
): Promise<MailMessageSummary[]> {
  const r = await fetch(`${API}/messages?page=${page}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (r.status === 401) throw new AuthError()
  if (r.status === 429) throw new RateLimitError()
  if (!r.ok) throw new Error(`Could not load messages (${r.status})`)
  const data = (await r.json()) as { 'hydra:member'?: Record<string, unknown>[] }
  const members = data['hydra:member'] ?? []
  return members.map((m) => ({
    id: String(m.id),
    from: m.from as { address: string; name?: string },
    subject: String(m.subject ?? ''),
    intro: String(m.intro ?? ''),
    createdAt: String(m.createdAt ?? ''),
  }))
}

export interface MailMessageDetail extends MailMessageSummary {
  html?: string[]
  text?: string
}

export async function getMessage(token: string, id: string): Promise<MailMessageDetail> {
  const r = await fetch(`${API}/messages/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (r.status === 401) throw new AuthError()
  if (r.status === 429) throw new RateLimitError()
  if (!r.ok) throw new Error(`Could not open message (${r.status})`)
  return r.json() as Promise<MailMessageDetail>
}

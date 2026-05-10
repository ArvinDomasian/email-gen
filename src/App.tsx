import { useCallback, useEffect, useMemo, useState } from 'react'
import './App.css'
import {
  AuthError,
  RateLimitError,
  createMailbox,
  getMessage,
  getToken,
  listMessages,
  type MailMessageDetail,
  type MailMessageSummary,
} from './mailtm'
import { extractOtps, messagePlainText } from './otp'
import {
  clearAllInboxes,
  loadStorage,
  mergeMessages,
  removeInboxesByAddresses,
  saveStorage,
  upsertInbox,
  type AppStorage,
  type StoredInbox,
  type StoredMessage,
} from './storage'

function summariesToStored(
  rows: MailMessageSummary[],
): Omit<StoredMessage, 'savedAt'>[] {
  return rows.map((m) => ({
    id: m.id,
    subject: m.subject,
    fromAddress: m.from.address,
    fromName: m.from.name,
    intro: m.intro,
    createdAt: m.createdAt,
  }))
}

function storedToSummary(m: StoredMessage): MailMessageSummary {
  return {
    id: m.id,
    from: { address: m.fromAddress, name: m.fromName },
    subject: m.subject,
    intro: m.intro,
    createdAt: m.createdAt,
  }
}

function useAppStore() {
  const [store, setStore] = useState(loadStorage)

  const persist = useCallback(
    (update: AppStorage | ((prev: AppStorage) => AppStorage)) => {
      setStore((prev) => {
        const next = typeof update === 'function' ? update(prev) : update
        saveStorage(next)
        return next
      })
    },
    [],
  )

  return { store, persist }
}

export default function App() {
  const { store, persist } = useAppStore()
  const [token, setToken] = useState<string | null>(null)
  const [active, setActive] = useState<StoredInbox | null>(null)
  const [messages, setMessages] = useState<MailMessageSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<MailMessageDetail | null>(null)
  const [loading, setLoading] = useState<'init' | 'sync' | 'msg' | 'new' | null>('init')
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [selectedInboxAddresses, setSelectedInboxAddresses] = useState<Set<string>>(
    () => new Set(),
  )

  const displayList = useMemo(() => {
    if (messages.length > 0) return messages
    if (!active) return []
    const cached = store.messagesByAccount[active.accountId] ?? []
    return cached.map(storedToSummary)
  }, [messages, store.messagesByAccount, active])

  const authAndSync = useCallback(
    async (inbox: StoredInbox) => {
      const t = await getToken(inbox.address, inbox.password)
      setToken(t)
      const list = await listMessages(t)
      setMessages(list)
      persist((s) => mergeMessages(s, inbox.accountId, summariesToStored(list)))
    },
    [persist],
  )

  const bootstrap = useCallback(async () => {
    setError(null)
    setLoading('init')
    try {
      const s0 = loadStorage()
      let inbox: StoredInbox | null =
        s0.inboxes.find((i) => i.address === s0.currentAddress) ?? s0.inboxes[0] ?? null

      if (!inbox) {
        const created = await createMailbox()
        inbox = {
          accountId: created.accountId,
          address: created.address,
          password: created.password,
          createdAt: new Date().toISOString(),
        }
      }
      persist((s) => upsertInbox(s, inbox!))

      setActive(inbox)
      await authAndSync(inbox)
    } catch (e) {
      if (e instanceof RateLimitError) setError(e.message)
      else if (e instanceof Error) setError(e.message)
      else setError('Something went wrong.')
    } finally {
      setLoading(null)
    }
  }, [authAndSync, persist])

  useEffect(() => {
    void bootstrap()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, [])

  const syncInbox = useCallback(async () => {
    if (!active || !token) return
    setError(null)
    setLoading('sync')
    try {
      const list = await listMessages(token)
      setMessages(list)
      persist((s) => mergeMessages(s, active.accountId, summariesToStored(list)))
    } catch (e) {
      if (e instanceof AuthError) {
        const t = await getToken(active.address, active.password)
        setToken(t)
        const list = await listMessages(t)
        setMessages(list)
        persist((s) => mergeMessages(s, active.accountId, summariesToStored(list)))
      } else if (e instanceof RateLimitError) setError(e.message)
      else if (e instanceof Error) setError(e.message)
    } finally {
      setLoading(null)
    }
  }, [active, persist, token])

  const openMessage = useCallback(
    async (id: string) => {
      if (!active || !token) return
      setSelectedId(id)
      setError(null)
      setLoading('msg')
      setDetail(null)
      try {
        const d = await getMessage(token, id)
        setDetail(d)
      } catch (e) {
        if (e instanceof AuthError) {
          const t = await getToken(active.address, active.password)
          setToken(t)
          const d = await getMessage(t, id)
          setDetail(d)
        } else if (e instanceof RateLimitError) setError(e.message)
        else if (e instanceof Error) setError(e.message)
      } finally {
        setLoading(null)
      }
    },
    [active, token],
  )

  const newEmail = useCallback(async () => {
    setError(null)
    setLoading('new')
    setSelectedId(null)
    setDetail(null)
    try {
      const created = await createMailbox()
      const inbox: StoredInbox = {
        accountId: created.accountId,
        address: created.address,
        password: created.password,
        createdAt: new Date().toISOString(),
      }
      setActive(inbox)
      const t = await getToken(inbox.address, inbox.password)
      setToken(t)
      const list = await listMessages(t)
      setMessages(list)
      persist((s) =>
        mergeMessages(upsertInbox(s, inbox), inbox.accountId, summariesToStored(list)),
      )
    } catch (e) {
      if (e instanceof RateLimitError) setError(e.message)
      else if (e instanceof Error) setError(e.message)
    } finally {
      setLoading(null)
    }
  }, [persist])

  const switchInbox = useCallback(
    async (inbox: StoredInbox) => {
      setError(null)
      setLoading('init')
      setSelectedId(null)
      setDetail(null)
      try {
        persist((s) => upsertInbox(s, inbox))
        setActive(inbox)
        await authAndSync(inbox)
      } catch (e) {
        if (e instanceof Error) setError(e.message)
      } finally {
        setLoading(null)
      }
    },
    [authAndSync, persist],
  )

  const recoverWhenNoInboxes = useCallback(async () => {
    setError(null)
    setLoading('init')
    setSelectedId(null)
    setDetail(null)
    setToken(null)
    setMessages([])
    try {
      const created = await createMailbox()
      const inbox: StoredInbox = {
        accountId: created.accountId,
        address: created.address,
        password: created.password,
        createdAt: new Date().toISOString(),
      }
      persist((s) => upsertInbox(s, inbox))
      setActive(inbox)
      await authAndSync(inbox)
    } catch (e) {
      if (e instanceof Error) setError(e.message)
      setActive(null)
    } finally {
      setLoading(null)
    }
  }, [authAndSync, persist])

  const toggleInboxSelected = useCallback((address: string) => {
    setSelectedInboxAddresses((prev) => {
      const next = new Set(prev)
      if (next.has(address)) next.delete(address)
      else next.add(address)
      return next
    })
  }, [])

  const deleteSelectedInboxes = useCallback(() => {
    const toRemove = [...selectedInboxAddresses]
    if (toRemove.length === 0) return
    const removeSet = new Set(toRemove)
    const remaining = store.inboxes.filter((i) => !removeSet.has(i.address))
    const activeDeleted = Boolean(active && removeSet.has(active.address))

    persist((s) => removeInboxesByAddresses(s, toRemove))
    setSelectedInboxAddresses(new Set())

    if (!activeDeleted) return
    if (remaining.length > 0) {
      void switchInbox(remaining[0])
    } else {
      void recoverWhenNoInboxes()
    }
  }, [
    active,
    persist,
    recoverWhenNoInboxes,
    selectedInboxAddresses,
    store.inboxes,
    switchInbox,
  ])

  const deleteAllInboxes = useCallback(() => {
    if (store.inboxes.length === 0) return
    if (
      !window.confirm(
        'Remove every stored inbox and cached messages from this browser? You will get a fresh address.',
      )
    ) {
      return
    }
    persist((s) => clearAllInboxes(s))
    setSelectedInboxAddresses(new Set())
    void recoverWhenNoInboxes()
  }, [persist, recoverWhenNoInboxes, store.inboxes.length])

  const copyText = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(label)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      setError('Clipboard not available in this context.')
    }
  }

  const detailOtps = detail ? extractOtps(messagePlainText(detail)) : []

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__hero">
          <span className="app__hero-icon" aria-hidden>
            📬
          </span>
          <div className="app__hero-text">
            <p className="app__eyebrow">Your cozy disposable mailbox</p>
            <h1 className="app__title">Temp Inbox</h1>
            <p className="app__lede">
              Grab a fresh address for sign-ups and OTPs—powered by{' '}
              <a href="https://mail.tm" target="_blank" rel="noreferrer">
                Mail.tm
              </a>
              . (Not Gmail—mail arrives on Mail.tm domains only.)
            </p>
          </div>
        </div>
      </header>

      {error ? (
        <div className="app__banner app__banner--error" role="alert">
          {error}
        </div>
      ) : null}

      <section className="card">
        <div className="row row--wrap">
          <div className="address-block">
            <span className="muted">Current address</span>
            <div className="address-line">
              <code className="address">{active?.address ?? '…'}</code>
              <button
                type="button"
                className="btn btn--ghost"
                disabled={!active || loading !== null}
                onClick={() => active && void copyText('addr', active.address)}
              >
                {copied === 'addr' ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
          <div className="actions">
            <button
              type="button"
              className="btn"
              disabled={loading !== null || !active}
              onClick={() => void syncInbox()}
            >
              {loading === 'sync' ? 'Refreshing…' : 'Refresh inbox'}
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={loading !== null}
              onClick={() => void newEmail()}
              title="Create a new address and keep the old one in history"
            >
              {loading === 'new' ? 'Creating…' : 'New email'}
            </button>
          </div>
        </div>
        {loading === 'init' && !active ? (
          <p className="muted small">Preparing your inbox…</p>
        ) : null}
      </section>

      <div className="layout">
        <aside className="sidebar">
          <h2 className="sidebar__title">Stored inboxes</h2>
          <p className="muted small">
            Saved locally in your browser. Tick boxes to remove, or open an inbox to read mail.
          </p>
          <div className="sidebar__toolbar">
            <button
              type="button"
              className="btn btn--sm"
              disabled={selectedInboxAddresses.size === 0 || loading !== null}
              onClick={() => deleteSelectedInboxes()}
            >
              Delete selected
            </button>
            <button
              type="button"
              className="btn btn--sm btn--danger"
              disabled={store.inboxes.length === 0 || loading !== null}
              onClick={() => deleteAllInboxes()}
            >
              Delete all
            </button>
          </div>
          <ul className="inbox-list">
            {store.inboxes.map((inv) => (
              <li key={inv.address} className="inbox-row">
                <label className="inbox-check">
                  <input
                    type="checkbox"
                    checked={selectedInboxAddresses.has(inv.address)}
                    onChange={() => toggleInboxSelected(inv.address)}
                  />
                  <span className="inbox-check__faux" aria-hidden />
                </label>
                <button
                  type="button"
                  className={
                    inv.address === active?.address
                      ? 'inbox-pill inbox-pill--active'
                      : 'inbox-pill'
                  }
                  onClick={() => void switchInbox(inv)}
                >
                  <span className="inbox-pill__addr">{inv.address}</span>
                  <span className="inbox-pill__meta">
                    {new Date(inv.createdAt).toLocaleString()}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <main className="main">
          <div className="split">
            <div className="panel">
              <div className="panel__head">
                <h2>Messages</h2>
                <span className="muted small">
                  {messages.length > 0
                    ? `${messages.length} live`
                    : `${displayList.length} cached / live`}
                </span>
              </div>
              <ul className="msg-list">
                {displayList.map((m) => {
                  const otps = extractOtps(`${m.subject}\n${m.intro}`)
                  return (
                    <li key={m.id}>
                      <button
                        type="button"
                        className={
                          m.id === selectedId ? 'msg-item msg-item--active' : 'msg-item'
                        }
                        onClick={() => void openMessage(m.id)}
                      >
                        <span className="msg-item__subj">{m.subject || '(no subject)'}</span>
                        <span className="msg-item__from">{m.from.address}</span>
                        <span className="msg-item__intro">{m.intro}</span>
                        {otps.length ? (
                          <span className="otp-row">
                            {otps.map((o) => (
                              <span key={o} className="otp-chip">
                                {o}
                              </span>
                            ))}
                          </span>
                        ) : null}
                        <span className="msg-item__time">
                          {new Date(m.createdAt).toLocaleString()}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
              {!displayList.length ? (
                <p className="muted empty-hint">
                  No messages yet. Use this address on a site, then hit Refresh inbox.
                </p>
              ) : null}
            </div>

            <div className="panel panel--detail">
              <div className="panel__head">
                <h2>Reading</h2>
                {detailOtps.length ? (
                  <div className="otp-row">
                    {detailOtps.map((o) => (
                      <button
                        key={o}
                        type="button"
                        className="otp-chip otp-chip--btn"
                        onClick={() => void copyText(`otp-${o}`, o)}
                      >
                        {o}
                        {copied === `otp-${o}` ? ' ✓' : ''}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              {loading === 'msg' ? (
                <p className="muted">Loading message…</p>
              ) : null}
              {detail ? (
                <article className="detail">
                  <h3 className="detail__subject">{detail.subject || '(no subject)'}</h3>
                  <p className="detail__meta">
                    From{' '}
                    <strong>
                      {detail.from.name ? `${detail.from.name} ` : ''}
                      &lt;{detail.from.address}&gt;
                    </strong>
                    <br />
                    {new Date(detail.createdAt).toLocaleString()}
                  </p>
                  <div className="detail__body">
                    {detail.text
                      ? detail.text
                      : detail.html?.length
                        ? htmlToPlainSafe(detail.html.join('\n'))
                        : detail.intro}
                  </div>
                </article>
              ) : (
                !loading && (
                  <p className="muted empty-hint">
                    Select a message to read the full body and OTPs.
                  </p>
                )
              )}
            </div>
          </div>
        </main>
      </div>

      <footer className="app__footer">
        <p className="muted small">
          Data stays in your browser (localStorage). Mail.tm may delete inactive mail per
          their policy.
        </p>
      </footer>
    </div>
  )
}

function htmlToPlainSafe(html: string): string {
  const d = document.createElement('div')
  d.innerHTML = html
  return (d.textContent ?? d.innerText ?? '').trim()
}

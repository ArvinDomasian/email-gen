const KEY = 'temp-inbox-app-v1'

export type StoredInbox = {
  accountId: string
  address: string
  password: string
  createdAt: string
}

export type StoredMessage = {
  id: string
  subject: string
  fromAddress: string
  fromName?: string
  intro: string
  createdAt: string
  savedAt: string
}

export type AppStorage = {
  currentAddress: string | null
  inboxes: StoredInbox[]
  messagesByAccount: Record<string, StoredMessage[]>
}

function empty(): AppStorage {
  return {
    currentAddress: null,
    inboxes: [],
    messagesByAccount: {},
  }
}

export function loadStorage(): AppStorage {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return empty()
    const parsed = JSON.parse(raw) as Partial<AppStorage>
    return {
      ...empty(),
      ...parsed,
      inboxes: Array.isArray(parsed.inboxes) ? parsed.inboxes : [],
      messagesByAccount:
        parsed.messagesByAccount && typeof parsed.messagesByAccount === 'object'
          ? parsed.messagesByAccount
          : {},
    }
  } catch {
    return empty()
  }
}

export function saveStorage(state: AppStorage): void {
  localStorage.setItem(KEY, JSON.stringify(state))
}

export function upsertInbox(state: AppStorage, inbox: StoredInbox): AppStorage {
  const rest = state.inboxes.filter((i) => i.address !== inbox.address)
  return {
    ...state,
    inboxes: [inbox, ...rest],
    currentAddress: inbox.address,
  }
}

export function removeInboxesByAddresses(
  state: AppStorage,
  addresses: string[],
): AppStorage {
  const remove = new Set(addresses)
  const accountIdsToDrop = new Set(
    state.inboxes.filter((i) => remove.has(i.address)).map((i) => i.accountId),
  )
  const nextInboxes = state.inboxes.filter((i) => !remove.has(i.address))
  const messagesByAccount = { ...state.messagesByAccount }
  for (const id of accountIdsToDrop) {
    delete messagesByAccount[id]
  }
  let currentAddress = state.currentAddress
  if (currentAddress && remove.has(currentAddress)) {
    currentAddress = nextInboxes[0]?.address ?? null
  }
  return {
    ...state,
    inboxes: nextInboxes,
    messagesByAccount,
    currentAddress,
  }
}

export function clearAllInboxes(state: AppStorage): AppStorage {
  return {
    ...state,
    inboxes: [],
    messagesByAccount: {},
    currentAddress: null,
  }
}

export function mergeMessages(
  state: AppStorage,
  accountId: string,
  items: Omit<StoredMessage, 'savedAt'>[],
): AppStorage {
  const now = new Date().toISOString()
  const prev = state.messagesByAccount[accountId] ?? []
  const byId = new Map(prev.map((m) => [m.id, m]))
  for (const it of items) {
    const existing = byId.get(it.id)
    byId.set(it.id, {
      ...it,
      savedAt: existing?.savedAt ?? now,
    })
  }
  const merged = [...byId.values()].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )
  return {
    ...state,
    messagesByAccount: { ...state.messagesByAccount, [accountId]: merged },
  }
}

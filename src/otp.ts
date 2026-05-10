/** Pull likely OTP / verification codes from plain text (subject + body). */
export function extractOtps(text: string): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return []

  const found = new Set<string>()

  for (const m of normalized.matchAll(/\b(\d{4,8})\b/g)) {
    found.add(m[1])
  }

  const contextual =
    /(?:otp|code|pin|verification|verify|token|password|one[- ]time)\s*[:\s#-]*\s*(\d{4,8})/gi
  for (const m of normalized.matchAll(contextual)) {
    found.add(m[1])
  }

  return [...found]
}

export function htmlToPlain(html: string): string {
  const d = document.createElement('div')
  d.innerHTML = html
  return (d.textContent ?? d.innerText ?? '').replace(/\s+/g, ' ').trim()
}

export function messagePlainText(detail: {
  text?: string
  html?: string[]
  intro?: string
  subject?: string
}): string {
  const parts = [detail.subject ?? '', detail.intro ?? '']
  if (detail.text) parts.push(detail.text)
  if (detail.html?.length) parts.push(htmlToPlain(detail.html.join('\n')))
  return parts.filter(Boolean).join('\n\n')
}

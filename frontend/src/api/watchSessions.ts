import type { LibraryPost } from './library'

export interface WatchSessionSummary {
  id: string
  name: string | null
  createdAt: string
  completedAt: string | null
  postCount: number
  currentPosition: number
}

export interface WatchSession extends WatchSessionSummary {
  posts: LibraryPost[]
}

export const MAX_WATCH_SESSION_POSTS = 100
export const MAX_WATCH_SESSION_NAME_LENGTH = 80

export class WatchSessionApiError extends Error {
  readonly status: number | null

  constructor(message: string, status: number | null = null) {
    super(message)
    this.name = 'WatchSessionApiError'
    this.status = status
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

function isDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function isNullableDate(value: unknown): value is string | null {
  return value === null || isDate(value)
}

function isLibraryPost(value: unknown): value is LibraryPost {
  if (!isObject(value) || typeof value.originalUrl !== 'string') {
    return false
  }
  try {
    const url = new URL(value.originalUrl)
    return (
      typeof value.id === 'string' &&
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      (url.hostname === 'instagram.com' || url.hostname.endsWith('.instagram.com')) &&
      url.username.length === 0 &&
      url.password.length === 0 &&
      isDate(value.savedAt) &&
      typeof value.favorite === 'boolean' &&
      (value.creatorUsername === null || typeof value.creatorUsername === 'string') &&
      (value.caption === null || typeof value.caption === 'string')
    )
  } catch {
    return false
  }
}

function isSessionSummary(value: unknown): value is WatchSessionSummary {
  return (
    isObject(value) &&
    typeof value.id === 'string' &&
    (value.name === null || typeof value.name === 'string') &&
    isDate(value.createdAt) &&
    isNullableDate(value.completedAt) &&
    Number.isSafeInteger(value.postCount) &&
    Number(value.postCount) >= 1 &&
    Number.isSafeInteger(value.currentPosition) &&
    Number(value.currentPosition) >= 0 &&
    Number(value.currentPosition) <= Number(value.postCount)
  )
}

function isWatchSession(value: unknown): value is WatchSession {
  if (!isSessionSummary(value) || !isObject(value) || !Array.isArray(value.posts)) {
    return false
  }
  return value.posts.length === value.postCount && value.posts.every(isLibraryPost)
}

async function requestJson(path: string, options?: RequestInit): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(path, {
      ...options,
      method: options?.method ?? 'GET',
      credentials: 'include',
      cache: 'no-store',
    })
  } catch {
    throw new WatchSessionApiError('Could not connect to ReelNest. Check your connection and retry.')
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new WatchSessionApiError('Your session has expired. Sign in again to continue.', 401)
    }
    if (response.status === 403) {
      throw new WatchSessionApiError(
        'Your session is no longer authorized. Sign in again to continue.',
        403,
      )
    }
    if (response.status === 404) {
      throw new WatchSessionApiError('This watch session or saved post is no longer available.', 404)
    }
    if (response.status === 400) {
      throw new WatchSessionApiError(
        'A watch session needs 1–100 distinct saved posts and a name of at most 80 characters.',
        400,
      )
    }
    throw new WatchSessionApiError(
      response.status >= 500
        ? 'The watch session service is unavailable. Please try again.'
        : 'The watch session request could not be completed. Please retry.',
      response.status,
    )
  }

  try {
    return await response.json()
  } catch {
    throw new WatchSessionApiError('The server returned an unexpected watch session response.')
  }
}

function csrfJson(method: 'POST' | 'PUT', csrfToken: string, body: unknown): RequestInit {
  return {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-TOKEN': csrfToken,
    },
    body: JSON.stringify(body),
  }
}

export async function getWatchSessions(): Promise<WatchSessionSummary[]> {
  const payload = await requestJson('/api/watch-sessions')
  if (!Array.isArray(payload) || payload.length > 50 || !payload.every(isSessionSummary)) {
    throw new WatchSessionApiError('The server returned an unexpected watch session list.')
  }
  return payload
}

export async function getWatchSession(sessionId: string): Promise<WatchSession> {
  const payload = await requestJson(`/api/watch-sessions/${encodeURIComponent(sessionId)}`)
  if (!isWatchSession(payload) || payload.id !== sessionId) {
    throw new WatchSessionApiError('The server returned unexpected watch session details.')
  }
  return payload
}

export async function createWatchSession(
  name: string,
  postIds: string[],
  csrfToken: string,
): Promise<WatchSession> {
  const normalizedName = name.trim()
  if (normalizedName.length > MAX_WATCH_SESSION_NAME_LENGTH) {
    throw new WatchSessionApiError(
      `Session names must be no longer than ${MAX_WATCH_SESSION_NAME_LENGTH} characters.`,
      400,
    )
  }
  if (/[\u0000-\u001f\u007f-\u009f]/.test(normalizedName)) {
    throw new WatchSessionApiError('Session names cannot contain control characters.', 400)
  }
  if (
    postIds.length < 1 ||
    postIds.length > MAX_WATCH_SESSION_POSTS ||
    new Set(postIds).size !== postIds.length
  ) {
    throw new WatchSessionApiError('Select between 1 and 100 distinct posts.', 400)
  }
  const payload = await requestJson(
    '/api/watch-sessions',
    csrfJson('POST', csrfToken, { name: normalizedName || null, postIds }),
  )
  if (!isWatchSession(payload)) {
    throw new WatchSessionApiError('The server returned unexpected watch session details.')
  }
  return payload
}

export async function updateWatchSessionProgress(
  sessionId: string,
  currentPosition: number,
  csrfToken: string,
): Promise<WatchSession> {
  if (!Number.isSafeInteger(currentPosition) || currentPosition < 0) {
    throw new WatchSessionApiError('Session position must be a non-negative integer.', 400)
  }
  const payload = await requestJson(
    `/api/watch-sessions/${encodeURIComponent(sessionId)}/progress`,
    csrfJson('PUT', csrfToken, { currentPosition }),
  )
  if (!isWatchSession(payload) || payload.id !== sessionId) {
    throw new WatchSessionApiError('The server returned unexpected watch session details.')
  }
  return payload
}

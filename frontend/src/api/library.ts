export interface LibraryPost {
  id: string
  originalUrl: string
  savedAt: string
  favorite: boolean
}

export interface LibraryPage {
  items: LibraryPost[]
  page: number
  size: number
  totalElements: number
  totalPages: number
  hasNext: boolean
  hasPrevious: boolean
}

export class LibraryApiError extends Error {
  readonly status: number | null

  constructor(message: string, status: number | null = null) {
    super(message)
    this.name = 'LibraryApiError'
    this.status = status
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

function isInstagramUrl(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false
  }
  try {
    const url = new URL(value)
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      (url.hostname === 'instagram.com' || url.hostname.endsWith('.instagram.com')) &&
      url.username.length === 0 &&
      url.password.length === 0
    )
  } catch {
    return false
  }
}

function isLibraryPost(value: unknown): value is LibraryPost {
  return (
    isObject(value) &&
    typeof value.id === 'string' &&
    isInstagramUrl(value.originalUrl) &&
    typeof value.savedAt === 'string' &&
    Number.isFinite(Date.parse(value.savedAt)) &&
    typeof value.favorite === 'boolean'
  )
}

function isLibraryPage(value: unknown, expectedPage: number, expectedSize: number): value is LibraryPage {
  return (
    isObject(value) &&
    Array.isArray(value.items) &&
    value.items.length <= expectedSize &&
    value.items.every(isLibraryPost) &&
    value.page === expectedPage &&
    value.size === expectedSize &&
    isCount(value.totalElements) &&
    isCount(value.totalPages) &&
    typeof value.hasNext === 'boolean' &&
    typeof value.hasPrevious === 'boolean'
  )
}

async function getJson(path: string, options?: RequestInit): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(path, {
      ...options,
      method: options?.method ?? 'GET',
      credentials: 'include',
      cache: 'no-store',
    })
  } catch {
    throw new LibraryApiError('Could not connect to ReelNest. Check your connection and retry.')
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new LibraryApiError('Your session has expired. Sign in again to continue.', 401)
    }
    if (response.status === 404) {
      throw new LibraryApiError('This saved post is no longer available.', 404)
    }
    throw new LibraryApiError(
      response.status >= 500
        ? 'The library service is unavailable. Please try again.'
        : 'The library request could not be completed. Please retry.',
      response.status,
    )
  }

  try {
    return await response.json()
  } catch {
    throw new LibraryApiError('The server returned an unexpected library response.')
  }
}

export async function getLibraryPage(page: number, size = 20): Promise<LibraryPage> {
  const payload = await getJson(`/api/posts?page=${page}&size=${size}`)
  if (!isLibraryPage(payload, page, size)) {
    throw new LibraryApiError('The server returned an unexpected library response.')
  }
  return payload
}

export async function getLibraryPost(postId: string): Promise<LibraryPost> {
  const payload = await getJson(`/api/posts/${encodeURIComponent(postId)}`)
  if (!isLibraryPost(payload)) {
    throw new LibraryApiError('The server returned unexpected post details.')
  }
  return payload
}

export async function setLibraryPostFavorite(
  postId: string,
  favorite: boolean,
  csrfToken: string,
): Promise<LibraryPost> {
  const payload = await getJson(`/api/posts/${encodeURIComponent(postId)}/favorite`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-TOKEN': csrfToken,
    },
    body: JSON.stringify({ favorite }),
  })
  if (!isLibraryPost(payload) || payload.id !== postId || payload.favorite !== favorite) {
    throw new LibraryApiError('The server returned unexpected favorite details.')
  }
  return payload
}

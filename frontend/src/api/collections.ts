import type { LibraryPage, LibraryPost } from './library'

export interface UserCollection {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  postCount: number
}

export const MAX_COLLECTION_NAME_LENGTH = 80

export class CollectionApiError extends Error {
  readonly status: number | null

  constructor(message: string, status: number | null = null) {
    super(message)
    this.name = 'CollectionApiError'
    this.status = status
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

function isCollection(value: unknown): value is UserCollection {
  return (
    isObject(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    value.name.trim().length > 0 &&
    value.name.length <= MAX_COLLECTION_NAME_LENGTH &&
    typeof value.createdAt === 'string' &&
    Number.isFinite(Date.parse(value.createdAt)) &&
    typeof value.updatedAt === 'string' &&
    Number.isFinite(Date.parse(value.updatedAt)) &&
    isCount(value.postCount)
  )
}

function isCollectionList(value: unknown): value is UserCollection[] {
  return Array.isArray(value) && value.every(isCollection)
}

function isLibraryPost(value: unknown): value is LibraryPost {
  if (!isObject(value) || typeof value.originalUrl !== 'string') {
    return false
  }
  let url: URL
  try {
    url = new URL(value.originalUrl)
  } catch {
    return false
  }
  return (
    typeof value.id === 'string' &&
    (url.protocol === 'https:' || url.protocol === 'http:') &&
    (url.hostname === 'instagram.com' || url.hostname.endsWith('.instagram.com')) &&
    url.username.length === 0 &&
    url.password.length === 0 &&
    typeof value.savedAt === 'string' &&
    Number.isFinite(Date.parse(value.savedAt)) &&
    typeof value.favorite === 'boolean'
  )
}

function isLibraryPage(value: unknown, page: number, size: number): value is LibraryPage {
  return (
    isObject(value) &&
    Array.isArray(value.items) &&
    value.items.length <= size &&
    value.items.every(isLibraryPost) &&
    value.page === page &&
    value.size === size &&
    isCount(value.totalElements) &&
    isCount(value.totalPages) &&
    typeof value.hasNext === 'boolean' &&
    typeof value.hasPrevious === 'boolean'
  )
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
    throw new CollectionApiError('Could not connect to ReelNest. Check your connection and retry.')
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new CollectionApiError('Your session has expired. Sign in again to continue.', 401)
    }
    if (response.status === 403) {
      throw new CollectionApiError('Your session is no longer authorized. Sign in again to continue.', 403)
    }
    if (response.status === 404) {
      throw new CollectionApiError('The collection or saved post is no longer available.', 404)
    }
    if (response.status === 409) {
      throw new CollectionApiError('A collection with this name already exists.', 409)
    }
    if (response.status === 400) {
      throw new CollectionApiError(
        'Collection names are required and must be no longer than 80 characters.',
        400,
      )
    }
    throw new CollectionApiError(
      response.status >= 500
        ? 'The collection service is unavailable. Please try again.'
        : 'The collection request could not be completed. Please retry.',
      response.status,
    )
  }

  if (response.status === 204) {
    return null
  }

  try {
    return await response.json()
  } catch {
    throw new CollectionApiError('The server returned an unexpected collection response.')
  }
}

function validateCollectionList(payload: unknown): UserCollection[] {
  if (!isCollectionList(payload)) {
    throw new CollectionApiError('The server returned an unexpected collection response.')
  }
  return payload
}

function normalizeName(name: string): string {
  const normalized = name.trim()
  if (normalized.length === 0 || normalized.length > MAX_COLLECTION_NAME_LENGTH) {
    throw new CollectionApiError(
      'Collection names are required and must be no longer than 80 characters.',
      400,
    )
  }
  return normalized
}

function csrfJson(csrfToken: string, method: 'POST' | 'PUT', body?: string): RequestInit {
  return {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-TOKEN': csrfToken,
    },
    ...(body === undefined ? {} : { body }),
  }
}

export async function getCollections(): Promise<UserCollection[]> {
  return validateCollectionList(await requestJson('/api/collections'))
}

export async function createCollection(name: string, csrfToken: string): Promise<UserCollection> {
  const payload = await requestJson(
    '/api/collections',
    csrfJson(csrfToken, 'POST', JSON.stringify({ name: normalizeName(name) })),
  )
  if (!isCollection(payload)) {
    throw new CollectionApiError('The server returned an unexpected collection response.')
  }
  return payload
}

export async function updateCollection(
  collectionId: string,
  name: string,
  csrfToken: string,
): Promise<UserCollection> {
  const payload = await requestJson(
    `/api/collections/${encodeURIComponent(collectionId)}`,
    csrfJson(csrfToken, 'PUT', JSON.stringify({ name: normalizeName(name) })),
  )
  if (!isCollection(payload) || payload.id !== collectionId) {
    throw new CollectionApiError('The server returned an unexpected collection response.')
  }
  return payload
}

export async function deleteCollection(collectionId: string, csrfToken: string): Promise<void> {
  const payload = await requestJson(`/api/collections/${encodeURIComponent(collectionId)}`, {
    method: 'DELETE',
    headers: { 'X-CSRF-TOKEN': csrfToken },
  })
  if (payload !== null) {
    throw new CollectionApiError('The server returned an unexpected collection response.')
  }
}

export async function getCollectionPosts(
  collectionId: string,
  page: number,
  size = 20,
): Promise<LibraryPage> {
  const payload = await requestJson(
    `/api/collections/${encodeURIComponent(collectionId)}/posts?page=${page}&size=${size}`,
  )
  if (!isLibraryPage(payload, page, size)) {
    throw new CollectionApiError('The server returned an unexpected collection response.')
  }
  return payload
}

export async function getPostCollections(postId: string): Promise<UserCollection[]> {
  return validateCollectionList(
    await requestJson(`/api/posts/${encodeURIComponent(postId)}/collections`),
  )
}

export async function setPostCollection(
  postId: string,
  collectionId: string,
  assigned: boolean,
  csrfToken: string,
): Promise<UserCollection[]> {
  const path = `/api/posts/${encodeURIComponent(postId)}/collections/${encodeURIComponent(collectionId)}`
  const payload = await requestJson(path, {
    method: assigned ? 'PUT' : 'DELETE',
    headers: { 'X-CSRF-TOKEN': csrfToken },
  })
  const collections = validateCollectionList(payload)
  if (collections.some((collection) => collection.id === collectionId) !== assigned) {
    throw new CollectionApiError('The server returned an unexpected membership response.')
  }
  return collections
}

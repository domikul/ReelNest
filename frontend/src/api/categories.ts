export interface Category {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

export const MAX_CATEGORY_NAME_LENGTH = 80

export class CategoryApiError extends Error {
  readonly status: number | null

  constructor(message: string, status: number | null = null) {
    super(message)
    this.name = 'CategoryApiError'
    this.status = status
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

function isCategory(value: unknown): value is Category {
  return (
    isObject(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    value.name.trim().length > 0 &&
    value.name.length <= MAX_CATEGORY_NAME_LENGTH &&
    typeof value.createdAt === 'string' &&
    Number.isFinite(Date.parse(value.createdAt)) &&
    typeof value.updatedAt === 'string' &&
    Number.isFinite(Date.parse(value.updatedAt))
  )
}

function isCategoryList(value: unknown): value is Category[] {
  return Array.isArray(value) && value.every(isCategory)
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
    throw new CategoryApiError('Could not connect to ReelNest. Check your connection and retry.')
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new CategoryApiError('Your session has expired. Sign in again to continue.', 401)
    }
    if (response.status === 403) {
      throw new CategoryApiError('Your session is no longer authorized. Sign in again to continue.', 403)
    }
    if (response.status === 404) {
      throw new CategoryApiError('The post or category is no longer available.', 404)
    }
    if (response.status === 409) {
      throw new CategoryApiError('A category with this name already exists.', 409)
    }
    if (response.status === 400) {
      throw new CategoryApiError(
        'Category names are required and must be no longer than 80 characters.',
        400,
      )
    }
    throw new CategoryApiError(
      response.status >= 500
        ? 'The category service is unavailable. Please try again.'
        : 'The category request could not be completed. Please retry.',
      response.status,
    )
  }

  if (response.status === 204) {
    return null
  }

  try {
    return await response.json()
  } catch {
    throw new CategoryApiError('The server returned an unexpected category response.')
  }
}

function validateCategoryList(payload: unknown): Category[] {
  if (!isCategoryList(payload)) {
    throw new CategoryApiError('The server returned an unexpected category response.')
  }
  return payload
}

function validateCategory(payload: unknown): Category {
  if (!isCategory(payload)) {
    throw new CategoryApiError('The server returned an unexpected category response.')
  }
  return payload
}

function normalizeName(name: string): string {
  const normalized = name.trim()
  if (normalized.length === 0 || normalized.length > MAX_CATEGORY_NAME_LENGTH) {
    throw new CategoryApiError(
      'Category names are required and must be no longer than 80 characters.',
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

export async function getCategories(): Promise<Category[]> {
  return validateCategoryList(await requestJson('/api/categories'))
}

export async function createCategory(name: string, csrfToken: string): Promise<Category> {
  const payload = await requestJson(
    '/api/categories',
    csrfJson(csrfToken, 'POST', JSON.stringify({ name: normalizeName(name) })),
  )
  return validateCategory(payload)
}

export async function updateCategory(
  categoryId: string,
  name: string,
  csrfToken: string,
): Promise<Category> {
  const payload = await requestJson(
    `/api/categories/${encodeURIComponent(categoryId)}`,
    csrfJson(csrfToken, 'PUT', JSON.stringify({ name: normalizeName(name) })),
  )
  const category = validateCategory(payload)
  if (category.id !== categoryId) {
    throw new CategoryApiError('The server returned an unexpected category response.')
  }
  return category
}

export async function deleteCategory(categoryId: string, csrfToken: string): Promise<void> {
  const payload = await requestJson(`/api/categories/${encodeURIComponent(categoryId)}`, {
    method: 'DELETE',
    headers: { 'X-CSRF-TOKEN': csrfToken },
  })
  if (payload !== null) {
    throw new CategoryApiError('The server returned an unexpected category response.')
  }
}

export async function getPostCategories(postId: string): Promise<Category[]> {
  return validateCategoryList(
    await requestJson(`/api/posts/${encodeURIComponent(postId)}/categories`),
  )
}

export async function setPostCategory(
  postId: string,
  categoryId: string,
  assigned: boolean,
  csrfToken: string,
): Promise<Category[]> {
  const path = `/api/posts/${encodeURIComponent(postId)}/categories/${encodeURIComponent(categoryId)}`
  const payload = await requestJson(path, {
    method: assigned ? 'PUT' : 'DELETE',
    headers: { 'X-CSRF-TOKEN': csrfToken },
  })
  const categories = validateCategoryList(payload)
  if (categories.some((category) => category.id === categoryId) !== assigned) {
    throw new CategoryApiError('The server returned an unexpected assignment response.')
  }
  return categories
}

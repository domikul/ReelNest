export interface SessionStatus {
  authenticated: boolean
  username: string | null
}

export class AuthApiError extends Error {
  readonly status: number | null

  constructor(message: string, status: number | null = null) {
    super(message)
    this.name = 'AuthApiError'
    this.status = status
  }
}

async function requestJson(path: string, options?: RequestInit): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(path, {
      ...options,
      credentials: 'include',
      cache: 'no-store',
    })
  } catch {
    throw new AuthApiError('Could not connect to ReelNest. Check your connection and retry.')
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new AuthApiError('Your sign-in details were not accepted.', response.status)
    }
    if (response.status === 400 || response.status === 409) {
      try {
        const payload: unknown = await response.json()
        if (
          typeof payload === 'object' &&
          payload !== null &&
          'detail' in payload &&
          typeof payload.detail === 'string'
        ) {
          throw new AuthApiError(payload.detail, response.status)
        }
      } catch (cause) {
        if (cause instanceof AuthApiError) {
          throw cause
        }
      }
    }
    throw new AuthApiError(
      response.status >= 500
        ? 'The sign-in service is unavailable. Please try again.'
        : 'The sign-in request could not be completed. Please retry.',
      response.status,
    )
  }

  if (response.status === 204) {
    return null
  }

  try {
    return await response.json()
  } catch {
    throw new AuthApiError('The server returned an unexpected response. Please retry.')
  }
}

export async function getCsrfToken(): Promise<string> {
  const payload = await requestJson('/api/auth/csrf')
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('token' in payload) ||
    typeof payload.token !== 'string' ||
    payload.token.length === 0
  ) {
    throw new AuthApiError('The server returned an unexpected security token.')
  }
  return payload.token
}

export async function getSessionStatus(): Promise<SessionStatus> {
  const payload = await requestJson('/api/auth/session')
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('authenticated' in payload) ||
    typeof payload.authenticated !== 'boolean' ||
    !('username' in payload) ||
    (payload.username !== null && typeof payload.username !== 'string')
  ) {
    throw new AuthApiError('The server returned an unexpected session status.')
  }
  return { authenticated: payload.authenticated, username: payload.username }
}

export async function signIn(
  username: string,
  password: string,
  csrfToken: string,
): Promise<void> {
  const request = (token: string) =>
    requestJson('/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-TOKEN': token,
      },
      body: JSON.stringify({ username, password }),
    })
  await retryWithFreshCsrfToken(request, csrfToken)
}

export async function register(
  username: string,
  password: string,
  csrfToken: string,
): Promise<void> {
  const request = (token: string) =>
    requestJson('/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-TOKEN': token,
      },
      body: JSON.stringify({ username, password }),
    })
  await retryWithFreshCsrfToken(request, csrfToken)
}

export async function signOut(csrfToken: string): Promise<void> {
  const request = (token: string) =>
    requestJson('/api/auth/logout', {
      method: 'POST',
      headers: { 'X-CSRF-TOKEN': token },
    })
  await retryWithFreshCsrfToken(request, csrfToken)
}

async function retryWithFreshCsrfToken(
  request: (token: string) => Promise<unknown>,
  csrfToken: string,
): Promise<void> {
  try {
    await request(csrfToken)
  } catch (cause) {
    if (!(cause instanceof AuthApiError) || cause.status !== 403) {
      throw cause
    }
    await request(await getCsrfToken())
  }
}

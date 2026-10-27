import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const fetchMock = vi.fn<typeof fetch>()
let loggedIn = false
let activeUsername: string | null = null
let rejectLogin = false
let rejectRegistration = false
let rejectFirstLoginCsrf = false
let rejectImport = false
let csrfTokenSequence = ['synthetic-csrf-token']
let csrfTokenReads = 0

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('ReelNest application shell', () => {
  beforeEach(() => {
    window.localStorage.clear()
    delete document.documentElement.dataset.theme
    loggedIn = false
    activeUsername = null
    rejectLogin = false
    rejectRegistration = false
    rejectFirstLoginCsrf = false
    rejectImport = false
    csrfTokenSequence = ['synthetic-csrf-token']
    csrfTokenReads = 0
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (input) => {
      const path = String(input)
      if (path === '/api/auth/csrf') {
        const token = csrfTokenSequence[Math.min(csrfTokenReads, csrfTokenSequence.length - 1)]
        csrfTokenReads += 1
        return jsonResponse({ token })
      }
      if (path === '/api/auth/session') {
        return jsonResponse({ authenticated: loggedIn, username: activeUsername })
      }
      if (path === '/api/auth/login') {
        if (rejectFirstLoginCsrf) {
          rejectFirstLoginCsrf = false
          return jsonResponse({}, 403)
        }
        if (rejectLogin) {
          return jsonResponse({ detail: 'Sensitive backend message.' }, 401)
        }
        loggedIn = true
        activeUsername = 'test-user'
        return jsonResponse({ authenticated: true, username: 'test-user' })
      }
      if (path === '/api/auth/register') {
        if (rejectRegistration) {
          return jsonResponse({ detail: 'That username is already taken.' }, 409)
        }
        loggedIn = true
        activeUsername = 'new-user'
        return jsonResponse({ authenticated: true, username: 'new-user' }, 201)
      }
      if (path === '/api/auth/logout') {
        loggedIn = false
        activeUsername = null
        return new Response(null, { status: 204 })
      }
      if (path.startsWith('/api/posts?')) {
        return jsonResponse({
          items: [],
          page: 0,
          size: 20,
          totalElements: 0,
          totalPages: 0,
          hasNext: false,
          hasPrevious: false,
        })
      }
      if (path === '/api/imports' && rejectImport) {
        return jsonResponse({ detail: 'Sensitive backend message.' }, 401)
      }
      if (path === '/api/imports') {
        return jsonResponse({
          importId: 'synthetic-import-id',
          status: 'COMPLETED',
          addedCount: 1,
          updatedCount: 0,
          skippedCount: 0,
          errorCount: 0,
          errors: [],
          createdAt: '2026-10-25T12:00:00Z',
        }, 201)
      }
      return jsonResponse({}, 404)
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    cleanup()
  })

  it('renders the ReelNest welcome and sign-in state without exposing the import form', async () => {
    render(<App />)

    expect(
      screen.getByRole('heading', { name: 'Your saved reels. Finally at home.' }),
    ).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByLabelText('Username')).toBeInTheDocument()
    expect(screen.queryByLabelText(/Instagram saved_posts export/)).not.toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toHaveTextContent(
      'Import',
    )
  })

  it.each(['light', 'dark', 'system'] as const)(
    'applies and persists the %s theme',
    (theme) => {
      render(<App />)

      fireEvent.change(screen.getByRole('combobox', { name: 'Color theme' }), {
        target: { value: theme },
      })

      expect(document.documentElement).toHaveAttribute('data-theme', theme)
      expect(window.localStorage.getItem('reelnest-theme')).toBe(theme)
    },
  )

  it('restores a saved theme on startup', () => {
    window.localStorage.setItem('reelnest-theme', 'dark')

    render(<App />)

    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
  })

  it('signs in, displays the import flow, and signs out', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.type(await screen.findByLabelText('Username'), 'test-user')
    await user.type(screen.getByLabelText('Password'), 'synthetic-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByLabelText(/Instagram saved_posts export/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/login',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-TOKEN': 'synthetic-csrf-token',
        },
      }),
    )

    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/logout',
      expect.objectContaining({
        method: 'POST',
        headers: { 'X-CSRF-TOKEN': 'synthetic-csrf-token' },
      }),
    )
  })

  it('shows a safe sign-in error and allows retrying credentials', async () => {
    const user = userEvent.setup()
    rejectLogin = true
    render(<App />)

    await user.type(await screen.findByLabelText('Username'), 'test-user')
    await user.type(screen.getByLabelText('Password'), 'incorrect-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your sign-in details were not accepted.',
    )
    expect(screen.queryByText('Sensitive backend message.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled()
  })

  it('registers a new account and starts its private session', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'New to ReelNest? Create an account' }))
    await user.type(screen.getByLabelText('Username'), 'new-user')
    await user.type(screen.getByLabelText('Password'), 'a-long-test-password')
    await user.type(screen.getByLabelText('Confirm password'), 'a-long-test-password')
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByLabelText(/Instagram saved_posts export/)).toBeInTheDocument()
    expect(screen.getByText('new-user')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/register',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ username: 'new-user', password: 'a-long-test-password' }),
      }),
    )
  })

  it('requires matching passwords before sending a registration request', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'New to ReelNest? Create an account' }))
    await user.type(screen.getByLabelText('Username'), 'new-user')
    await user.type(screen.getByLabelText('Password'), 'a-long-test-password')
    await user.type(screen.getByLabelText('Confirm password'), 'different-password')
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Passwords do not match.')
    expect(fetchMock).not.toHaveBeenCalledWith('/api/auth/register', expect.anything())
  })

  it('displays a safe registration conflict and keeps the form available', async () => {
    const user = userEvent.setup()
    rejectRegistration = true
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'New to ReelNest? Create an account' }))
    await user.type(screen.getByLabelText('Username'), 'existing-user')
    await user.type(screen.getByLabelText('Password'), 'a-long-test-password')
    await user.type(screen.getByLabelText('Confirm password'), 'a-long-test-password')
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('That username is already taken.')
    expect(screen.getByRole('button', { name: 'Create account' })).toBeEnabled()
  })

  it('refreshes an expired CSRF token once before retrying sign-in', async () => {
    const user = userEvent.setup()
    csrfTokenSequence = ['stale-token', 'fresh-token', 'post-login-token']
    rejectFirstLoginCsrf = true
    render(<App />)

    await user.type(await screen.findByLabelText('Username'), 'test-user')
    await user.type(screen.getByLabelText('Password'), 'synthetic-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByLabelText(/Instagram saved_posts export/)).toBeInTheDocument()
    const loginCalls = fetchMock.mock.calls.filter(([url]) => url === '/api/auth/login')
    expect(loginCalls).toHaveLength(2)
    expect(loginCalls[0][1]?.headers).toEqual({
      'Content-Type': 'application/json',
      'X-CSRF-TOKEN': 'stale-token',
    })
    expect(loginCalls[1][1]?.headers).toEqual({
      'Content-Type': 'application/json',
      'X-CSRF-TOKEN': 'fresh-token',
    })
  })

  it('returns to sign-in when an import request reports an expired session', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.type(await screen.findByLabelText('Username'), 'test-user')
    await user.type(screen.getByLabelText('Password'), 'synthetic-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    rejectImport = true

    const file = new File(['synthetic'], 'saved_posts.html', { type: 'text/html' })
    await user.upload(await screen.findByLabelText(/Instagram saved_posts export/), file)
    await user.click(screen.getAllByRole('button', { name: 'Import saved posts' })[0])

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Your session expired. Sign in again to continue.',
    )
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.queryByText('Sensitive backend message.')).not.toBeInTheDocument()
  })
})

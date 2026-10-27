import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LibraryPost } from '../api/library'
import WatchSessionManager from './WatchSessionManager'

const fetchMock = vi.fn<typeof fetch>()
const csrfToken = 'synthetic-watch-session-csrf'
const firstPost: LibraryPost = {
  id: '00000000-0000-0000-0000-000000000101',
  originalUrl: 'https://www.instagram.com/p/synthetic-session-post-1/',
  savedAt: '2026-01-03T00:00:00Z',
  favorite: false,
  creatorUsername: null,
  caption: null,
}
const secondPost: LibraryPost = {
  id: '00000000-0000-0000-0000-000000000102',
  originalUrl: 'https://www.instagram.com/p/synthetic-session-post-2/',
  savedAt: '2026-01-02T00:00:00Z',
  favorite: false,
  creatorUsername: null,
  caption: null,
}
const sessionId = '00000000-0000-0000-0000-000000000201'

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function emptyResponse(): Response {
  return new Response(null, { status: 204 })
}

function session(
  currentPosition = 0,
  completedAt: string | null = null,
  posts: LibraryPost[] = [firstPost, secondPost],
) {
  return {
    id: sessionId,
    name: 'Synthetic session',
    createdAt: '2026-04-01T00:00:00Z',
    completedAt,
    postCount: posts.length,
    currentPosition,
    posts,
  }
}

function renderManager(
  onSessionExpired = vi.fn(),
  onBack = vi.fn(),
  onViewRecorded = vi.fn(),
  availablePosts: LibraryPost[] = [firstPost, secondPost],
) {
  render(
    <WatchSessionManager
      csrfToken={csrfToken}
      availablePosts={availablePosts}
      onBack={onBack}
      onSessionExpired={onSessionExpired}
      onViewRecorded={onViewRecorded}
    />,
  )
  return { onSessionExpired, onBack, onViewRecorded }
}

describe('watch sessions', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('shows empty states when no sessions or current-page posts are available', async () => {
    fetchMock.mockResolvedValue(jsonResponse([]))
    const user = userEvent.setup()
    const { onBack } = renderManager(vi.fn(), vi.fn(), vi.fn(), [])

    expect(await screen.findByText(/No posts are available on the current library page/))
      .toBeInTheDocument()
    expect(await screen.findByText(/No watch sessions yet/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back to library' }))
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('allows retrying a failed watch-session list request', async () => {
    let attempts = 0
    fetchMock.mockImplementation(async () => {
      attempts += 1
      return attempts === 1
        ? jsonResponse({ detail: 'Synthetic private response.' }, 503)
        : jsonResponse([])
    })
    const user = userEvent.setup()
    renderManager()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The watch session service is unavailable. Please try again.',
    )
    expect(screen.queryByText('Synthetic private response.')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry sessions' }))
    expect(await screen.findByText(/No watch sessions yet/)).toBeInTheDocument()
    expect(attempts).toBe(2)
  })

  it('creates a session from deliberate selections while preserving library order', async () => {
    fetchMock.mockImplementation(async (input, options) => {
      const path = String(input)
      if (path === '/api/watch-sessions' && options?.method === 'POST') {
        const request = JSON.parse(String(options.body)) as { postIds: string[]; name: string | null }
        return jsonResponse({
          ...session(0, null, request.postIds.map((id) =>
            id === firstPost.id ? firstPost : secondPost,
          )),
          name: request.name,
        }, 201)
      }
      if (path === '/api/posts/' + firstPost.id + '/view') {
        return emptyResponse()
      }
      if (path === '/api/watch-sessions') {
        return jsonResponse([])
      }
      return jsonResponse({ detail: 'Synthetic private response.' }, 404)
    })
    const user = userEvent.setup()
    const { onViewRecorded } = renderManager()

    await user.click(await screen.findByRole('checkbox', { name: /Post 2/ }))
    await user.click(screen.getByRole('checkbox', { name: /Post 1/ }))
    await user.type(screen.getByRole('textbox', { name: 'Session name (optional)' }), 'My set')
    await user.click(screen.getByRole('button', { name: 'Create session (2)' }))

    expect(await screen.findByRole('heading', { name: 'Post type unavailable' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/watch-sessions',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-TOKEN': csrfToken,
        },
        body: JSON.stringify({ name: 'My set', postIds: [firstPost.id, secondPost.id] }),
      }),
    )
    expect(await screen.findByText(/Post\s+1\s+of\s+2/)).toBeInTheDocument()
    await waitFor(() => expect(onViewRecorded).toHaveBeenCalledOnce())
  })

  it('resumes saved progress and records the resumed post in Recently Watched', async () => {
    fetchMock.mockImplementation(async (input) => {
      const path = String(input)
      if (path === '/api/watch-sessions') {
        return jsonResponse([{
          id: sessionId,
          name: 'Synthetic session',
          createdAt: '2026-04-01T00:00:00Z',
          completedAt: null,
          postCount: 2,
          currentPosition: 1,
        }])
      }
      if (path === `/api/watch-sessions/${sessionId}`) {
        return jsonResponse(session(1))
      }
      if (path === `/api/posts/${secondPost.id}/view`) {
        return emptyResponse()
      }
      return jsonResponse({ detail: 'Synthetic private response.' }, 404)
    })
    const user = userEvent.setup()
    const { onViewRecorded } = renderManager()

    await user.click(await screen.findByRole('button', { name: 'Resume session' }))

    expect(await screen.findByText(/Post\s+2\s+of\s+2/)).toBeInTheDocument()
    await waitFor(() => expect(onViewRecorded).toHaveBeenCalledOnce())
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/posts/${secondPost.id}/view`,
      expect.objectContaining({
        method: 'PUT',
        credentials: 'include',
        headers: { 'X-CSRF-TOKEN': csrfToken },
      }),
    )
  })

  it('persists manual progress, shows completion, and allows explicit review', async () => {
    let activePosition = 0
    fetchMock.mockImplementation(async (input, options) => {
      const path = String(input)
      if (path === '/api/watch-sessions' && options?.method === 'POST') {
        return jsonResponse(session(), 201)
      }
      if (path === '/api/watch-sessions') {
        return jsonResponse([])
      }
      if (path === `/api/watch-sessions/${sessionId}/progress` && options?.method === 'PUT') {
        activePosition = (JSON.parse(String(options.body)) as { currentPosition: number })
          .currentPosition
        return jsonResponse(session(
          activePosition,
          activePosition === 2 ? '2026-04-02T00:00:00Z' : null,
        ))
      }
      if (path === `/api/watch-sessions/${sessionId}`) {
        return jsonResponse(session(
          activePosition,
          activePosition === 2 ? '2026-04-02T00:00:00Z' : null,
        ))
      }
      if (path.endsWith('/view')) {
        return emptyResponse()
      }
      return jsonResponse({ detail: 'Synthetic private response.' }, 404)
    })
    const user = userEvent.setup()
    renderManager()

    await user.click(await screen.findByRole('checkbox', { name: /Post 1/ }))
    await user.click(screen.getByRole('checkbox', { name: /Post 2/ }))
    await user.click(screen.getByRole('button', { name: 'Create session (2)' }))
    await screen.findByText(/Post\s+1\s+of\s+2/)
    await user.click(screen.getByRole('button', { name: 'Next post' }))

    expect(await screen.findByText(/Post\s+2\s+of\s+2/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Previous post' }))
    expect(await screen.findByText(/Post\s+1\s+of\s+2/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next post' }))
    expect(await screen.findByText(/Post\s+2\s+of\s+2/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Complete session' }))
    expect(await screen.findByRole('heading', { name: 'Synthetic session is complete' }))
      .toBeInTheDocument()
    expect(screen.getByText(/No more posts will be played automatically/)).toBeInTheDocument()
    const progressWrites = fetchMock.mock.calls.filter(([url, options]) =>
      String(url).endsWith('/progress') && options?.method === 'PUT',
    )
    expect(progressWrites.map(([, options]) =>
      JSON.parse(String(options?.body)).currentPosition,
    )).toEqual([1, 0, 1, 2])

    await user.click(screen.getByRole('button', { name: 'Review this session' }))
    expect(await screen.findByText(/Post\s+1\s+of\s+2/)).toBeInTheDocument()
    expect(fetchMock.mock.calls.filter(([url, options]) =>
      String(url).endsWith('/progress') && options?.method === 'PUT',
    ).map(([, options]) => JSON.parse(String(options?.body)).currentPosition))
      .toEqual([1, 0, 1, 2, 0])
  })

  it('shows safe creation errors and retries without exposing server details', async () => {
    fetchMock.mockImplementation(async (input, options) =>
      String(input) === '/api/watch-sessions' && options?.method === 'POST'
        ? jsonResponse({ detail: 'Synthetic private response.' }, 503)
        : String(input) === '/api/watch-sessions'
          ? jsonResponse([])
          : jsonResponse([]),
    )
    const user = userEvent.setup()
    renderManager()

    await user.click(await screen.findByRole('checkbox', { name: /Post 1/ }))
    await user.click(screen.getByRole('button', { name: 'Create session (1)' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The watch session service is unavailable. Please try again.',
    )
    expect(screen.queryByText('Synthetic private response.')).not.toBeInTheDocument()
  })

  it('handles unauthorized session access through the existing sign-in flow', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({}, 401))
    const { onSessionExpired } = renderManager()

    await waitFor(() => expect(onSessionExpired).toHaveBeenCalledOnce())
  })

  it('does not move the viewer when saving manual progress fails', async () => {
    fetchMock.mockImplementation(async (input, options) => {
      const path = String(input)
      if (path === '/api/watch-sessions' && options?.method === 'POST') {
        return jsonResponse(session(), 201)
      }
      if (path === '/api/watch-sessions') {
        return jsonResponse([])
      }
      if (path.endsWith('/progress')) {
        return jsonResponse({ detail: 'Synthetic private response.' }, 503)
      }
      if (path.endsWith('/view')) {
        return emptyResponse()
      }
      return jsonResponse({ detail: 'Synthetic private response.' }, 404)
    })
    const user = userEvent.setup()
    renderManager()

    await user.click(await screen.findByRole('checkbox', { name: /Post 1/ }))
    await user.click(await screen.findByRole('checkbox', { name: /Post 2/ }))
    await user.click(screen.getByRole('button', { name: 'Create session (2)' }))
    await screen.findByText(/Post\s+1\s+of\s+2/)
    await user.click(screen.getByRole('button', { name: 'Next post' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Session progress could not be saved. Please retry.',
    )
    expect(screen.getByText(/Post\s+1\s+of\s+2/)).toBeInTheDocument()
  })
})

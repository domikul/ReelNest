import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LibraryView from './LibraryView'

const fetchMock = vi.fn<typeof fetch>()

const firstPost = {
  id: '00000000-0000-0000-0000-000000000001',
  originalUrl: 'https://www.instagram.com/p/synthetic-post-1/',
  savedAt: '2026-01-03T00:00:00Z',
}

const secondPost = {
  id: '00000000-0000-0000-0000-000000000002',
  originalUrl: 'https://www.instagram.com/p/synthetic-post-2/',
  savedAt: '2026-01-02T00:00:00Z',
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function libraryPage(
  items: typeof firstPost[],
  page = 0,
  totalElements = items.length,
  totalPages = totalElements === 0 ? 0 : 1,
) {
  return {
    items,
    page,
    size: 20,
    totalElements,
    totalPages,
    hasNext: page + 1 < totalPages,
    hasPrevious: page > 0,
  }
}

function renderLibrary(onSessionExpired = vi.fn(), onOpenImport = vi.fn()) {
  render(<LibraryView onSessionExpired={onSessionExpired} onOpenImport={onOpenImport} />)
  return { onSessionExpired, onOpenImport }
}

describe('protected paginated library', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('requests the next page from the server', async () => {
    fetchMock.mockImplementation(async (input) => {
      const path = String(input)
      return path.includes('page=1')
        ? jsonResponse(libraryPage([secondPost], 1, 2, 2))
        : jsonResponse(libraryPage([firstPost], 0, 2, 2))
    })
    const user = userEvent.setup()
    renderLibrary()

    expect(await screen.findByRole('button', { name: /Open saved post/ })).toBeInTheDocument()
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByText('Page 2 of 2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Open saved post from/ })).toBeInTheDocument()
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      '/api/posts?page=0&size=20',
      '/api/posts?page=1&size=20',
    ])
  })

  it('shows post details, a safe original link, and unavailable-metadata fallbacks', async () => {
    fetchMock.mockImplementation(async (input) =>
      String(input).startsWith('/api/posts?')
        ? jsonResponse(libraryPage([firstPost]))
        : jsonResponse(firstPost),
    )
    const user = userEvent.setup()
    renderLibrary()

    await user.click(await screen.findByRole('button', { name: /Open saved post/ }))

    expect(await screen.findByRole('heading', { name: 'Instagram post' })).toBeInTheDocument()
    expect(screen.getAllByText('Not available in this import')).toHaveLength(3)
    const originalLink = screen.getByRole('link', { name: /Open original Instagram post/ })
    expect(originalLink).toHaveAttribute('href', firstPost.originalUrl)
    expect(originalLink).toHaveAttribute('target', '_blank')
    expect(originalLink).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.getByLabelText('Post preview unavailable')).toHaveTextContent(
      'Preview unavailable',
    )
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/posts/${firstPost.id}`,
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    )
  })

  it('shows an empty-library state and offers the import flow', async () => {
    fetchMock.mockResolvedValue(jsonResponse(libraryPage([])))
    const user = userEvent.setup()
    const { onOpenImport } = renderLibrary()

    expect(await screen.findByRole('heading', { name: 'Your library is empty' }))
      .toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Import saved posts' }))
    expect(onOpenImport).toHaveBeenCalledOnce()
  })

  it('shows an out-of-range no-results state with a route back to page one', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(libraryPage([firstPost], 0, 21, 2)))
      .mockResolvedValueOnce(jsonResponse(libraryPage([], 1, 21, 2)))
      .mockResolvedValueOnce(jsonResponse(libraryPage([firstPost], 0, 21, 2)))
    const user = userEvent.setup()
    renderLibrary()
    await user.click(await screen.findByRole('button', { name: 'Next' }))
    await screen.findByRole('heading', { name: 'No posts on this page' })

    await user.click(screen.getByRole('button', { name: 'Return to the first page' }))
    expect(await screen.findByRole('button', { name: /Open saved post/ })).toBeInTheDocument()
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      '/api/posts?page=0&size=20',
      '/api/posts?page=1&size=20',
      '/api/posts?page=0&size=20',
    ])
  })

  it('reports safe load errors and allows retrying', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('Synthetic private response text.'))
      .mockResolvedValueOnce(jsonResponse(libraryPage([firstPost])))
    const user = userEvent.setup()
    renderLibrary()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not connect to ReelNest. Check your connection and retry.',
    )
    expect(screen.queryByText('Synthetic private response text.')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('button', { name: /Open saved post/ })).toBeInTheDocument()
  })

  it('returns to sign-in when the protected API reports an expired session', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ detail: 'Sensitive backend response.' }, 401),
    )
    const { onSessionExpired } = renderLibrary()

    expect(await screen.findByRole('heading', { name: 'Saved posts' })).toBeInTheDocument()
    expect(onSessionExpired).toHaveBeenCalledOnce()
    expect(screen.queryByText('Sensitive backend response.')).not.toBeInTheDocument()
  })

  it('rejects an unsafe URL from an unexpected API response', async () => {
    fetchMock.mockResolvedValue(jsonResponse(libraryPage([
      { ...firstPost, originalUrl: 'javascript:alert(1)' },
    ])))
    renderLibrary()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The server returned an unexpected library response.',
    )
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})

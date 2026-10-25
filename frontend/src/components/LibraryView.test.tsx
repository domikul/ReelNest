import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LibraryView from './LibraryView'

const fetchMock = vi.fn<typeof fetch>()

const firstPost = {
  id: '00000000-0000-0000-0000-000000000001',
  originalUrl: 'https://www.instagram.com/p/synthetic-post-1/',
  savedAt: '2026-01-03T00:00:00Z',
  favorite: false,
}

const secondPost = {
  id: '00000000-0000-0000-0000-000000000002',
  originalUrl: 'https://www.instagram.com/p/synthetic-post-2/',
  savedAt: '2026-01-02T00:00:00Z',
  favorite: false,
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
  render(
    <LibraryView
      csrfToken="synthetic-csrf-token"
      onSessionExpired={onSessionExpired}
      onOpenImport={onOpenImport}
    />,
  )
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
      if (path.startsWith('/api/posts?')) {
        return path.includes('page=1')
          ? jsonResponse(libraryPage([secondPost], 1, 2, 2))
          : jsonResponse(libraryPage([firstPost], 0, 2, 2))
      }
      return jsonResponse([])
    })
    const user = userEvent.setup()
    renderLibrary()

    expect(await screen.findByRole('button', { name: 'View post details' })).toBeInTheDocument()
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByText('Page 2 of 2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'View post details' })).toBeInTheDocument()
    expect(fetchMock.mock.calls.map(([url]) => String(url)).filter((path) => path.startsWith('/api/posts?'))).toEqual([
      '/api/posts?page=0&size=20',
      '/api/posts?page=1&size=20',
    ])
  })

  it('searches and filters on the server using the current query and filter values', async () => {
    const categoryId = '00000000-0000-0000-0000-000000000010'
    const collectionId = '00000000-0000-0000-0000-000000000020'
    fetchMock.mockImplementation(async (input) => {
      const path = String(input)
      if (path.startsWith('/api/posts?')) {
        return jsonResponse(libraryPage([secondPost]))
      }
      if (path === '/api/categories') {
        return jsonResponse([{
          id: categoryId,
          name: 'Synthetic category',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        }])
      }
      if (path === '/api/collections') {
        return jsonResponse([{
          id: collectionId,
          name: 'Synthetic collection',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          postCount: 1,
        }])
      }
      return jsonResponse([])
    })
    const user = userEvent.setup()
    renderLibrary()

    await screen.findByRole('button', { name: 'View post details' })
    await user.type(screen.getByRole('searchbox', { name: 'Search saved posts' }), 'wildflower')
    await user.click(screen.getByRole('button', { name: 'Search' }))
    await user.selectOptions(screen.getByLabelText('Favorite status'), 'favorites')
    await user.selectOptions(screen.getByLabelText('Category'), categoryId)
    await user.selectOptions(screen.getByLabelText('Collection'), collectionId)

    const postRequests = fetchMock.mock.calls
      .map(([url]) => String(url))
      .filter((path) => path.startsWith('/api/posts?'))
    const params = new URL(
      `http://localhost${postRequests[postRequests.length - 1] ?? ''}`,
    ).searchParams
    expect(params.get('q')).toBe('wildflower')
    expect(params.get('favorite')).toBe('true')
    expect(params.get('categoryId')).toBe(categoryId)
    expect(params.get('collectionId')).toBe(collectionId)
    expect(params.get('page')).toBe('0')
    expect(await screen.findByRole('button', { name: 'Clear search and filters' }))
      .toBeInTheDocument()
  })

  it('preserves the active search when requesting another server page', async () => {
    fetchMock.mockImplementation(async (input) => {
      const path = String(input)
      if (path.startsWith('/api/posts?')) {
        const params = new URL(`http://localhost${path}`).searchParams
        return params.get('page') === '1'
          ? jsonResponse(libraryPage([secondPost], 1, 21, 2))
          : jsonResponse(libraryPage([firstPost], 0, 21, 2))
      }
      return jsonResponse([])
    })
    const user = userEvent.setup()
    renderLibrary()

    await screen.findByRole('button', { name: 'View post details' })
    await user.type(screen.getByRole('searchbox', { name: 'Search saved posts' }), 'shoreline')
    await user.click(screen.getByRole('button', { name: 'Search' }))
    await user.click(await screen.findByRole('button', { name: 'Next' }))

    expect(await screen.findByText('Page 2 of 2')).toBeInTheDocument()
    const postRequests = fetchMock.mock.calls
      .map(([url]) => String(url))
      .filter((path) => path.startsWith('/api/posts?'))
    const params = new URL(
      `http://localhost${postRequests[postRequests.length - 1] ?? ''}`,
    ).searchParams
    expect(params.get('q')).toBe('shoreline')
    expect(params.get('page')).toBe('1')
  })

  it('distinguishes an empty search from an empty library and clears it', async () => {
    fetchMock.mockImplementation(async (input) => {
      const path = String(input)
      if (path.startsWith('/api/posts?')) {
        return jsonResponse(libraryPage([]))
      }
      return jsonResponse([])
    })
    const user = userEvent.setup()
    renderLibrary()

    await user.type(screen.getByRole('searchbox', { name: 'Search saved posts' }), 'missing')
    await user.click(screen.getByRole('button', { name: 'Search' }))

    expect(await screen.findByRole('heading', { name: 'No matching posts' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Your library is empty' })).not.toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: 'Clear search and filters' })[0])
    expect(await screen.findByRole('heading', { name: 'Your library is empty' })).toBeInTheDocument()
  })

  it('shows a safe validation error without submitting a punctuation-only search', async () => {
    fetchMock.mockImplementation(async (input) =>
      String(input).startsWith('/api/posts?')
        ? jsonResponse(libraryPage([]))
        : jsonResponse([]),
    )
    const user = userEvent.setup()
    renderLibrary()

    await user.type(screen.getByRole('searchbox', { name: 'Search saved posts' }), '!!!')
    await user.click(screen.getByRole('button', { name: 'Search' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Search must include letters or numbers',
    )
    expect(fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/posts?')))
      .toHaveLength(1)
  })

  it('shows post details, a safe original link, and unavailable-metadata fallbacks', async () => {
    fetchMock.mockImplementation(async (input) => {
      const path = String(input)
      if (path.startsWith('/api/posts?')) {
        return jsonResponse(libraryPage([firstPost]))
      }
      if (path.endsWith('/notes')) {
        return jsonResponse({ postId: firstPost.id, note: null, updatedAt: null })
      }
      if (path.endsWith('/categories')) {
        return jsonResponse([])
      }
      if (path.endsWith('/collections')) {
        return jsonResponse([])
      }
      return jsonResponse(firstPost)
    })
    const user = userEvent.setup()
    renderLibrary()

    await user.click(await screen.findByRole('button', { name: 'View post details' }))

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

  it('sets and removes favorite state from a card and from post details', async () => {
    let favorite = false
    fetchMock.mockImplementation(async (input, options) => {
      const path = String(input)
      if (path.startsWith('/api/posts?')) {
        return jsonResponse(libraryPage([{ ...firstPost, favorite }]))
      }
      if (path.endsWith('/favorite')) {
        favorite = JSON.parse(String(options?.body)).favorite
        return jsonResponse({ ...firstPost, favorite })
      }
      if (path.endsWith('/notes')) {
        return jsonResponse({ postId: firstPost.id, note: null, updatedAt: null })
      }
      if (path.endsWith('/categories')) {
        return jsonResponse([])
      }
      if (path.endsWith('/collections')) {
        return jsonResponse([])
      }
      return jsonResponse({ ...firstPost, favorite })
    })
    const user = userEvent.setup()
    renderLibrary()

    await user.click(await screen.findByRole('button', { name: 'Add to favorites' }))
    expect(await screen.findByRole('button', { name: 'Remove from favorites' }))
      .toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByRole('button', { name: 'View post details' }))
    expect(await screen.findByRole('heading', { name: 'Instagram post' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Remove from favorites' }))
    expect(await screen.findByRole('button', { name: 'Add to favorites' }))
      .toHaveAttribute('aria-pressed', 'false')

    await user.click(screen.getByRole('button', { name: 'Back to library' }))
    expect(await screen.findByRole('button', { name: 'Add to favorites' }))
      .toHaveAttribute('aria-pressed', 'false')

    const favoriteRequests = fetchMock.mock.calls.filter(
      ([url, options]) => String(url).endsWith('/favorite') && options?.method === 'PUT',
    )
    expect(favoriteRequests).toHaveLength(2)
    expect(favoriteRequests[0][1]).toEqual(expect.objectContaining({
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-TOKEN': 'synthetic-csrf-token',
      },
      body: '{"favorite":true}',
    }))
    expect(favoriteRequests[1][1]).toEqual(expect.objectContaining({
      body: '{"favorite":false}',
    }))
  })

  it('keeps the previous favorite state and allows retry when saving fails', async () => {
    fetchMock.mockImplementation(async (_input, options) => {
      if (options?.method === 'PUT') {
        return jsonResponse({ detail: 'Sensitive persistence failure.' }, 503)
      }
      const path = String(_input)
      if (path.startsWith('/api/posts?')) {
        return jsonResponse(libraryPage([firstPost]))
      }
      if (path.endsWith('/notes')) {
        return jsonResponse({ postId: firstPost.id, note: null, updatedAt: null })
      }
      if (path.endsWith('/categories')) {
        return jsonResponse([])
      }
      if (path.endsWith('/collections')) {
        return jsonResponse([])
      }
      return jsonResponse(firstPost)
    })
    const user = userEvent.setup()
    renderLibrary()

    await user.click(await screen.findByRole('button', { name: 'Add to favorites' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The library service is unavailable. Please try again.',
    )
    const favoriteButton = screen.getByRole('button', { name: 'Add to favorites' })
    expect(favoriteButton).toHaveAttribute('aria-pressed', 'false')
    expect(favoriteButton).toBeEnabled()
    expect(screen.queryByText('Sensitive persistence failure.')).not.toBeInTheDocument()
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

  it('opens the category manager from the library and returns to saved posts', async () => {
    fetchMock.mockImplementation(async (input) =>
      String(input).startsWith('/api/posts?')
        ? jsonResponse(libraryPage([]))
        : jsonResponse([]),
    )
    const user = userEvent.setup()
    renderLibrary()

    await user.click(await screen.findByRole('button', { name: 'Manage categories' }))
    expect(await screen.findByRole('heading', { name: 'Manage categories' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back to library' }))
    expect(await screen.findByRole('heading', { name: 'Saved posts' })).toBeInTheDocument()
  })

  it('opens the collection manager from the library and returns to saved posts', async () => {
    fetchMock.mockImplementation(async (input) =>
      String(input).startsWith('/api/posts?')
        ? jsonResponse(libraryPage([]))
        : jsonResponse([]),
    )
    const user = userEvent.setup()
    renderLibrary()

    await user.click(await screen.findByRole('button', { name: 'Manage collections' }))
    expect(await screen.findByRole('heading', { name: 'Manage collections' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back to library' }))
    expect(await screen.findByRole('heading', { name: 'Saved posts' })).toBeInTheDocument()
  })

  it('shows an out-of-range no-results state with a route back to page one', async () => {
    let pageRequest = 0
    const pages = [
      libraryPage([firstPost], 0, 21, 2),
      libraryPage([], 1, 21, 2),
      libraryPage([firstPost], 0, 21, 2),
    ]
    fetchMock.mockImplementation(async (input) => {
      if (String(input).startsWith('/api/posts?')) {
        return jsonResponse(pages[pageRequest++])
      }
      return jsonResponse([])
    })
    const user = userEvent.setup()
    renderLibrary()
    await user.click(await screen.findByRole('button', { name: 'Next' }))
    await screen.findByRole('heading', { name: 'No posts on this page' })

    await user.click(screen.getByRole('button', { name: 'Return to the first page' }))
    expect(await screen.findByRole('button', { name: 'View post details' })).toBeInTheDocument()
    expect(fetchMock.mock.calls.map(([url]) => String(url)).filter((path) => path.startsWith('/api/posts?'))).toEqual([
      '/api/posts?page=0&size=20',
      '/api/posts?page=1&size=20',
      '/api/posts?page=0&size=20',
    ])
  })

  it('reports safe load errors and allows retrying', async () => {
    let firstPageRequest = true
    fetchMock.mockImplementation(async (input) => {
      if (String(input).startsWith('/api/posts?')) {
        if (firstPageRequest) {
          firstPageRequest = false
          throw new Error('Synthetic private response text.')
        }
        return jsonResponse(libraryPage([firstPost]))
      }
      return jsonResponse([])
    })
    const user = userEvent.setup()
    renderLibrary()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not connect to ReelNest. Check your connection and retry.',
    )
    expect(screen.queryByText('Synthetic private response text.')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('button', { name: 'View post details' })).toBeInTheDocument()
  })

  it('returns to sign-in when the protected API reports an expired session', async () => {
    fetchMock.mockImplementation(async (input) =>
      String(input).startsWith('/api/posts?')
        ? jsonResponse({ detail: 'Sensitive backend response.' }, 401)
        : jsonResponse([]),
    )
    const { onSessionExpired } = renderLibrary()

    expect(await screen.findByRole('heading', { name: 'Saved posts' })).toBeInTheDocument()
    expect(onSessionExpired).toHaveBeenCalledOnce()
    expect(screen.queryByText('Sensitive backend response.')).not.toBeInTheDocument()
  })

  it('rejects an unsafe URL from an unexpected API response', async () => {
    fetchMock.mockImplementation(async (input) =>
      String(input).startsWith('/api/posts?')
        ? jsonResponse(libraryPage([
            { ...firstPost, originalUrl: 'javascript:alert(1)' },
          ]))
        : jsonResponse([]),
    )
    renderLibrary()

    expect(await screen.findByText('The server returned an unexpected library response.')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The server returned an unexpected library response.',
    )
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})

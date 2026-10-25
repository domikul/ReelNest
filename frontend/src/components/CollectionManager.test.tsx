import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CollectionManager from './CollectionManager'

const fetchMock = vi.fn<typeof fetch>()
const csrfToken = 'synthetic-csrf-token'
const collectionId = '00000000-0000-0000-0000-000000000021'

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function collection(id: string, name: string, postCount = 0) {
  return {
    id,
    name,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    postCount,
  }
}

const firstPost = {
  id: '00000000-0000-0000-0000-000000000031',
  originalUrl: 'https://www.instagram.com/p/synthetic-collection-post-1/',
  savedAt: '2026-01-01T00:00:00Z',
  favorite: false,
}
const secondPost = {
  id: '00000000-0000-0000-0000-000000000032',
  originalUrl: 'https://www.instagram.com/p/synthetic-collection-post-2/',
  savedAt: '2026-01-02T00:00:00Z',
  favorite: false,
}

function page(items: typeof firstPost[], pageIndex = 0, totalElements = items.length) {
  const size = 20
  const totalPages = totalElements === 0 ? 0 : Math.ceil(totalElements / size)
  return {
    items,
    page: pageIndex,
    size,
    totalElements,
    totalPages,
    hasNext: pageIndex + 1 < totalPages,
    hasPrevious: pageIndex > 0,
  }
}

function renderManager(onSessionExpired = vi.fn(), onBack = vi.fn(), onOpenPost = vi.fn()) {
  render(
    <CollectionManager
      csrfToken={csrfToken}
      onBack={onBack}
      onOpenPost={onOpenPost}
      onSessionExpired={onSessionExpired}
    />,
  )
  return { onSessionExpired, onBack, onOpenPost }
}

describe('collection management', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('creates, lists, renames, and deletes collections through authenticated API calls', async () => {
    const collections: ReturnType<typeof collection>[] = []
    fetchMock.mockImplementation(async (input, options) => {
      const path = String(input)
      if (path === '/api/collections' && options?.method === 'POST') {
        const created = collection(collectionId, JSON.parse(String(options.body)).name)
        collections.push(created)
        return jsonResponse(created, 201)
      }
      if (path === `/api/collections/${collectionId}` && options?.method === 'PUT') {
        collections[0] = collection(collectionId, JSON.parse(String(options.body)).name)
        return jsonResponse(collections[0])
      }
      if (path === `/api/collections/${collectionId}` && options?.method === 'DELETE') {
        collections.length = 0
        return new Response(null, { status: 204 })
      }
      return jsonResponse(collections)
    })
    const user = userEvent.setup()
    renderManager()

    expect(await screen.findByText('No collections yet. Create one to group saved posts.'))
      .toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: 'New collection name' }), 'Synthetic trip')
    await user.click(screen.getByRole('button', { name: 'Create collection' }))
    expect(await screen.findByText('Synthetic trip')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    const editInput = screen.getByRole('textbox', { name: 'Edit collection name' })
    await user.clear(editInput)
    await user.type(editInput, 'Updated trip')
    await user.click(screen.getByRole('button', { name: 'Save collection' }))
    expect(await screen.findByText('Updated trip')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Delete collection Updated trip' }))
    expect(await screen.findByText('No collections yet. Create one to group saved posts.'))
      .toBeInTheDocument()
    expect(fetchMock.mock.calls.filter(([, options]) =>
      options?.method === 'POST' || options?.method === 'PUT' || options?.method === 'DELETE',
    )
      .map(([, options]) => options?.method)).toEqual(['POST', 'PUT', 'DELETE'])
  })

  it('opens a collection, lists posts, removes a member, and opens post details', async () => {
    let posts = [firstPost, secondPost]
    fetchMock.mockImplementation(async (input, options) => {
      const path = String(input)
      if (path === '/api/collections') {
        return jsonResponse([collection(collectionId, 'Synthetic collection', posts.length)])
      }
      if (path.startsWith(`/api/collections/${collectionId}/posts?`)) {
        return jsonResponse(page(posts))
      }
      if (path.startsWith('/api/posts/') && options?.method === 'DELETE') {
        posts = posts.filter((post) => !path.includes(post.id))
        return jsonResponse([])
      }
      return jsonResponse([])
    })
    const user = userEvent.setup()
    const { onOpenPost } = renderManager()

    await user.click(await screen.findByRole('button', { name: 'View posts' }))
    const originalLinks = await screen.findAllByRole('link', { name: /Open original Instagram post/ })
    expect(originalLinks).toHaveLength(2)
    expect(originalLinks[0]).toHaveAttribute('href', firstPost.originalUrl)
    await user.click(screen.getAllByRole('button', { name: 'Remove from Synthetic collection' })[0])
    await waitFor(() =>
      expect(screen.getAllByRole('link', { name: /Open original Instagram post/ })).toHaveLength(1),
    )
    expect(screen.getByRole('link', { name: /Open original Instagram post/ }))
      .toHaveAttribute('href', secondPost.originalUrl)

    await user.click(screen.getByRole('button', { name: 'View post details' }))
    expect(onOpenPost).toHaveBeenCalledWith(secondPost.id)
    const removeRequest = fetchMock.mock.calls.find(([, options]) => options?.method === 'DELETE')
    expect(removeRequest?.[1]).toEqual(expect.objectContaining({
      credentials: 'include',
      headers: { 'X-CSRF-TOKEN': csrfToken },
    }))
  })

  it('shows clear validation feedback when a collection name is already used', async () => {
    fetchMock.mockImplementation(async (_input, options) =>
      options?.method === 'POST'
        ? jsonResponse({ detail: 'Synthetic private server response.' }, 409)
        : jsonResponse([]),
    )
    const user = userEvent.setup()
    renderManager()

    const nameInput = await screen.findByRole('textbox', { name: 'New collection name' })
    await user.type(nameInput, 'Duplicate collection')
    await user.click(screen.getByRole('button', { name: 'Create collection' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A collection with this name already exists.',
    )
    expect(screen.queryByText('Synthetic private server response.')).not.toBeInTheDocument()
    expect(nameInput).toHaveValue('Duplicate collection')
  })

  it('shows empty collection contents and safely retries collection-load errors', async () => {
    fetchMock.mockImplementation(async (input) => {
      const path = String(input)
      if (path === '/api/collections') {
        return jsonResponse([collection(collectionId, 'Empty collection')])
      }
      return jsonResponse(page([]))
    })
    const user = userEvent.setup()
    renderManager()
    await user.click(await screen.findByRole('button', { name: 'View posts' }))
    expect(await screen.findByText('This collection has no saved posts yet.'))
      .toBeInTheDocument()

    cleanup()
    fetchMock
      .mockRejectedValueOnce(new Error('Synthetic private response.'))
      .mockResolvedValueOnce(jsonResponse([]))
    renderManager()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not connect to ReelNest. Check your connection and retry.',
    )
    expect(screen.queryByText('Synthetic private response.')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('No collections yet. Create one to group saved posts.'))
      .toBeInTheDocument()
  })
})

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PostCollectionEditor from './PostCollectionEditor'

const fetchMock = vi.fn<typeof fetch>()
const postId = '00000000-0000-0000-0000-000000000001'
const csrfToken = 'synthetic-csrf-token'
const firstCollection = {
  id: '00000000-0000-0000-0000-000000000021',
  name: 'Synthetic one',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  postCount: 1,
}
const secondCollection = {
  id: '00000000-0000-0000-0000-000000000022',
  name: 'Synthetic two',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  postCount: 1,
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function renderEditor(onSessionExpired = vi.fn()) {
  render(
    <PostCollectionEditor
      postId={postId}
      csrfToken={csrfToken}
      onSessionExpired={onSessionExpired}
    />,
  )
  return onSessionExpired
}

describe('post collection memberships', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('shows memberships and adds or removes a post from multiple collections', async () => {
    let assigned = [firstCollection]
    fetchMock.mockImplementation(async (input, options) => {
      const path = String(input)
      if (path === '/api/collections') {
        return jsonResponse([firstCollection, secondCollection])
      }
      if (options?.method === 'PUT') {
        assigned = [...assigned, secondCollection]
      } else if (options?.method === 'DELETE') {
        assigned = assigned.filter((collection) => collection.id !== firstCollection.id)
      }
      return jsonResponse(assigned)
    })
    const user = userEvent.setup()
    renderEditor()

    expect(await screen.findByRole('checkbox', { name: 'Synthetic one' })).toBeChecked()
    const secondAssignment = screen.getByRole('checkbox', { name: 'Synthetic two' })
    expect(secondAssignment).not.toBeChecked()
    await user.click(secondAssignment)
    expect(await screen.findByRole('checkbox', { name: 'Synthetic two' })).toBeChecked()
    await user.click(screen.getByRole('checkbox', { name: 'Synthetic one' }))
    expect(await screen.findByRole('checkbox', { name: 'Synthetic one' })).not.toBeChecked()
    expect(screen.getByRole('list', { name: 'Assigned collections' }))
      .toHaveTextContent('Synthetic two')

    const mutationRequests = fetchMock.mock.calls.filter(
      ([, options]) => options?.method === 'PUT' || options?.method === 'DELETE',
    )
    expect(mutationRequests.map(([, options]) => options?.method)).toEqual(['PUT', 'DELETE'])
    expect(mutationRequests[0][1]).toEqual(expect.objectContaining({
      credentials: 'include',
      headers: { 'X-CSRF-TOKEN': csrfToken },
    }))
  })

  it('keeps membership unchanged and allows retry when saving fails', async () => {
    fetchMock.mockImplementation(async (input, options) => {
      const path = String(input)
      if (path === '/api/collections') {
        return jsonResponse([secondCollection])
      }
      if (options?.method === 'PUT') {
        return jsonResponse({ detail: 'Synthetic private response.' }, 503)
      }
      return jsonResponse([])
    })
    const user = userEvent.setup()
    renderEditor()
    const checkbox = await screen.findByRole('checkbox', { name: 'Synthetic two' })
    await user.click(checkbox)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The collection service is unavailable. Please try again.',
    )
    expect(checkbox).not.toBeChecked()
    expect(screen.queryByText('Synthetic private response.')).not.toBeInTheDocument()
    expect(checkbox).toBeEnabled()
  })

  it('returns to sign-in when collection access expires', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'Sensitive response.' }, 401))
    const onSessionExpired = renderEditor()

    expect(await screen.findByRole('heading', { name: 'Collections' })).toBeInTheDocument()
    expect(onSessionExpired).toHaveBeenCalledOnce()
    expect(screen.queryByText('Sensitive response.')).not.toBeInTheDocument()
  })
})

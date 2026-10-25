import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CategoryManager from './CategoryManager'

const fetchMock = vi.fn<typeof fetch>()
const csrfToken = 'synthetic-csrf-token'

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function category(id: string, name: string) {
  return {
    id,
    name,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }
}

function renderManager(onSessionExpired = vi.fn(), onBack = vi.fn()) {
  render(
    <CategoryManager
      csrfToken={csrfToken}
      onSessionExpired={onSessionExpired}
      onBack={onBack}
    />,
  )
  return { onSessionExpired, onBack }
}

describe('category management', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('creates, lists, renames, and deletes categories using the protected API', async () => {
    const categories: ReturnType<typeof category>[] = []
    fetchMock.mockImplementation(async (input, options) => {
      const path = String(input)
      if (path === '/api/categories' && options?.method === 'POST') {
        const created = category('category-1', JSON.parse(String(options.body)).name)
        categories.push(created)
        return jsonResponse(created, 201)
      }
      if (path === '/api/categories/category-1' && options?.method === 'PUT') {
        categories[0] = category('category-1', JSON.parse(String(options.body)).name)
        return jsonResponse(categories[0])
      }
      if (path === '/api/categories/category-1' && options?.method === 'DELETE') {
        categories.length = 0
        return new Response(null, { status: 204 })
      }
      return jsonResponse(categories)
    })
    const user = userEvent.setup()
    renderManager()

    expect(await screen.findByText('No categories yet. Create one to organize saved posts.'))
      .toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: 'New category name' }), 'Synthetic ideas')
    await user.click(screen.getByRole('button', { name: 'Create category' }))
    expect(await screen.findByText('Synthetic ideas')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    const editInput = screen.getByRole('textbox', { name: 'Edit category name' })
    await user.clear(editInput)
    await user.type(editInput, 'Updated ideas')
    await user.click(screen.getByRole('button', { name: 'Save category' }))
    expect(await screen.findByText('Updated ideas')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Delete category Updated ideas' }))
    expect(await screen.findByText('No categories yet. Create one to organize saved posts.'))
      .toBeInTheDocument()

    const mutatingRequests = fetchMock.mock.calls.filter(
      ([, options]) => options?.method && options.method !== 'GET',
    )
    expect(mutatingRequests.map(([, options]) => options?.method)).toEqual([
      'POST',
      'PUT',
      'DELETE',
    ])
    expect(mutatingRequests[0][1]).toEqual(expect.objectContaining({
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-TOKEN': csrfToken,
      },
      body: '{"name":"Synthetic ideas"}',
    }))
  })

  it('reports duplicate-name errors without exposing server response details', async () => {
    fetchMock.mockImplementation(async (_input, options) =>
      options?.method === 'POST'
        ? jsonResponse({ detail: 'Synthetic sensitive server detail.' }, 409)
        : jsonResponse([]),
    )
    const user = userEvent.setup()
    renderManager()
    await user.type(
      await screen.findByRole('textbox', { name: 'New category name' }),
      'Duplicate',
    )
    await user.click(screen.getByRole('button', { name: 'Create category' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A category with this name already exists.',
    )
    expect(screen.queryByText('Synthetic sensitive server detail.')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'New category name' })).toHaveValue('Duplicate')
  })

  it('retries a failed category load and expires unauthorized sessions', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('Synthetic private data.'))
      .mockResolvedValueOnce(jsonResponse([]))
    const user = userEvent.setup()
    renderManager()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not connect to ReelNest. Check your connection and retry.',
    )
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('No categories yet. Create one to organize saved posts.'))
      .toBeInTheDocument()

    cleanup()
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'Sensitive response.' }, 401))
    const { onSessionExpired } = renderManager()
    expect(await screen.findByRole('heading', { name: 'Manage categories' })).toBeInTheDocument()
    expect(onSessionExpired).toHaveBeenCalledOnce()
    expect(screen.queryByText('Sensitive response.')).not.toBeInTheDocument()
  })
})

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PostNoteEditor from './PostNoteEditor'

const fetchMock = vi.fn<typeof fetch>()
const postId = '00000000-0000-0000-0000-000000000001'
const csrfToken = 'synthetic-csrf-token'

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function noteResponse(note: string | null) {
  return {
    postId,
    note,
    updatedAt: note === null ? null : '2026-01-03T00:00:00Z',
  }
}

function renderEditor(onSessionExpired = vi.fn()) {
  render(
    <PostNoteEditor
      postId={postId}
      csrfToken={csrfToken}
      onSessionExpired={onSessionExpired}
    />,
  )
  return onSessionExpired
}

describe('personal post notes', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('creates, displays, edits, and removes a note through the authenticated API', async () => {
    let savedNote: string | null = null
    fetchMock.mockImplementation(async (_input, options) => {
      if (options?.method === 'PUT') {
        savedNote = JSON.parse(String(options.body)).note
        return jsonResponse(noteResponse(savedNote))
      }
      if (options?.method === 'DELETE') {
        savedNote = null
        return new Response(null, { status: 204 })
      }
      return jsonResponse(noteResponse(savedNote))
    })
    const user = userEvent.setup()
    renderEditor()

    expect(await screen.findByText('No personal note yet.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add note' }))
    const editor = screen.getByRole('textbox', { name: 'Your note' })
    await user.type(editor, '<b>synthetic note</b>')
    await user.click(screen.getByRole('button', { name: 'Save note' }))

    const savedText = await screen.findByText('<b>synthetic note</b>')
    expect(savedText.tagName).toBe('P')
    expect(savedText.querySelector('b')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Edit note' }))
    await user.clear(screen.getByRole('textbox', { name: 'Your note' }))
    await user.type(screen.getByRole('textbox', { name: 'Your note' }), 'updated synthetic note')
    await user.click(screen.getByRole('button', { name: 'Save note' }))
    expect(await screen.findByText('updated synthetic note')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Remove note' }))
    expect(await screen.findByText('No personal note yet.')).toBeInTheDocument()
    expect(savedNote).toBeNull()

    const noteRequests = fetchMock.mock.calls
      .filter(([url]) => String(url).endsWith('/notes'))
    expect(noteRequests.map(([, options]) => options?.method ?? 'GET')).toEqual([
      'GET',
      'PUT',
      'PUT',
      'DELETE',
    ])
    expect(noteRequests[1][1]).toEqual(expect.objectContaining({
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-TOKEN': csrfToken,
      },
    }))
  })

  it('keeps an unsaved note editable and allows retry after a save failure', async () => {
    let saveAttempts = 0
    fetchMock.mockImplementation(async (_input, options) => {
      if (options?.method === 'PUT' && saveAttempts++ === 0) {
        return jsonResponse({ detail: 'Synthetic private response text.' }, 503)
      }
      return jsonResponse(noteResponse(options?.method === 'PUT' ? 'retryable note' : null))
    })
    const user = userEvent.setup()
    renderEditor()

    await user.click(await screen.findByRole('button', { name: 'Add note' }))
    await user.type(screen.getByRole('textbox', { name: 'Your note' }), 'retryable note')
    await user.click(screen.getByRole('button', { name: 'Save note' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The library service is unavailable. Please try again.',
    )
    expect(screen.getByRole('textbox', { name: 'Your note' })).toHaveValue('retryable note')
    expect(screen.queryByText('Synthetic private response text.')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save note' }))
    expect(await screen.findByText('retryable note')).toBeInTheDocument()
  })

  it('blocks blank notes and returns to sign-in when the note API rejects the session', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'Sensitive response.' }, 401))
    const onSessionExpired = renderEditor()

    expect(await screen.findByRole('heading', { name: 'Personal note' })).toBeInTheDocument()
    expect(onSessionExpired).toHaveBeenCalledOnce()
    expect(screen.queryByText('Sensitive response.')).not.toBeInTheDocument()

    fetchMock.mockResolvedValue(jsonResponse(noteResponse(null)))
    cleanup()
    renderEditor()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Add note' }))
    await user.type(screen.getByRole('textbox', { name: 'Your note' }), '   ')
    expect(screen.getByRole('button', { name: 'Save note' })).toBeDisabled()
  })

  it('retries a failed note load without showing response contents', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('Synthetic private response text.'))
      .mockResolvedValueOnce(jsonResponse(noteResponse(null)))
    const user = userEvent.setup()
    renderEditor()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not connect to ReelNest. Check your connection and retry.',
    )
    expect(screen.queryByText('Synthetic private response text.')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry loading note' }))
    expect(await screen.findByText('No personal note yet.')).toBeInTheDocument()
  })
})

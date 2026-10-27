import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ImportPanel from './ImportPanel'

const fetchMock = vi.fn<typeof fetch>()

const partialSummary = {
  importId: '00000000-0000-0000-0000-000000000001',
  status: 'COMPLETED_WITH_ERRORS',
  addedCount: 4,
  updatedCount: 2,
  skippedCount: 3,
  errorCount: 1,
  errors: [
    {
      recordIndex: 8,
      code: 'invalid_post_url',
      message: 'This server message must not be displayed.',
    },
  ],
  createdAt: '2026-10-25T12:00:00Z',
}

function jsonResponse(payload: unknown, status = 201): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function savedPostsFile(name = 'saved_posts.html'): File {
  return new File(['<html><body></body></html>'], name, { type: 'text/html' })
}

async function selectFile(file = savedPostsFile()) {
  await userEvent.upload(screen.getByLabelText(/Instagram saved_posts export/), file)
  return file
}

function renderImportPanel(onSessionExpired = vi.fn(), onImportComplete = vi.fn()) {
  render(
    <ImportPanel
      csrfToken="test-csrf-token"
      onSessionExpired={onSessionExpired}
      onImportComplete={onImportComplete}
    />,
  )
  return onSessionExpired
}

describe('Instagram saved-post import flow', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('uploads the selected file and displays all summary counts and safe item errors', async () => {
    fetchMock.mockResolvedValue(jsonResponse(partialSummary))
    const onImportComplete = vi.fn()
    renderImportPanel(vi.fn(), onImportComplete)

    const file = await selectFile()
    await userEvent.click(screen.getByRole('button', { name: 'Import saved posts' }))

    expect(await screen.findByRole('heading', { name: 'Some entries need attention' }))
      .toBeInTheDocument()
    expect(screen.getByText('4', { selector: 'dd' })).toBeInTheDocument()
    expect(screen.getByText('Added')).toBeInTheDocument()
    expect(screen.getByText('Updated')).toBeInTheDocument()
    expect(screen.getByText('Skipped / duplicate')).toBeInTheDocument()
    expect(screen.getByText('Errors')).toBeInTheDocument()
    expect(screen.getByText('Updated').nextElementSibling).toHaveTextContent('2')
    expect(screen.getByText('Skipped / duplicate').nextElementSibling).toHaveTextContent('3')
    expect(screen.getByText('Errors').nextElementSibling).toHaveTextContent('1')
    expect(screen.getByText('Entry 8')).toBeInTheDocument()
    expect(screen.getByText('This entry has an invalid saved-post link.')).toBeInTheDocument()
    expect(screen.queryByText('This server message must not be displayed.')).not.toBeInTheDocument()

    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/imports')
    expect(options?.method).toBe('POST')
    expect(options?.headers).toEqual({ 'X-CSRF-TOKEN': 'test-csrf-token' })
    expect(options?.credentials).toBe('include')
    expect(options?.body).toBeInstanceOf(FormData)
    expect((options?.body as FormData).get('file')).toBe(file)
    expect((options?.body as FormData).get('timeZone')).toBe(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    )
    expect(onImportComplete).toHaveBeenCalledOnce()
  })

  it('rejects a non-HTML file before sending it', async () => {
    renderImportPanel()

    await selectFile(savedPostsFile('export.txt'))

    expect(screen.getByRole('alert')).toHaveTextContent('Choose a .html saved-post export.')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows a safe validation message for an unsupported backend response', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ detail: 'Unexpected response detail.' }, 422),
    )
    renderImportPanel()

    await selectFile()
    await userEvent.click(screen.getByRole('button', { name: 'Import saved posts' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This export format is not supported. Choose the saved_posts HTML export.',
    )
    expect(screen.queryByText('Unexpected response detail.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry import' })).toBeEnabled()
  })

  it('keeps the selected file after a network error and prevents duplicate retries', async () => {
    let resolveResponse: ((response: Response) => void) | undefined
    const pendingResponse = new Promise<Response>((resolve) => {
      resolveResponse = resolve
    })
    fetchMock
      .mockRejectedValueOnce(new Error('Untrusted network error text.'))
      .mockReturnValueOnce(pendingResponse)
    renderImportPanel()

    const file = await selectFile()
    await userEvent.click(screen.getByRole('button', { name: 'Import saved posts' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not connect to ReelNest. Check your connection and retry.',
    )
    expect(screen.getByText(new RegExp(file.name))).toBeInTheDocument()

    const retryButton = screen.getByRole('button', { name: 'Retry import' })
    await userEvent.click(retryButton)
    expect(retryButton).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('Uploading and checking your export')
    fireEvent.click(retryButton)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    await act(async () => {
      resolveResponse?.(jsonResponse({
        ...partialSummary,
        status: 'COMPLETED',
        addedCount: 1,
        updatedCount: 0,
        skippedCount: 0,
        errorCount: 0,
        errors: [],
      }))
      await pendingResponse
    })

    expect(await screen.findByRole('heading', { name: 'Your saved posts are ready' }))
      .toBeInTheDocument()
    expect(screen.queryByText(new RegExp(file.name))).not.toBeInTheDocument()
    expect(screen.queryByText('Untrusted network error text.')).not.toBeInTheDocument()
  })

  it('hands expired or invalidated sessions back to the sign-in flow', async () => {
    const onSessionExpired = renderImportPanel()
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'Private server detail.' }, 401))

    await selectFile()
    await userEvent.click(screen.getByRole('button', { name: 'Import saved posts' }))

    expect(onSessionExpired).toHaveBeenCalledOnce()
    expect(screen.queryByText('Private server detail.')).not.toBeInTheDocument()
  })
})

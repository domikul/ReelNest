import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import {
  deleteLibraryPostNote,
  getLibraryPostNote,
  LibraryApiError,
  MAX_NOTE_LENGTH,
  saveLibraryPostNote,
} from '../api/library'

interface PostNoteEditorProps {
  postId: string
  csrfToken: string
  onSessionExpired: () => void
}

function PostNoteEditor({ postId, csrfToken, onSessionExpired }: PostNoteEditorProps) {
  const [note, setNote] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState(0)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    setLoadError(null)

    getLibraryPostNote(postId)
      .then((result) => {
        if (active) {
          setNote(result.note)
          setDraft(result.note ?? '')
        }
      })
      .catch((cause: unknown) => {
        if (!active) {
          return
        }
        if (cause instanceof LibraryApiError && (cause.status === 401 || cause.status === 403)) {
          onSessionExpired()
          return
        }
        setLoadError(
          cause instanceof LibraryApiError
            ? cause.message
            : 'The personal note could not be loaded. Please retry.',
        )
      })
      .finally(() => {
        if (active) {
          setLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [postId, retryCount, onSessionExpired])

  function reportActionError(cause: unknown, fallback: string) {
    if (cause instanceof LibraryApiError && (cause.status === 401 || cause.status === 403)) {
      onSessionExpired()
      return
    }
    setActionError(cause instanceof LibraryApiError ? cause.message : fallback)
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || draft.trim().length === 0 || draft.length > MAX_NOTE_LENGTH) {
      return
    }
    setBusy(true)
    setActionError(null)
    try {
      const result = await saveLibraryPostNote(postId, draft, csrfToken)
      setNote(result.note)
      setDraft(result.note ?? '')
      setEditing(false)
    } catch (cause) {
      reportActionError(cause, 'The note could not be saved. Please retry.')
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove() {
    if (busy) {
      return
    }
    setBusy(true)
    setActionError(null)
    try {
      await deleteLibraryPostNote(postId, csrfToken)
      setNote(null)
      setDraft('')
    } catch (cause) {
      reportActionError(cause, 'The note could not be removed. Please retry.')
    } finally {
      setBusy(false)
    }
  }

  function cancelEditing() {
    setDraft(note ?? '')
    setEditing(false)
    setActionError(null)
  }

  const invalidDraft = draft.trim().length === 0 || draft.length > MAX_NOTE_LENGTH

  return (
    <section className="post-note" aria-labelledby="personal-note-title">
      <h3 id="personal-note-title">Personal note</h3>
      {loading && <p className="library-status" role="status">Loading note…</p>}
      {loadError && (
        <div className="note-error" role="alert">
          <p>{loadError}</p>
          <button
            className="secondary-button"
            type="button"
            onClick={() => setRetryCount((value) => value + 1)}
          >
            Retry loading note
          </button>
        </div>
      )}
      {actionError && <p className="note-error" role="alert">{actionError}</p>}
      {!loading && !loadError && !editing && note === null && (
        <div className="note-empty">
          <p>No personal note yet.</p>
          <button
            className="secondary-button"
            type="button"
            onClick={() => {
              setDraft('')
              setActionError(null)
              setEditing(true)
            }}
          >
            Add note
          </button>
        </div>
      )}
      {!loading && !loadError && !editing && note !== null && (
        <div className="note-saved">
          <p className="post-note-text">{note}</p>
          <div className="note-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                setDraft(note)
                setActionError(null)
                setEditing(true)
              }}
            >
              Edit note
            </button>
            <button
              className="text-button"
              type="button"
              disabled={busy}
              onClick={() => void handleRemove()}
            >
              {busy ? 'Removing…' : 'Remove note'}
            </button>
          </div>
        </div>
      )}
      {!loading && !loadError && editing && (
        <form className="note-form" onSubmit={(event) => void handleSave(event)}>
          <label htmlFor="personal-note-input">Your note</label>
          <textarea
            id="personal-note-input"
            value={draft}
            maxLength={MAX_NOTE_LENGTH}
            rows={5}
            aria-describedby="personal-note-guidance personal-note-count"
            onChange={(event) => setDraft(event.currentTarget.value)}
          />
          <p id="personal-note-guidance" className="note-guidance">
            Notes must contain text and be no longer than 5,000 characters.
          </p>
          <p id="personal-note-count" className="note-count" aria-live="polite">
            {draft.length} / {MAX_NOTE_LENGTH} characters
          </p>
          <div className="note-actions">
            <button className="secondary-button" type="submit" disabled={busy || invalidDraft}>
              {busy ? 'Saving…' : 'Save note'}
            </button>
            <button className="text-button" type="button" disabled={busy} onClick={cancelEditing}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  )
}

export default PostNoteEditor

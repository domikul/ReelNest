import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  WatchSessionApiError,
  createWatchSession,
  getWatchSession,
  getWatchSessions,
  MAX_WATCH_SESSION_NAME_LENGTH,
  MAX_WATCH_SESSION_POSTS,
  updateWatchSessionProgress,
} from '../api/watchSessions'
import type { WatchSession, WatchSessionSummary } from '../api/watchSessions'
import { LibraryApiError, recordPostView } from '../api/library'
import type { LibraryPost } from '../api/library'
import PostViewer from './PostViewer'

interface WatchSessionManagerProps {
  csrfToken: string
  availablePosts: LibraryPost[]
  onBack: () => void
  onSessionExpired: () => void
  onViewRecorded: () => void
}

function isSessionExpired(cause: unknown): boolean {
  return (
    (cause instanceof WatchSessionApiError || cause instanceof LibraryApiError) &&
    (cause.status === 401 || cause.status === 403)
  )
}

function getErrorMessage(cause: unknown, fallback: string): string {
  return cause instanceof WatchSessionApiError || cause instanceof LibraryApiError
    ? cause.message
    : fallback
}

function formatCreatedAt(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value))
}

function WatchSessionManager({
  csrfToken,
  availablePosts,
  onBack,
  onSessionExpired,
  onViewRecorded,
}: WatchSessionManagerProps) {
  const [sessions, setSessions] = useState<WatchSessionSummary[]>([])
  const [selectedPostIds, setSelectedPostIds] = useState<string[]>([])
  const [name, setName] = useState('')
  const [activeSession, setActiveSession] = useState<WatchSession | null>(null)
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [sessionsError, setSessionsError] = useState<string | null>(null)
  const [sessionsRetryCount, setSessionsRetryCount] = useState(0)
  const [creating, setCreating] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [openingSessionId, setOpeningSessionId] = useState<string | null>(null)
  const [viewTrackingError, setViewTrackingError] = useState<string | null>(null)
  const [viewRetryCount, setViewRetryCount] = useState(0)

  const orderedSelectedPosts = useMemo(
    () => availablePosts.filter((post) => selectedPostIds.includes(post.id)),
    [availablePosts, selectedPostIds],
  )
  const currentPost = activeSession && activeSession.currentPosition < activeSession.postCount
    ? activeSession.posts[activeSession.currentPosition]
    : null

  useEffect(() => {
    let active = true
    setSessionsLoading(true)
    setSessionsError(null)
    getWatchSessions()
      .then((result) => {
        if (active) {
          setSessions(result)
        }
      })
      .catch((cause: unknown) => {
        if (!active) {
          return
        }
        if (isSessionExpired(cause)) {
          onSessionExpired()
          return
        }
        setSessionsError(getErrorMessage(cause, 'Watch sessions could not be loaded. Please retry.'))
      })
      .finally(() => {
        if (active) {
          setSessionsLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [sessionsRetryCount, onSessionExpired])

  useEffect(() => {
    if (!activeSession || !currentPost) {
      return
    }
    let active = true
    setViewTrackingError(null)
    recordPostView(currentPost.id, csrfToken)
      .then(() => {
        if (active) {
          onViewRecorded()
        }
      })
      .catch((cause: unknown) => {
        if (!active) {
          return
        }
        if (isSessionExpired(cause)) {
          onSessionExpired()
          return
        }
        setViewTrackingError(getErrorMessage(
          cause,
          'This post could not be added to Recently Watched. Please retry.',
        ))
      })

    return () => {
      active = false
    }
  }, [
    activeSession?.id,
    activeSession?.currentPosition,
    csrfToken,
    currentPost?.id,
    onSessionExpired,
    onViewRecorded,
    viewRetryCount,
  ])

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (creating || orderedSelectedPosts.length === 0) {
      return
    }
    setCreating(true)
    setActionError(null)
    try {
      const session = await createWatchSession(
        name,
        orderedSelectedPosts.map((post) => post.id),
        csrfToken,
      )
      setSessions((existing) => [session, ...existing.filter((item) => item.id !== session.id)])
      setName('')
      setSelectedPostIds([])
      setActiveSession(session)
    } catch (cause) {
      if (isSessionExpired(cause)) {
        onSessionExpired()
      } else {
        setActionError(getErrorMessage(cause, 'The watch session could not be created. Please retry.'))
      }
    } finally {
      setCreating(false)
    }
  }

  async function handleOpenSession(sessionId: string) {
    if (openingSessionId !== null) {
      return
    }
    setOpeningSessionId(sessionId)
    setActionError(null)
    try {
      setActiveSession(await getWatchSession(sessionId))
    } catch (cause) {
      if (isSessionExpired(cause)) {
        onSessionExpired()
      } else {
        setActionError(getErrorMessage(cause, 'The watch session could not be opened. Please retry.'))
      }
    } finally {
      setOpeningSessionId(null)
    }
  }

  async function handleNavigatePost(postId: string) {
    if (!activeSession) {
      throw new Error('No watch session is open.')
    }
    const position = activeSession.posts.findIndex((post) => post.id === postId)
    if (position < 0 || Math.abs(position - activeSession.currentPosition) !== 1) {
      throw new Error('The requested post is not adjacent in this watch session.')
    }
    try {
      const updated = await updateWatchSessionProgress(activeSession.id, position, csrfToken)
      setActiveSession(updated)
      setSessions((existing) => existing.map((session) => session.id === updated.id
        ? {
            ...session,
            currentPosition: updated.currentPosition,
            completedAt: updated.completedAt,
          }
        : session))
    } catch (cause) {
      if (isSessionExpired(cause)) {
        onSessionExpired()
      }
      throw cause
    }
  }

  async function handleCompleteSession() {
    if (!activeSession) {
      throw new Error('No watch session is open.')
    }
    try {
      const updated = await updateWatchSessionProgress(
        activeSession.id,
        activeSession.postCount,
        csrfToken,
      )
      setActiveSession(updated)
      setSessions((existing) => existing.map((session) => session.id === updated.id
        ? {
            ...session,
            currentPosition: updated.currentPosition,
            completedAt: updated.completedAt,
          }
        : session))
    } catch (cause) {
      if (isSessionExpired(cause)) {
        onSessionExpired()
      }
      throw cause
    }
  }

  async function handleReviewSession() {
    if (!activeSession) {
      return
    }
    try {
      const updated = await updateWatchSessionProgress(activeSession.id, 0, csrfToken)
      setActiveSession(updated)
      setSessions((existing) => existing.map((session) => session.id === updated.id
        ? {
            ...session,
            currentPosition: updated.currentPosition,
            completedAt: updated.completedAt,
          }
        : session))
    } catch (cause) {
      if (isSessionExpired(cause)) {
        onSessionExpired()
      } else {
        setActionError(getErrorMessage(cause, 'Session progress could not be reset. Please retry.'))
      }
    }
  }

  if (activeSession && currentPost) {
    return (
      <section className="watch-session-player" aria-label="Watch session">
        {viewTrackingError && (
          <div className="library-error" role="alert">
            <p>{viewTrackingError}</p>
            <button
              className="secondary-button"
              type="button"
              onClick={() => setViewRetryCount((value) => value + 1)}
            >
              Retry view tracking
            </button>
          </div>
        )}
        <PostViewer
          post={currentPost}
          postType={null}
          creatorUsername={currentPost.creatorUsername}
          caption={currentPost.caption}
          navigationPostIds={activeSession.posts.map((post) => post.id)}
          onNavigatePost={handleNavigatePost}
          onComplete={handleCompleteSession}
          backLabel="Back to watch sessions"
          onBack={() => setActiveSession(null)}
        />
      </section>
    )
  }

  if (activeSession) {
    return (
      <section className="watch-session-manager" aria-labelledby="watch-session-complete-title">
        <button className="text-button" type="button" onClick={() => setActiveSession(null)}>
          Back to watch sessions
        </button>
        <p className="eyebrow">Session complete</p>
        <h2 id="watch-session-complete-title">
          {activeSession.name ?? 'Your watch session'} is complete
        </h2>
        <p>
          You viewed all {activeSession.postCount} selected posts. No more posts will be played
          automatically.
        </p>
        <div className="watch-session-actions">
          <button className="import-button" type="button" onClick={() => void handleReviewSession()}>
            Review this session
          </button>
          <button className="secondary-button" type="button" onClick={() => setActiveSession(null)}>
            Done
          </button>
        </div>
        {actionError && <p className="library-error" role="alert">{actionError}</p>}
      </section>
    )
  }

  return (
    <section className="watch-session-manager" aria-labelledby="watch-sessions-title">
      <button className="text-button" type="button" onClick={onBack}>
        Back to library
      </button>
      <div className="watch-session-heading">
        <div>
          <p className="eyebrow">Curated viewing</p>
          <h2 id="watch-sessions-title">Watch sessions</h2>
        </div>
      </div>
      {actionError && <p className="library-error" role="alert">{actionError}</p>}
      {availablePosts.length === 0 ? (
        <p className="watch-session-empty">
          No posts are available on the current library page. Return to the library and choose a
          page with saved posts to create a session.
        </p>
      ) : (
        <form className="watch-session-create" onSubmit={(event) => void handleCreate(event)}>
          <h3>Create a session from this library page</h3>
          <p>Selected posts keep their current library order. Choose at least one post.</p>
          <label htmlFor="watch-session-name">Session name (optional)</label>
          <input
            id="watch-session-name"
            value={name}
            maxLength={MAX_WATCH_SESSION_NAME_LENGTH}
            onChange={(event) => setName(event.currentTarget.value)}
          />
          <fieldset>
            <legend>Choose posts, in library order</legend>
            {availablePosts.map((post, index) => (
              <label className="watch-session-post-option" key={post.id}>
                <input
                  type="checkbox"
                  checked={selectedPostIds.includes(post.id)}
                  disabled={
                    !selectedPostIds.includes(post.id) &&
                    selectedPostIds.length >= MAX_WATCH_SESSION_POSTS
                  }
                  onChange={(event) => {
                    setSelectedPostIds((existing) => event.target.checked
                      ? [...existing, post.id]
                      : existing.filter((id) => id !== post.id))
                    setActionError(null)
                  }}
                />
                <span>Post {index + 1} · Saved {formatCreatedAt(post.savedAt)}</span>
              </label>
            ))}
          </fieldset>
          <button
            className="import-button"
            type="submit"
            disabled={creating || orderedSelectedPosts.length === 0}
          >
            {creating ? 'Creating session…' : `Create session (${orderedSelectedPosts.length})`}
          </button>
        </form>
      )}
      <div className="watch-session-list" aria-labelledby="watch-session-list-title">
        <h3 id="watch-session-list-title">Your saved sessions</h3>
        {sessionsLoading && <p className="library-status" role="status">Loading watch sessions…</p>}
        {sessionsError && (
          <div className="library-error" role="alert">
            <p>{sessionsError}</p>
            <button
              className="secondary-button"
              type="button"
              onClick={() => setSessionsRetryCount((value) => value + 1)}
            >
              Retry sessions
            </button>
          </div>
        )}
        {!sessionsLoading && !sessionsError && sessions.length === 0 && (
          <p className="watch-session-empty">No watch sessions yet. Select posts above to create one.</p>
        )}
        {!sessionsLoading && !sessionsError && sessions.length > 0 && (
          <ul className="watch-session-saved-list">
            {sessions.map((session) => {
              const isComplete = session.currentPosition === session.postCount
              return (
                <li className="watch-session-saved-item" key={session.id}>
                  <div>
                    <h4>{session.name ?? 'Untitled session'}</h4>
                    <p>
                      {isComplete
                        ? `Complete · ${session.postCount} posts`
                        : `Position ${session.currentPosition + 1} of ${session.postCount}`}
                      {' · Created '}
                      {formatCreatedAt(session.createdAt)}
                    </p>
                  </div>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={openingSessionId !== null}
                    onClick={() => void handleOpenSession(session.id)}
                  >
                    {openingSessionId === session.id
                      ? 'Opening…'
                      : isComplete
                        ? 'Revisit completed session'
                        : 'Resume session'}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}

export default WatchSessionManager

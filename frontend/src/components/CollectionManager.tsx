import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import {
  CollectionApiError,
  createCollection,
  deleteCollection,
  getCollectionPosts,
  getCollections,
  MAX_COLLECTION_NAME_LENGTH,
  setPostCollection,
  updateCollection,
} from '../api/collections'
import type { UserCollection } from '../api/collections'
import type { LibraryPage, LibraryPost } from '../api/library'

const collectionPageSize = 20

interface CollectionManagerProps {
  csrfToken: string
  onBack: () => void
  onOpenPost: (postId: string) => void
  onSessionExpired: () => void
}

function formatSavedDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value))
}

function CollectionManager({
  csrfToken,
  onBack,
  onOpenPost,
  onSessionExpired,
}: CollectionManagerProps) {
  const [collections, setCollections] = useState<UserCollection[]>([])
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null)
  const [collectionPosts, setCollectionPosts] = useState<LibraryPage | null>(null)
  const [page, setPage] = useState(0)
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [postsLoading, setPostsLoading] = useState(false)
  const [postsError, setPostsError] = useState<string | null>(null)
  const [postsActionError, setPostsActionError] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState(0)
  const [postsRetryCount, setPostsRetryCount] = useState(0)
  const [busy, setBusy] = useState(false)
  const [busyPostId, setBusyPostId] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setLoadError(null)

    getCollections()
      .then((result) => {
        if (active) {
          setCollections(result)
        }
      })
      .catch((cause: unknown) => {
        if (!active) {
          return
        }
        if (cause instanceof CollectionApiError && (cause.status === 401 || cause.status === 403)) {
          onSessionExpired()
          return
        }
        setLoadError(
          cause instanceof CollectionApiError
            ? cause.message
            : 'Collections could not be loaded. Please retry.',
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
  }, [retryCount, onSessionExpired])

  useEffect(() => {
    if (selectedCollectionId === null) {
      return
    }
    let active = true
    setPostsLoading(true)
    setPostsError(null)

    getCollectionPosts(selectedCollectionId, page, collectionPageSize)
      .then((result) => {
        if (active) {
          setCollectionPosts(result)
        }
      })
      .catch((cause: unknown) => {
        if (!active) {
          return
        }
        if (cause instanceof CollectionApiError && (cause.status === 401 || cause.status === 403)) {
          onSessionExpired()
          return
        }
        setPostsError(
          cause instanceof CollectionApiError
            ? cause.message
            : 'Posts in this collection could not be loaded. Please retry.',
        )
      })
      .finally(() => {
        if (active) {
          setPostsLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [selectedCollectionId, page, postsRetryCount, onSessionExpired])

  function reportActionError(cause: unknown, fallback: string) {
    if (cause instanceof CollectionApiError && (cause.status === 401 || cause.status === 403)) {
      onSessionExpired()
      return
    }
    setActionError(cause instanceof CollectionApiError ? cause.message : fallback)
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !newName.trim() || newName.trim().length > MAX_COLLECTION_NAME_LENGTH) {
      return
    }
    setBusy(true)
    setActionError(null)
    try {
      const collection = await createCollection(newName, csrfToken)
      setCollections((existing) =>
        [...existing, collection].sort((left, right) => left.name.localeCompare(right.name)),
      )
      setNewName('')
    } catch (cause) {
      reportActionError(cause, 'The collection could not be created. Please retry.')
    } finally {
      setBusy(false)
    }
  }

  function startEditing(collection: UserCollection) {
    setEditingId(collection.id)
    setEditingName(collection.name)
    setActionError(null)
  }

  async function handleUpdate(event: FormEvent<HTMLFormElement>, collectionId: string) {
    event.preventDefault()
    if (busy || !editingName.trim() || editingName.trim().length > MAX_COLLECTION_NAME_LENGTH) {
      return
    }
    setBusy(true)
    setActionError(null)
    try {
      const updated = await updateCollection(collectionId, editingName, csrfToken)
      setCollections((existing) =>
        existing
          .map((collection) => collection.id === collectionId ? updated : collection)
          .sort((left, right) => left.name.localeCompare(right.name)),
      )
      setEditingId(null)
      setEditingName('')
    } catch (cause) {
      reportActionError(cause, 'The collection could not be updated. Please retry.')
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(collectionId: string) {
    if (busy) {
      return
    }
    setBusy(true)
    setActionError(null)
    try {
      await deleteCollection(collectionId, csrfToken)
      setCollections((existing) => existing.filter((collection) => collection.id !== collectionId))
      if (editingId === collectionId) {
        setEditingId(null)
        setEditingName('')
      }
    } catch (cause) {
      reportActionError(cause, 'The collection could not be deleted. Please retry.')
    } finally {
      setBusy(false)
    }
  }

  async function handleRemovePost(post: LibraryPost) {
    if (selectedCollectionId === null || busyPostId !== null) {
      return
    }
    const collectionId = selectedCollectionId
    setBusyPostId(post.id)
    setPostsActionError(null)
    try {
      await setPostCollection(post.id, collectionId, false, csrfToken)
      setCollections((existing) =>
        existing.map((collection) => collection.id === collectionId
          ? { ...collection, postCount: Math.max(0, collection.postCount - 1) }
          : collection),
      )
      if (collectionPosts?.items.length === 1 && page > 0) {
        setPage((current) => current - 1)
      } else {
        setPostsRetryCount((current) => current + 1)
      }
    } catch (cause) {
      if (cause instanceof CollectionApiError && (cause.status === 401 || cause.status === 403)) {
        onSessionExpired()
      } else {
        setPostsActionError(
          cause instanceof CollectionApiError
            ? cause.message
            : 'The post could not be removed from this collection. Please retry.',
        )
      }
    } finally {
      setBusyPostId(null)
    }
  }

  const selectedCollection = collections.find(
    (collection) => collection.id === selectedCollectionId,
  )

  return (
    <section className="collection-manager" aria-labelledby="collection-manager-title">
      <button className="text-button" type="button" onClick={onBack}>
        Back to library
      </button>
      {selectedCollectionId === null ? (
        <>
          <div className="collection-heading">
            <div>
              <p className="eyebrow">Organize your library</p>
              <h2 id="collection-manager-title">Manage collections</h2>
            </div>
          </div>
          {loading && <p className="library-status" role="status">Loading collections…</p>}
          {loadError && (
            <div className="library-error" role="alert">
              <p>{loadError}</p>
              <button
                className="secondary-button"
                type="button"
                onClick={() => setRetryCount((value) => value + 1)}
              >
                Retry
              </button>
            </div>
          )}
          {actionError && <p className="collection-error" role="alert">{actionError}</p>}
          {!loading && !loadError && (
            <>
              <form className="collection-form" onSubmit={(event) => void handleCreate(event)}>
                <label htmlFor="new-collection-name">New collection name</label>
                <div className="collection-form-row">
                  <input
                    id="new-collection-name"
                    value={newName}
                    maxLength={MAX_COLLECTION_NAME_LENGTH}
                    onChange={(event) => setNewName(event.currentTarget.value)}
                  />
                  <button
                    className="secondary-button"
                    type="submit"
                    disabled={busy || !newName.trim()}
                  >
                    {busy ? 'Saving…' : 'Create collection'}
                  </button>
                </div>
                <p className="collection-help">
                  Names are limited to 80 characters and must be unique.
                </p>
              </form>
              {collections.length === 0 ? (
                <p className="collection-empty">
                  No collections yet. Create one to group saved posts.
                </p>
              ) : (
                <ul className="collection-list">
                  {collections.map((collection) => (
                    <li key={collection.id} className="collection-list-item">
                      {editingId === collection.id ? (
                        <form
                          className="collection-edit-form"
                          onSubmit={(event) => void handleUpdate(event, collection.id)}
                        >
                          <label
                            className="visually-hidden"
                            htmlFor={`edit-collection-${collection.id}`}
                          >
                            Edit collection name
                          </label>
                          <input
                            id={`edit-collection-${collection.id}`}
                            value={editingName}
                            maxLength={MAX_COLLECTION_NAME_LENGTH}
                            onChange={(event) => setEditingName(event.currentTarget.value)}
                          />
                          <button
                            className="secondary-button"
                            type="submit"
                            disabled={busy || !editingName.trim()}
                          >
                            {busy ? 'Saving…' : 'Save collection'}
                          </button>
                          <button
                            className="text-button"
                            type="button"
                            disabled={busy}
                            onClick={() => setEditingId(null)}
                          >
                            Cancel
                          </button>
                        </form>
                      ) : (
                        <>
                          <div className="collection-list-info">
                            <span className="collection-name">{collection.name}</span>
                            <span className="collection-count">
                              {collection.postCount} {collection.postCount === 1 ? 'post' : 'posts'}
                            </span>
                          </div>
                          <div className="collection-list-actions">
                            <button
                              className="text-button"
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                setPage(0)
                                setCollectionPosts(null)
                                setSelectedCollectionId(collection.id)
                                setPostsRetryCount((value) => value + 1)
                              }}
                            >
                              View posts
                            </button>
                            <button
                              className="text-button"
                              type="button"
                              disabled={busy}
                              onClick={() => startEditing(collection)}
                            >
                              Edit
                            </button>
                            <button
                              className="text-button collection-delete"
                              type="button"
                              disabled={busy}
                              aria-label={`Delete collection ${collection.name}`}
                              onClick={() => void handleDelete(collection.id)}
                            >
                              Delete
                            </button>
                          </div>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </>
      ) : (
        <>
          <div className="collection-heading">
            <div>
              <p className="eyebrow">Collection</p>
              <h2 id="collection-manager-title">{selectedCollection?.name ?? 'Saved posts'}</h2>
            </div>
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                setSelectedCollectionId(null)
                setCollectionPosts(null)
                setPostsError(null)
                setPostsActionError(null)
              }}
            >
              Back to collections
            </button>
          </div>
          {postsLoading && <p className="library-status" role="status">Loading collection posts…</p>}
          {postsError && (
            <div className="library-error" role="alert">
              <p>{postsError}</p>
              <button
                className="secondary-button"
                type="button"
                onClick={() => setPostsRetryCount((value) => value + 1)}
              >
                Retry
              </button>
            </div>
          )}
          {postsActionError && <p className="collection-error" role="alert">{postsActionError}</p>}
          {!postsLoading && !postsError && collectionPosts?.items.length === 0 && (
            <p className="collection-empty">This collection has no saved posts yet.</p>
          )}
          {!postsLoading && !postsError && collectionPosts && collectionPosts.items.length > 0 && (
            <>
              <ul className="collection-post-list">
                {collectionPosts.items.map((post) => (
                  <li key={post.id} className="collection-post-item">
                    <div className="collection-post-info">
                      <time dateTime={post.savedAt}>Saved {formatSavedDate(post.savedAt)}</time>
                      <a
                        href={post.originalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open original Instagram post
                        <span className="visually-hidden"> in a new tab</span>
                      </a>
                    </div>
                    <div className="collection-post-actions">
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() => onOpenPost(post.id)}
                      >
                        View post details
                      </button>
                      <button
                        className="text-button collection-delete"
                        type="button"
                        disabled={busyPostId !== null}
                        onClick={() => void handleRemovePost(post)}
                      >
                        {busyPostId === post.id
                          ? 'Removing…'
                          : `Remove from ${selectedCollection?.name ?? 'collection'}`}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              {collectionPosts.totalPages > 1 && (
                <nav className="pagination" aria-label="Collection pages">
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={!collectionPosts.hasPrevious}
                    onClick={() => setPage((value) => Math.max(0, value - 1))}
                  >
                    Previous
                  </button>
                  <span>Page {collectionPosts.page + 1} of {collectionPosts.totalPages}</span>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={!collectionPosts.hasNext}
                    onClick={() => setPage((value) => value + 1)}
                  >
                    Next
                  </button>
                </nav>
              )}
            </>
          )}
        </>
      )}
    </section>
  )
}

export default CollectionManager

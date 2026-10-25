import { useEffect, useState } from 'react'
import {
  CollectionApiError,
  getCollections,
  getPostCollections,
  setPostCollection,
} from '../api/collections'
import type { UserCollection } from '../api/collections'

interface PostCollectionEditorProps {
  postId: string
  csrfToken: string
  onSessionExpired: () => void
}

function PostCollectionEditor({
  postId,
  csrfToken,
  onSessionExpired,
}: PostCollectionEditorProps) {
  const [collections, setCollections] = useState<UserCollection[]>([])
  const [assigned, setAssigned] = useState<UserCollection[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState(0)
  const [busyCollectionId, setBusyCollectionId] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setLoadError(null)

    Promise.all([getCollections(), getPostCollections(postId)])
      .then(([allCollections, postCollections]) => {
        if (active) {
          setCollections(allCollections)
          setAssigned(postCollections)
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
  }, [postId, retryCount, onSessionExpired])

  async function handleMembership(collectionId: string, isAssigned: boolean) {
    if (busyCollectionId !== null) {
      return
    }
    setBusyCollectionId(collectionId)
    setActionError(null)
    try {
      const result = await setPostCollection(postId, collectionId, isAssigned, csrfToken)
      setAssigned(result)
    } catch (cause) {
      if (cause instanceof CollectionApiError && (cause.status === 401 || cause.status === 403)) {
        onSessionExpired()
      } else {
        setActionError(
          cause instanceof CollectionApiError
            ? cause.message
            : 'The collection membership could not be saved. Please retry.',
        )
      }
    } finally {
      setBusyCollectionId(null)
    }
  }

  const assignedIds = new Set(assigned.map((collection) => collection.id))

  return (
    <section className="post-collection-editor" aria-labelledby="post-collections-title">
      <h3 id="post-collections-title">Collections</h3>
      {loading && <p className="library-status" role="status">Loading collections…</p>}
      {loadError && (
        <div className="collection-error" role="alert">
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
      {!loading && !loadError && collections.length === 0 && (
        <p className="collection-empty">
          No collections yet. Create collections from the library to organize posts.
        </p>
      )}
      {!loading && !loadError && collections.length > 0 && (
        <>
          {assigned.length > 0 ? (
            <ul className="assigned-collection-list" aria-label="Assigned collections">
              {assigned.map((collection) => (
                <li key={collection.id}>{collection.name}</li>
              ))}
            </ul>
          ) : (
            <p className="collection-empty">This post is not in a collection yet.</p>
          )}
          <fieldset
            className="collection-assignment-list"
            disabled={busyCollectionId !== null}
          >
            <legend>Add to collections</legend>
            {collections.map((collection) => (
              <label key={collection.id} className="collection-assignment">
                <input
                  type="checkbox"
                  checked={assignedIds.has(collection.id)}
                  onChange={(event) => {
                    void handleMembership(collection.id, event.currentTarget.checked)
                  }}
                />
                <span>{collection.name}</span>
                {busyCollectionId === collection.id && <span role="status">Saving…</span>}
              </label>
            ))}
          </fieldset>
        </>
      )}
    </section>
  )
}

export default PostCollectionEditor

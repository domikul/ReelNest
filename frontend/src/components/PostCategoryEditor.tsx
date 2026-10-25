import { useEffect, useState } from 'react'
import {
  CategoryApiError,
  getCategories,
  getPostCategories,
  setPostCategory,
} from '../api/categories'
import type { Category } from '../api/categories'

interface PostCategoryEditorProps {
  postId: string
  csrfToken: string
  onSessionExpired: () => void
}

function PostCategoryEditor({
  postId,
  csrfToken,
  onSessionExpired,
}: PostCategoryEditorProps) {
  const [categories, setCategories] = useState<Category[]>([])
  const [assigned, setAssigned] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState(0)
  const [busyCategoryId, setBusyCategoryId] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setLoadError(null)

    Promise.all([getCategories(), getPostCategories(postId)])
      .then(([allCategories, postCategories]) => {
        if (active) {
          setCategories(allCategories)
          setAssigned(postCategories)
        }
      })
      .catch((cause: unknown) => {
        if (!active) {
          return
        }
        if (cause instanceof CategoryApiError && (cause.status === 401 || cause.status === 403)) {
          onSessionExpired()
          return
        }
        setLoadError(
          cause instanceof CategoryApiError
            ? cause.message
            : 'Categories could not be loaded. Please retry.',
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

  async function handleAssignment(categoryId: string, isAssigned: boolean) {
    if (busyCategoryId !== null) {
      return
    }
    setBusyCategoryId(categoryId)
    setActionError(null)
    try {
      const result = await setPostCategory(postId, categoryId, isAssigned, csrfToken)
      setAssigned(result)
    } catch (cause) {
      if (cause instanceof CategoryApiError && (cause.status === 401 || cause.status === 403)) {
        onSessionExpired()
      } else {
        setActionError(
          cause instanceof CategoryApiError
            ? cause.message
            : 'The category assignment could not be saved. Please retry.',
        )
      }
    } finally {
      setBusyCategoryId(null)
    }
  }

  const assignedIds = new Set(assigned.map((category) => category.id))

  return (
    <section className="post-category-editor" aria-labelledby="post-categories-title">
      <h3 id="post-categories-title">Categories</h3>
      {loading && <p className="library-status" role="status">Loading categories…</p>}
      {loadError && (
        <div className="category-error" role="alert">
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
      {actionError && <p className="category-error" role="alert">{actionError}</p>}
      {!loading && !loadError && categories.length === 0 && (
        <p className="category-empty">
          No categories yet. Create categories from the library to organize posts.
        </p>
      )}
      {!loading && !loadError && categories.length > 0 && (
        <>
          {assigned.length > 0 ? (
            <ul className="assigned-category-list" aria-label="Assigned categories">
              {assigned.map((category) => (
                <li key={category.id}>{category.name}</li>
              ))}
            </ul>
          ) : (
            <p className="category-empty">No categories assigned to this post.</p>
          )}
          <fieldset className="category-assignment-list" disabled={busyCategoryId !== null}>
            <legend>Assign categories</legend>
            {categories.map((category) => (
              <label key={category.id} className="category-assignment">
                <input
                  type="checkbox"
                  checked={assignedIds.has(category.id)}
                  onChange={(event) => {
                    void handleAssignment(category.id, event.currentTarget.checked)
                  }}
                />
                <span>{category.name}</span>
                {busyCategoryId === category.id && <span role="status">Saving…</span>}
              </label>
            ))}
          </fieldset>
        </>
      )}
    </section>
  )
}

export default PostCategoryEditor

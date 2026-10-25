import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import {
  CategoryApiError,
  createCategory,
  deleteCategory,
  getCategories,
  MAX_CATEGORY_NAME_LENGTH,
  updateCategory,
} from '../api/categories'
import type { Category } from '../api/categories'

interface CategoryManagerProps {
  csrfToken: string
  onBack: () => void
  onSessionExpired: () => void
}

function CategoryManager({ csrfToken, onBack, onSessionExpired }: CategoryManagerProps) {
  const [categories, setCategories] = useState<Category[]>([])
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState(0)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    setLoadError(null)

    getCategories()
      .then((result) => {
        if (active) {
          setCategories(result)
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
  }, [retryCount, onSessionExpired])

  function reportActionError(cause: unknown, fallback: string) {
    if (cause instanceof CategoryApiError && (cause.status === 401 || cause.status === 403)) {
      onSessionExpired()
      return
    }
    setActionError(cause instanceof CategoryApiError ? cause.message : fallback)
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !newName.trim() || newName.trim().length > MAX_CATEGORY_NAME_LENGTH) {
      return
    }
    setBusy(true)
    setActionError(null)
    try {
      const category = await createCategory(newName, csrfToken)
      setCategories((existing) =>
        [...existing, category].sort((left, right) => left.name.localeCompare(right.name)),
      )
      setNewName('')
    } catch (cause) {
      reportActionError(cause, 'The category could not be created. Please retry.')
    } finally {
      setBusy(false)
    }
  }

  function startEditing(category: Category) {
    setEditingId(category.id)
    setEditingName(category.name)
    setActionError(null)
  }

  async function handleUpdate(event: FormEvent<HTMLFormElement>, categoryId: string) {
    event.preventDefault()
    if (busy || !editingName.trim() || editingName.trim().length > MAX_CATEGORY_NAME_LENGTH) {
      return
    }
    setBusy(true)
    setActionError(null)
    try {
      const updated = await updateCategory(categoryId, editingName, csrfToken)
      setCategories((existing) =>
        existing
          .map((category) => category.id === categoryId ? updated : category)
          .sort((left, right) => left.name.localeCompare(right.name)),
      )
      setEditingId(null)
      setEditingName('')
    } catch (cause) {
      reportActionError(cause, 'The category could not be updated. Please retry.')
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(categoryId: string) {
    if (busy) {
      return
    }
    setBusy(true)
    setActionError(null)
    try {
      await deleteCategory(categoryId, csrfToken)
      setCategories((existing) => existing.filter((category) => category.id !== categoryId))
      if (editingId === categoryId) {
        setEditingId(null)
        setEditingName('')
      }
    } catch (cause) {
      reportActionError(cause, 'The category could not be deleted. Please retry.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="category-manager" aria-labelledby="categories-title">
      <button className="text-button" type="button" onClick={onBack}>
        Back to library
      </button>
      <div className="category-heading">
        <div>
          <p className="eyebrow">Organize your library</p>
          <h2 id="categories-title">Manage categories</h2>
        </div>
      </div>
      {loading && <p className="library-status" role="status">Loading categories…</p>}
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
      {actionError && <p className="category-error" role="alert">{actionError}</p>}
      {!loading && !loadError && (
        <>
          <form className="category-form" onSubmit={(event) => void handleCreate(event)}>
            <label htmlFor="new-category-name">New category name</label>
            <div className="category-form-row">
              <input
                id="new-category-name"
                value={newName}
                maxLength={MAX_CATEGORY_NAME_LENGTH}
                onChange={(event) => setNewName(event.currentTarget.value)}
              />
              <button
                className="secondary-button"
                type="submit"
                disabled={busy || !newName.trim()}
              >
                {busy ? 'Saving…' : 'Create category'}
              </button>
            </div>
            <p className="category-help">Names are limited to 80 characters and must be unique.</p>
          </form>
          {categories.length === 0 ? (
            <p className="category-empty">No categories yet. Create one to organize saved posts.</p>
          ) : (
            <ul className="category-list">
              {categories.map((category) => (
                <li key={category.id} className="category-list-item">
                  {editingId === category.id ? (
                    <form
                      className="category-edit-form"
                      onSubmit={(event) => void handleUpdate(event, category.id)}
                    >
                      <label className="visually-hidden" htmlFor={`edit-category-${category.id}`}>
                        Edit category name
                      </label>
                      <input
                        id={`edit-category-${category.id}`}
                        value={editingName}
                        maxLength={MAX_CATEGORY_NAME_LENGTH}
                        onChange={(event) => setEditingName(event.currentTarget.value)}
                      />
                      <button
                        className="secondary-button"
                        type="submit"
                        disabled={busy || !editingName.trim()}
                      >
                        {busy ? 'Saving…' : 'Save category'}
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
                      <span className="category-name">{category.name}</span>
                      <div className="category-list-actions">
                        <button
                          className="text-button"
                          type="button"
                          disabled={busy}
                          onClick={() => startEditing(category)}
                        >
                          Edit
                        </button>
                        <button
                          className="text-button category-delete"
                          type="button"
                          disabled={busy}
                          aria-label={`Delete category ${category.name}`}
                          onClick={() => void handleDelete(category.id)}
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
    </section>
  )
}

export default CategoryManager

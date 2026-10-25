import { useEffect, useState } from 'react'
import type { LibraryPage, LibraryPost } from '../api/library'
import {
  getLibraryPage,
  getLibraryPost,
  LibraryApiError,
  setLibraryPostFavorite,
} from '../api/library'
import FavoriteButton from './FavoriteButton'
import PostNoteEditor from './PostNoteEditor'
import CategoryManager from './CategoryManager'
import PostCategoryEditor from './PostCategoryEditor'
import CollectionManager from './CollectionManager'
import PostCollectionEditor from './PostCollectionEditor'

const pageSize = 20

interface LibraryViewProps {
  csrfToken: string
  onSessionExpired: () => void
  onOpenImport: () => void
}

function formatSavedDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value))
}

function SavedDate({ value }: { value: string }) {
  return <time dateTime={value}>Saved {formatSavedDate(value)}</time>
}

function PostDetails({
  postId,
  csrfToken,
  onBack,
  onFavoriteChanged,
  onSessionExpired,
}: {
  postId: string
  csrfToken: string
  onBack: () => void
  onFavoriteChanged: (post: LibraryPost) => void
  onSessionExpired: () => void
}) {
  const [post, setPost] = useState<LibraryPost | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState(0)
  const [favoriteBusy, setFavoriteBusy] = useState(false)
  const [favoriteError, setFavoriteError] = useState<string | null>(null)

  async function handleFavoriteToggle() {
    if (!post || favoriteBusy) {
      return
    }
    setFavoriteBusy(true)
    setFavoriteError(null)
    try {
      const updatedPost = await setLibraryPostFavorite(post.id, !post.favorite, csrfToken)
      setPost(updatedPost)
      onFavoriteChanged(updatedPost)
    } catch (cause) {
      if (cause instanceof LibraryApiError && (cause.status === 401 || cause.status === 403)) {
        onSessionExpired()
        return
      }
      setFavoriteError(
        cause instanceof LibraryApiError
          ? cause.message
          : 'Favorite could not be saved. Please retry.',
      )
    } finally {
      setFavoriteBusy(false)
    }
  }

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)

    getLibraryPost(postId)
      .then((result) => {
        if (active) {
          setPost(result)
        }
      })
      .catch((cause: unknown) => {
        if (!active) {
          return
        }
        if (cause instanceof LibraryApiError && cause.status === 401) {
          onSessionExpired()
          return
        }
        setError(
          cause instanceof LibraryApiError
            ? cause.message
            : 'Post details could not be loaded. Please retry.',
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

  return (
    <section className="post-details" aria-labelledby="post-details-title">
      <button className="text-button" type="button" onClick={onBack}>
        Back to library
      </button>
      {loading && <p className="library-status" role="status">Loading post details…</p>}
      {error && (
        <div className="library-error" role="alert">
          <p>{error}</p>
          <button className="secondary-button" type="button" onClick={() => setRetryCount((value) => value + 1)}>
            Retry
          </button>
        </div>
      )}
      {post && !loading && !error && (
        <article className="post-detail-card">
          <div
            className="post-preview post-detail-preview"
            role="img"
            aria-label="Post preview unavailable"
          >
            Preview unavailable
          </div>
          <div className="post-detail-content">
            <p className="eyebrow">Saved post</p>
            <h2 id="post-details-title">Instagram post</h2>
            <dl className="post-metadata">
              <div>
                <dt>Saved</dt>
                <dd><time dateTime={post.savedAt}>{formatSavedDate(post.savedAt)}</time></dd>
              </div>
              <div>
                <dt>Creator</dt>
                <dd>Not available in this import</dd>
              </div>
              <div>
                <dt>Caption</dt>
                <dd>Not available in this import</dd>
              </div>
              <div>
                <dt>Post type</dt>
                <dd>Not available in this import</dd>
              </div>
            </dl>
            <FavoriteButton
              favorite={post.favorite}
              busy={favoriteBusy}
              error={favoriteError}
              onToggle={() => void handleFavoriteToggle()}
            />
            <PostNoteEditor
              postId={post.id}
              csrfToken={csrfToken}
              onSessionExpired={onSessionExpired}
            />
            <PostCategoryEditor
              postId={post.id}
              csrfToken={csrfToken}
              onSessionExpired={onSessionExpired}
            />
            <PostCollectionEditor
              postId={post.id}
              csrfToken={csrfToken}
              onSessionExpired={onSessionExpired}
            />
            <a
              className="original-post-link"
              href={post.originalUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open original Instagram post
              <span className="visually-hidden"> in a new tab</span>
            </a>
          </div>
        </article>
      )}
    </section>
  )
}

function LibraryView({ csrfToken, onSessionExpired, onOpenImport }: LibraryViewProps) {
  const [page, setPage] = useState(0)
  const [libraryPage, setLibraryPage] = useState<LibraryPage | null>(null)
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null)
  const [managingCategories, setManagingCategories] = useState(false)
  const [managingCollections, setManagingCollections] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState(0)

  function handleFavoriteChanged(updatedPost: LibraryPost) {
    setLibraryPage((currentPage) =>
      currentPage
        ? {
            ...currentPage,
            items: currentPage.items.map((item) =>
              item.id === updatedPost.id ? updatedPost : item,
            ),
          }
        : currentPage,
    )
  }

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)

    getLibraryPage(page, pageSize)
      .then((result) => {
        if (active) {
          setLibraryPage(result)
        }
      })
      .catch((cause: unknown) => {
        if (!active) {
          return
        }
        if (cause instanceof LibraryApiError && cause.status === 401) {
          onSessionExpired()
          return
        }
        setError(
          cause instanceof LibraryApiError
            ? cause.message
            : 'Your library could not be loaded. Please retry.',
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
  }, [page, retryCount, onSessionExpired])

  return (
    <section
      className="library-section"
      id="library"
      aria-labelledby={
        selectedPostId
          ? 'post-details-title'
          : managingCategories
            ? 'categories-title'
            : managingCollections
              ? 'collection-manager-title'
              : 'library-title'
      }
    >
      {selectedPostId ? (
        <PostDetails
          postId={selectedPostId}
          csrfToken={csrfToken}
          onBack={() => setSelectedPostId(null)}
          onFavoriteChanged={handleFavoriteChanged}
          onSessionExpired={onSessionExpired}
        />
      ) : managingCategories ? (
        <CategoryManager
          csrfToken={csrfToken}
          onBack={() => setManagingCategories(false)}
          onSessionExpired={onSessionExpired}
        />
      ) : managingCollections ? (
        <CollectionManager
          csrfToken={csrfToken}
          onBack={() => setManagingCollections(false)}
          onOpenPost={setSelectedPostId}
          onSessionExpired={onSessionExpired}
        />
      ) : (
        <>
          <div className="library-heading">
            <div>
              <p className="eyebrow">Your library</p>
              <h2 id="library-title">Saved posts</h2>
            </div>
            <div className="library-heading-actions">
              {!loading && libraryPage && libraryPage.totalElements > 0 && (
                <p className="library-total">
                  {libraryPage.totalElements} {libraryPage.totalElements === 1 ? 'post' : 'posts'}
                </p>
              )}
              <button
                className="secondary-button"
                type="button"
                onClick={() => setManagingCategories(true)}
              >
                Manage categories
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => setManagingCollections(true)}
              >
                Manage collections
              </button>
            </div>
          </div>

          {loading && <p className="library-status" role="status">Loading your library…</p>}
          {error && (
            <div className="library-error" role="alert">
              <p>{error}</p>
              <button className="secondary-button" type="button" onClick={() => setRetryCount((value) => value + 1)}>
                Retry
              </button>
            </div>
          )}
          {!loading && !error && libraryPage?.totalElements === 0 && (
            <div className="library-empty">
              <h3>Your library is empty</h3>
              <p>Import your saved-post export to see posts here.</p>
              <button className="import-button" type="button" onClick={onOpenImport}>
                Import saved posts
              </button>
            </div>
          )}
          {!loading && !error && libraryPage && libraryPage.totalElements > 0 && libraryPage.items.length === 0 && (
            <div className="library-empty">
              <h3>No posts on this page</h3>
              <p>This page is outside the current library results.</p>
              <button className="secondary-button" type="button" onClick={() => setPage(0)}>
                Return to the first page
              </button>
            </div>
          )}
          {!loading && !error && libraryPage && libraryPage.items.length > 0 && (
            <>
              <div className="library-grid">
                {libraryPage.items.map((post) => (
                  <LibraryPostCard
                    key={post.id}
                    post={post}
                    csrfToken={csrfToken}
                    onOpen={() => setSelectedPostId(post.id)}
                    onFavoriteChanged={handleFavoriteChanged}
                    onSessionExpired={onSessionExpired}
                  />
                ))}
              </div>
              {libraryPage.totalPages > 1 && (
                <nav className="pagination" aria-label="Library pages">
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={!libraryPage.hasPrevious}
                    onClick={() => setPage((value) => Math.max(0, value - 1))}
                  >
                    Previous
                  </button>
                  <span>Page {libraryPage.page + 1} of {libraryPage.totalPages}</span>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={!libraryPage.hasNext}
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

function LibraryPostCard({
  post,
  csrfToken,
  onOpen,
  onFavoriteChanged,
  onSessionExpired,
}: {
  post: LibraryPost
  csrfToken: string
  onOpen: () => void
  onFavoriteChanged: (post: LibraryPost) => void
  onSessionExpired: () => void
}) {
  const [favoriteBusy, setFavoriteBusy] = useState(false)
  const [favoriteError, setFavoriteError] = useState<string | null>(null)

  async function handleFavoriteToggle() {
    if (favoriteBusy) {
      return
    }
    setFavoriteBusy(true)
    setFavoriteError(null)
    try {
      const updatedPost = await setLibraryPostFavorite(post.id, !post.favorite, csrfToken)
      onFavoriteChanged(updatedPost)
    } catch (cause) {
      if (cause instanceof LibraryApiError && (cause.status === 401 || cause.status === 403)) {
        onSessionExpired()
        return
      }
      setFavoriteError(
        cause instanceof LibraryApiError
          ? cause.message
          : 'Favorite could not be saved. Please retry.',
      )
    } finally {
      setFavoriteBusy(false)
    }
  }

  return (
    <article className="library-post-card">
      <div className="post-preview" aria-hidden="true">Preview unavailable</div>
      <div className="library-post-content">
        <SavedDate value={post.savedAt} />
        <h3>Instagram post</h3>
        <p>Caption and creator details are not available in this import.</p>
        <div className="library-post-actions">
          <button className="secondary-button" type="button" onClick={onOpen}>
            View post details
          </button>
          <FavoriteButton
            favorite={post.favorite}
            busy={favoriteBusy}
            error={favoriteError}
            onToggle={() => void handleFavoriteToggle()}
          />
        </div>
      </div>
    </article>
  )
}

export default LibraryView

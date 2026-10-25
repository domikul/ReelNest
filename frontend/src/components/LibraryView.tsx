import { useCallback, useEffect, useRef, useState } from 'react'
import type { LibraryPage, LibraryPost } from '../api/library'
import {
  getLibraryPage,
  getLibraryPost,
  getRecentlyWatchedPosts,
  LibraryApiError,
  recordPostView,
  setLibraryPostFavorite,
} from '../api/library'
import type { RecentlyWatchedPost } from '../api/library'
import { CategoryApiError, getCategories } from '../api/categories'
import type { Category } from '../api/categories'
import { CollectionApiError, getCollections } from '../api/collections'
import type { UserCollection } from '../api/collections'
import FavoriteButton from './FavoriteButton'
import PostNoteEditor from './PostNoteEditor'
import CategoryManager from './CategoryManager'
import PostCategoryEditor from './PostCategoryEditor'
import CollectionManager from './CollectionManager'
import PostCollectionEditor from './PostCollectionEditor'
import PostViewer from './PostViewer'

const pageSize = 20

function isValidSearchQuery(value: string): boolean {
  return (
    value.length <= 200 &&
    !/[\u0000-\u001f\u007f-\u009f]/.test(value) &&
    /[\p{L}\p{N}]/u.test(value)
  )
}

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

function RecentlyWatchedSection({
  onOpenPost,
  onSessionExpired,
  refreshKey,
}: {
  onOpenPost: (postId: string) => void
  onSessionExpired: () => void
  refreshKey: number
}) {
  const [posts, setPosts] = useState<RecentlyWatchedPost[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState(0)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)

    getRecentlyWatchedPosts()
      .then((result) => {
        if (active) {
          setPosts(result)
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
        setError(
          cause instanceof LibraryApiError
            ? cause.message
            : 'Recently watched posts could not be loaded. Please retry.',
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
  }, [refreshKey, retryCount, onSessionExpired])

  return (
    <section className="recently-watched-section" aria-labelledby="recently-watched-title">
      <div className="recently-watched-heading">
        <div>
          <p className="eyebrow">Your history</p>
          <h2 id="recently-watched-title">Recently watched</h2>
        </div>
        <p className="recently-watched-limit">Showing up to 8 posts</p>
      </div>
      {loading && <p className="library-status" role="status">Loading recently watched…</p>}
      {error && (
        <div className="library-error" role="alert">
          <p>{error}</p>
          <button
            className="secondary-button"
            type="button"
            onClick={() => setRetryCount((value) => value + 1)}
          >
            Retry recently watched
          </button>
        </div>
      )}
      {!loading && !error && posts?.length === 0 && (
        <div className="recently-watched-empty">
          <p>No posts watched yet. Open a post’s details to add it to your history.</p>
        </div>
      )}
      {!loading && !error && posts && posts.length > 0 && (
        <ol className="recently-watched-grid">
          {posts.map((post) => (
            <li key={post.id}>
              <article className="recently-watched-card">
                <div className="recently-watched-preview" aria-hidden="true">
                  Preview unavailable
                </div>
                <div className="recently-watched-content">
                  <h3>Instagram post</h3>
                  <time dateTime={post.lastViewedAt}>
                    Viewed {formatSavedDate(post.lastViewedAt)}
                  </time>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => onOpenPost(post.id)}
                  >
                    View recently watched post
                  </button>
                </div>
              </article>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function PostDetails({
  postId,
  csrfToken,
  onBack,
  onFavoriteChanged,
  onViewRecorded,
  onSessionExpired,
}: {
  postId: string
  csrfToken: string
  onBack: () => void
  onFavoriteChanged: (post: LibraryPost) => void
  onViewRecorded: () => void
  onSessionExpired: () => void
}) {
  const [post, setPost] = useState<LibraryPost | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState(0)
  const [favoriteBusy, setFavoriteBusy] = useState(false)
  const [favoriteError, setFavoriteError] = useState<string | null>(null)
  const [viewTrackingBusy, setViewTrackingBusy] = useState(true)
  const [viewTrackingError, setViewTrackingError] = useState<string | null>(null)
  const [viewRetryCount, setViewRetryCount] = useState(0)
  const [viewerOpen, setViewerOpen] = useState(false)

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

  useEffect(() => {
    let active = true
    setViewTrackingBusy(true)
    setViewTrackingError(null)

    recordPostView(postId, csrfToken)
      .then(() => {
        if (active) {
          onViewRecorded()
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
        setViewTrackingError(
          cause instanceof LibraryApiError
            ? cause.message
            : 'This view could not be added to your history. Please retry.',
        )
      })
      .finally(() => {
        if (active) {
          setViewTrackingBusy(false)
        }
      })

    return () => {
      active = false
    }
  }, [postId, csrfToken, viewRetryCount, onViewRecorded, onSessionExpired])

  if (post && viewerOpen) {
    return (
      <PostViewer
        post={post}
        postType={null}
        creatorUsername={null}
        caption={null}
        onBack={() => setViewerOpen(false)}
      />
    )
  }

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
      {viewTrackingBusy && <p className="library-status" role="status">Recording this view…</p>}
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
            <button
              className="secondary-button"
              type="button"
              onClick={() => setViewerOpen(true)}
            >
              Open post viewer
            </button>
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
  const [searchInput, setSearchInput] = useState('')
  const [searchError, setSearchError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [favoriteFilter, setFavoriteFilter] = useState<'all' | 'favorites' | 'not-favorites'>('all')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [collectionFilter, setCollectionFilter] = useState('')
  const [libraryPage, setLibraryPage] = useState<LibraryPage | null>(null)
  const [recentlyWatchedRefreshKey, setRecentlyWatchedRefreshKey] = useState(0)
  const [categories, setCategories] = useState<Category[]>([])
  const [collections, setCollections] = useState<UserCollection[]>([])
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null)
  const [managingCategories, setManagingCategories] = useState(false)
  const [managingCollections, setManagingCollections] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState(0)
  const [filterOptionsError, setFilterOptionsError] = useState<string | null>(null)
  const [filterOptionsRetryCount, setFilterOptionsRetryCount] = useState(0)
  const sessionExpiredHandled = useRef(false)
  const hasActiveFilters =
    query.length > 0 ||
    favoriteFilter !== 'all' ||
    categoryFilter.length > 0 ||
    collectionFilter.length > 0
  const handleViewRecorded = useCallback(() => {
    setRecentlyWatchedRefreshKey((value) => value + 1)
  }, [])

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

    getLibraryPage(page, pageSize, {
      query: query || undefined,
      favorite: favoriteFilter === 'all' ? undefined : favoriteFilter === 'favorites',
      categoryId: categoryFilter || undefined,
      collectionId: collectionFilter || undefined,
    })
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
          if (!sessionExpiredHandled.current) {
            sessionExpiredHandled.current = true
            onSessionExpired()
          }
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
  }, [
    page,
    query,
    favoriteFilter,
    categoryFilter,
    collectionFilter,
    retryCount,
    onSessionExpired,
  ])

  useEffect(() => {
    let active = true
    setFilterOptionsError(null)

    Promise.all([getCategories(), getCollections()])
      .then(([categoryList, collectionList]) => {
        if (active) {
          setCategories(categoryList)
          setCollections(collectionList)
        }
      })
      .catch((cause: unknown) => {
        if (!active) {
          return
        }
        if (
          (cause instanceof CategoryApiError || cause instanceof CollectionApiError) &&
          (cause.status === 401 || cause.status === 403)
        ) {
          if (!sessionExpiredHandled.current) {
            sessionExpiredHandled.current = true
            onSessionExpired()
          }
          return
        }
        setFilterOptionsError(
          'Search filters could not be loaded. Retry to use category and collection filters.',
        )
      })

    return () => {
      active = false
    }
  }, [filterOptionsRetryCount, onSessionExpired])

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
      {!selectedPostId && !managingCategories && !managingCollections && (
        <RecentlyWatchedSection
          onOpenPost={setSelectedPostId}
          onSessionExpired={onSessionExpired}
          refreshKey={recentlyWatchedRefreshKey}
        />
      )}
      {selectedPostId ? (
        <PostDetails
          postId={selectedPostId}
          csrfToken={csrfToken}
          onBack={() => setSelectedPostId(null)}
          onFavoriteChanged={handleFavoriteChanged}
          onViewRecorded={handleViewRecorded}
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

          <div className="library-search">
            <form
              className="library-search-form"
              role="search"
              onSubmit={(event) => {
                event.preventDefault()
                const normalizedQuery = searchInput.trim()
                if (normalizedQuery && !isValidSearchQuery(normalizedQuery)) {
                  setSearchError(
                    'Search must include letters or numbers, contain no control characters, '
                      + 'and be no longer than 200 characters.',
                  )
                  return
                }
                setSearchError(null)
                setPage(0)
                setQuery(normalizedQuery)
              }}
            >
              <label htmlFor="library-search-input">Search saved posts</label>
              <div className="library-search-row">
                <input
                  id="library-search-input"
                  type="search"
                  maxLength={200}
                  value={searchInput}
                  onChange={(event) => {
                    setSearchInput(event.target.value)
                    setSearchError(null)
                  }}
                />
                <button className="import-button" type="submit">Search</button>
              </div>
              {searchError && <p className="search-error" role="alert">{searchError}</p>}
            </form>
            <div className="library-filter-controls">
              <label>
                Favorite status
                <select
                  value={favoriteFilter}
                  onChange={(event) => {
                    const value = event.target.value
                    if (value !== 'all' && value !== 'favorites' && value !== 'not-favorites') {
                      return
                    }
                    setPage(0)
                    setFavoriteFilter(value)
                  }}
                >
                  <option value="all">All posts</option>
                  <option value="favorites">Favorites</option>
                  <option value="not-favorites">Not favorites</option>
                </select>
              </label>
              <label>
                Category
                <select
                  value={categoryFilter}
                  onChange={(event) => {
                    setPage(0)
                    setCategoryFilter(event.target.value)
                  }}
                  disabled={Boolean(filterOptionsError)}
                >
                  <option value="">All categories</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>{category.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Collection
                <select
                  value={collectionFilter}
                  onChange={(event) => {
                    setPage(0)
                    setCollectionFilter(event.target.value)
                  }}
                  disabled={Boolean(filterOptionsError)}
                >
                  <option value="">All collections</option>
                  {collections.map((collection) => (
                    <option key={collection.id} value={collection.id}>{collection.name}</option>
                  ))}
                </select>
              </label>
              {hasActiveFilters && (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => {
                    setPage(0)
                    setSearchInput('')
                    setQuery('')
                    setFavoriteFilter('all')
                    setCategoryFilter('')
                    setCollectionFilter('')
                  }}
                >
                  Clear search and filters
                </button>
              )}
            </div>
            {filterOptionsError && (
              <div className="filter-options-error" role="alert">
                <p>{filterOptionsError}</p>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setFilterOptionsRetryCount((value) => value + 1)}
                >
                  Retry filters
                </button>
              </div>
            )}
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
          {!loading && !error && libraryPage?.totalElements === 0 && !hasActiveFilters && (
            <div className="library-empty">
              <h3>Your library is empty</h3>
              <p>Import your saved-post export to see posts here.</p>
              <button className="import-button" type="button" onClick={onOpenImport}>
                Import saved posts
              </button>
            </div>
          )}
          {!loading && !error && libraryPage?.totalElements === 0 && hasActiveFilters && (
            <div className="library-empty">
              <h3>No matching posts</h3>
              <p>Try another search or clear the current filters.</p>
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  setPage(0)
                  setSearchInput('')
                  setQuery('')
                  setFavoriteFilter('all')
                  setCategoryFilter('')
                  setCollectionFilter('')
                }}
              >
                Clear search and filters
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

import type { LibraryPost } from '../api/library'

interface PostViewerProps {
  post: LibraryPost
  postType: string | null
  creatorUsername: string | null
  caption: string | null
  onBack: () => void
}

function describePostType(postType: string | null): {
  layout: 'video' | 'carousel' | 'image' | 'unknown'
  title: string
  unavailableMessage: string
} {
  switch (postType?.trim().toLowerCase()) {
    case 'reel':
    case 'video':
      return {
        layout: 'video',
        title: 'Reel / video',
        unavailableMessage: 'Video media is not available in this import. Playback is unavailable.',
      }
    case 'carousel':
      return {
        layout: 'carousel',
        title: 'Carousel',
        unavailableMessage: 'Carousel images were not included in this import.',
      }
    case 'image':
    case 'regular':
      return {
        layout: 'image',
        title: 'Image post',
        unavailableMessage: 'Image media is not available in this import.',
      }
    default:
      return {
        layout: 'unknown',
        title: 'Post type unavailable',
        unavailableMessage: 'This import does not include a known post type or viewable media.',
      }
  }
}

function formatSavedAt(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value))
}

function PostViewer({ post, postType, creatorUsername, caption, onBack }: PostViewerProps) {
  const mediaLayout = describePostType(postType)

  return (
    <section className="post-viewer" aria-labelledby="post-details-title">
      <button className="text-button" type="button" onClick={onBack}>
        Back to post details
      </button>
      <header className="post-viewer-heading">
        <p className="eyebrow">Single-post viewer</p>
        <h2 id="post-details-title">{mediaLayout.title}</h2>
      </header>
      <div
        className={`post-viewer-media post-viewer-media--${mediaLayout.layout}`}
        role="img"
        aria-label={mediaLayout.unavailableMessage}
      >
        <p>{mediaLayout.unavailableMessage}</p>
      </div>
      <dl className="post-viewer-metadata">
        <div>
          <dt>Creator</dt>
          <dd>{creatorUsername?.trim() || 'Not available in this import'}</dd>
        </div>
        <div>
          <dt>Caption</dt>
          <dd>{caption?.trim() || 'Not available in this import'}</dd>
        </div>
        <div>
          <dt>Saved</dt>
          <dd><time dateTime={post.savedAt}>{formatSavedAt(post.savedAt)}</time></dd>
        </div>
      </dl>
      <a
        className="original-post-link"
        href={post.originalUrl}
        target="_blank"
        rel="noopener noreferrer"
      >
        Open original Instagram post
        <span className="visually-hidden"> in a new tab</span>
      </a>
    </section>
  )
}

export default PostViewer

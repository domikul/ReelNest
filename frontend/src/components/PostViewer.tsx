import { useEffect, useRef, useState } from 'react'
import type { LibraryPost } from '../api/library'

interface PostViewerProps {
  post: LibraryPost
  postType: string | null
  creatorUsername: string | null
  caption: string | null
  onBack: () => void
}

type EmbedStatus = 'loading' | 'loaded' | 'unavailable'

const embedTimeoutMs = 12_000

function parseInstagramUrl(value: string): URL | null {
  try {
    const url = new URL(value)
    if (
      (url.protocol !== 'https:' && url.protocol !== 'http:') ||
      (url.hostname !== 'instagram.com' && !url.hostname.endsWith('.instagram.com')) ||
      url.username.length > 0 ||
      url.password.length > 0
    ) {
      return null
    }
    return url
  } catch {
    return null
  }
}

function getInstagramEmbedUrl(originalUrl: string): string | null {
  const url = parseInstagramUrl(originalUrl)
  if (
    !url ||
    (url.hostname !== 'instagram.com' && url.hostname !== 'www.instagram.com')
  ) {
    return null
  }

  const match = /^\/(p|reel)\/([A-Za-z0-9_-]{1,128})\/?$/i.exec(url.pathname)
  if (!match) {
    return null
  }
  const route = match[1].toLowerCase()
  const shortcode = match[2]
  return `https://www.instagram.com/${route}/${shortcode}/embed/`
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
  const originalUrl = parseInstagramUrl(post.originalUrl)?.href ?? null
  const embedUrl = getInstagramEmbedUrl(post.originalUrl)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [embedStatus, setEmbedStatus] = useState<EmbedStatus>(
    embedUrl ? 'loading' : 'unavailable',
  )

  useEffect(() => {
    if (!embedUrl) {
      setEmbedStatus('unavailable')
      return
    }

    setEmbedStatus('loading')
    const timeout = window.setTimeout(() => {
      setEmbedStatus((status) => status === 'loading' ? 'unavailable' : status)
    }, embedTimeoutMs)

    function handleFrameError() {
      setEmbedStatus('unavailable')
    }

    function handleSecurityPolicyViolation(event: SecurityPolicyViolationEvent) {
      const isFrameDirective = /^(frame-src|child-src|default-src)/.test(event.violatedDirective)
      let blockedInstagramContent = false
      try {
        const blockedUrl = new URL(event.blockedURI)
        blockedInstagramContent =
          blockedUrl.hostname === 'instagram.com' ||
          blockedUrl.hostname.endsWith('.instagram.com')
      } catch {
        blockedInstagramContent = false
      }
      if (isFrameDirective && blockedInstagramContent) {
        setEmbedStatus('unavailable')
      }
    }

    const iframe = iframeRef.current
    iframe?.addEventListener('error', handleFrameError)
    window.addEventListener('securitypolicyviolation', handleSecurityPolicyViolation)
    return () => {
      window.clearTimeout(timeout)
      iframe?.removeEventListener('error', handleFrameError)
      window.removeEventListener('securitypolicyviolation', handleSecurityPolicyViolation)
    }
  }, [embedUrl])

  return (
    <section className="post-viewer" aria-labelledby="post-details-title">
      <button className="text-button" type="button" onClick={onBack}>
        Back to post details
      </button>
      <header className="post-viewer-heading">
        <p className="eyebrow">Single-post viewer</p>
        <h2 id="post-details-title">{mediaLayout.title}</h2>
      </header>
      {embedUrl && embedStatus !== 'unavailable' ? (
        <div
          className={`post-viewer-media post-viewer-media--${mediaLayout.layout} post-viewer-embed`}
          aria-busy={embedStatus === 'loading'}
        >
          <iframe
            title={postType?.toLowerCase() === 'reel' || postType?.toLowerCase() === 'video'
              ? 'Instagram Reel embed'
              : 'Instagram post embed'}
            src={embedUrl}
            loading="lazy"
            referrerPolicy="no-referrer"
            sandbox="allow-scripts allow-same-origin"
            ref={iframeRef}
            onLoad={() => {
              setEmbedStatus((status) => status === 'unavailable' ? status : 'loaded')
            }}
          />
        </div>
      ) : (
        <div
          className={`post-viewer-media post-viewer-media--${mediaLayout.layout}`}
          role="img"
          aria-label={mediaLayout.unavailableMessage}
        >
          <p>{mediaLayout.unavailableMessage}</p>
        </div>
      )}
      {embedUrl && embedStatus === 'loading' && (
        <p className="viewer-embed-status" role="status">Loading the Instagram embed…</p>
      )}
      {embedUrl && embedStatus === 'loaded' && (
        <p className="viewer-embed-status" role="status">
          Embed request completed. If the post is not visible or is unavailable, open it on Instagram.
        </p>
      )}
      {embedUrl && embedStatus === 'unavailable' && (
        <p className="viewer-embed-status" role="status">
          The Instagram embed is unavailable or blocked. Open the original post on Instagram.
        </p>
      )}
      {!originalUrl && (
        <p className="viewer-embed-status" role="status">
          The original Instagram URL is unavailable, so an embed cannot be opened.
        </p>
      )}
      {originalUrl && !embedUrl && (
        <p className="viewer-embed-status" role="status">
          This Instagram URL does not support an embed.
        </p>
      )}
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
      <div className="viewer-original-fallback">
        <p>
          Instagram may restrict embeds or make a post unavailable. If the embed does not work,
          open the original post directly.
        </p>
        {originalUrl ? (
          <a
            className="original-post-link"
            href={originalUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open original on Instagram
            <span className="visually-hidden"> in a new tab</span>
          </a>
        ) : (
          <p>The original Instagram link is unavailable.</p>
        )}
      </div>
    </section>
  )
}

export default PostViewer

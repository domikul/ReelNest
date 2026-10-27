import { useEffect, useRef, useState } from 'react'
import {
  getInstagramEmbedUrl,
  getInstagramPostTitle,
  parseInstagramUrl,
} from '../utils/instagram'

type PreviewStatus = 'pending' | 'requested' | 'unavailable'

function InstagramPostPreview({ originalUrl }: { originalUrl: string }) {
  const embedUrl = getInstagramEmbedUrl(originalUrl)
  const safeOriginalUrl = parseInstagramUrl(originalUrl)?.href ?? null
  const title = getInstagramPostTitle(originalUrl)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [status, setStatus] = useState<PreviewStatus>(
    embedUrl ? 'pending' : 'unavailable',
  )

  useEffect(() => {
    setStatus(embedUrl ? 'pending' : 'unavailable')
    if (!embedUrl) {
      return
    }

    function handleFrameError() {
      setStatus('unavailable')
    }

    function handleSecurityPolicyViolation(event: SecurityPolicyViolationEvent) {
      if (!/^(frame-src|child-src|default-src)/.test(event.violatedDirective)) {
        return
      }

      try {
        const blockedUrl = new URL(event.blockedURI)
        if (
          blockedUrl.hostname === 'instagram.com' ||
          blockedUrl.hostname.endsWith('.instagram.com')
        ) {
          setStatus('unavailable')
        }
      } catch {
        return
      }
    }

    const iframe = iframeRef.current
    iframe?.addEventListener('error', handleFrameError)
    window.addEventListener('securitypolicyviolation', handleSecurityPolicyViolation)
    return () => {
      iframe?.removeEventListener('error', handleFrameError)
      window.removeEventListener('securitypolicyviolation', handleSecurityPolicyViolation)
    }
  }, [embedUrl])

  const previewUnavailable = status === 'unavailable'

  return (
    <>
      <div className={`post-preview${embedUrl && !previewUnavailable
        ? ' post-preview--instagram-embed'
        : ''}`}
      >
        {embedUrl && !previewUnavailable ? (
          <iframe
            ref={iframeRef}
            title={`${title} preview`}
            src={embedUrl}
            loading="lazy"
            referrerPolicy="no-referrer"
            scrolling="no"
            sandbox="allow-scripts allow-same-origin"
            onLoad={() => setStatus('requested')}
            onError={() => setStatus('unavailable')}
          />
        ) : (
          <p>Instagram preview unavailable</p>
        )}
      </div>
      <div className="post-preview-footer">
        <p className="post-preview-status" role="status">
          {!safeOriginalUrl
            ? 'A safe Instagram preview is not available for this URL.'
            : !embedUrl
              ? 'This Instagram URL does not support an embed.'
              : previewUnavailable
                ? 'The Instagram preview is unavailable or blocked.'
                : status === 'requested'
                  ? 'Instagram responded to the preview request. If the post is not visible, open the original.'
                  : 'The Instagram preview loads when this card nears the screen.'}
        </p>
        {safeOriginalUrl && (
          <a
            className="post-preview-link"
            href={safeOriginalUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open original on Instagram
            <span className="visually-hidden"> in a new tab</span>
          </a>
        )}
      </div>
    </>
  )
}

export default InstagramPostPreview

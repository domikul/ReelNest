import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LibraryPost } from '../api/library'
import PostViewer from './PostViewer'

const post: LibraryPost = {
  id: '00000000-0000-0000-0000-000000000001',
  originalUrl: 'https://www.instagram.com/explore/',
  savedAt: '2026-01-03T00:00:00Z',
  favorite: false,
}

describe('single-post viewer layouts', () => {
  afterEach(() => {
    cleanup()
  })

  it.each([
    ['reel', 'Reel / video', 'Video media is not available in this import. Playback is unavailable.'],
    ['video', 'Reel / video', 'Video media is not available in this import. Playback is unavailable.'],
    ['carousel', 'Carousel', 'Carousel images were not included in this import.'],
    ['image', 'Image post', 'Image media is not available in this import.'],
    ['regular', 'Image post', 'Image media is not available in this import.'],
  ])('shows the %s layout and a clear missing-media fallback', (postType, title, fallback) => {
    render(
      <PostViewer
        post={post}
        postType={postType}
        creatorUsername={null}
        caption={null}
        onBack={vi.fn()}
      />,
    )

    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: fallback })).toHaveTextContent(fallback)
    expect(screen.getAllByText('Not available in this import')).toHaveLength(2)
  })

  it('uses an explicit fallback for unknown types without implying playback', () => {
    render(
      <PostViewer
        post={post}
        postType="unexpected"
        creatorUsername={null}
        caption={null}
        onBack={vi.fn()}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Post type unavailable' })).toBeInTheDocument()
    expect(screen.getByRole('img', {
      name: 'This import does not include a known post type or viewable media.',
    })).toHaveTextContent('This import does not include a known post type or viewable media.')
    expect(screen.queryByRole('button', { name: /play/i })).not.toBeInTheDocument()
  })

  it('renders available creator and caption as plain text and provides a safe original link', () => {
    const caption = '<img src=x onerror=alert(1)>'
    render(
      <PostViewer
        post={post}
        postType="image"
        creatorUsername="synthetic_creator"
        caption={caption}
        onBack={vi.fn()}
      />,
    )

    expect(screen.getByText('synthetic_creator')).toBeInTheDocument()
    expect(screen.getByText(caption)).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /onerror/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open original on Instagram/ }))
      .toHaveAttribute('rel', 'noopener noreferrer')
  })

  it.each([
    ['p', 'Instagram post embed'],
    ['reel', 'Instagram Reel embed'],
  ])('embeds supported Instagram %s URLs and keeps the original fallback available', (route, title) => {
    render(
      <PostViewer
        post={{ ...post, originalUrl: `https://www.instagram.com/${route}/synthetic-code/` }}
        postType={route === 'reel' ? 'reel' : null}
        creatorUsername={null}
        caption={null}
        onBack={vi.fn()}
      />,
    )

    const frame = screen.getByTitle(title)
    expect(frame).toHaveAttribute(
      'src',
      `https://www.instagram.com/${route}/synthetic-code/embed/`,
    )
    expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer')
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin')
    expect(screen.getByRole('link', { name: /Open original on Instagram/ }))
      .toHaveAttribute('href', `https://www.instagram.com/${route}/synthetic-code/`)
  })

  it('shows the original fallback after an embed fails', () => {
    render(
      <PostViewer
        post={{ ...post, originalUrl: 'https://www.instagram.com/p/synthetic-code/' }}
        postType={null}
        creatorUsername={null}
        caption={null}
        onBack={vi.fn()}
      />,
    )

    fireEvent.error(screen.getByTitle('Instagram post embed'))

    expect(screen.queryByTitle('Instagram post embed')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('unavailable or blocked')
    expect(screen.getByRole('link', { name: /Open original on Instagram/ }))
      .toHaveAttribute('href', 'https://www.instagram.com/p/synthetic-code/')
  })

  it('falls back when a content security policy blocks the Instagram frame', () => {
    render(
      <PostViewer
        post={{ ...post, originalUrl: 'https://www.instagram.com/p/synthetic-code/' }}
        postType={null}
        creatorUsername={null}
        caption={null}
        onBack={vi.fn()}
      />,
    )

    const violation = new Event('securitypolicyviolation')
    Object.defineProperties(violation, {
      violatedDirective: { value: 'frame-src' },
      blockedURI: { value: 'https://www.instagram.com/p/synthetic-code/embed/' },
    })
    act(() => window.dispatchEvent(violation))

    expect(screen.queryByTitle('Instagram post embed')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('unavailable or blocked')
    expect(screen.getByRole('link', { name: /Open original on Instagram/ }))
      .toBeInTheDocument()
  })

  it('does not build an embed or unsafe fallback link when the original URL is missing', () => {
    render(
      <PostViewer
        post={{ ...post, originalUrl: '' }}
        postType="reel"
        creatorUsername={null}
        caption={null}
        onBack={vi.fn()}
      />,
    )

    expect(screen.queryByRole('iframe')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(
      'The original Instagram URL is unavailable',
    )
    expect(screen.getByText('The original Instagram link is unavailable.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Open original on Instagram/ })).not.toBeInTheDocument()
  })

  it('uses the original link without attempting unsupported or untrusted embed URLs', () => {
    render(
      <PostViewer
        post={{ ...post, originalUrl: 'https://www.instagram.com/stories/synthetic/' }}
        postType="image"
        creatorUsername={null}
        caption={null}
        onBack={vi.fn()}
      />,
    )

    expect(screen.queryByRole('iframe')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('does not support an embed')
    expect(screen.getByRole('link', { name: /Open original on Instagram/ }))
      .toHaveAttribute('href', 'https://www.instagram.com/stories/synthetic/')
  })

  it('does not link an untrusted URL even when the post viewer receives one', () => {
    render(
      <PostViewer
        post={{ ...post, originalUrl: 'https://example.invalid/post' }}
        postType={null}
        creatorUsername={null}
        caption={null}
        onBack={vi.fn()}
      />,
    )

    expect(screen.queryByRole('iframe')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Open original on Instagram/ })).not.toBeInTheDocument()
    expect(screen.getByText('The original Instagram link is unavailable.')).toBeInTheDocument()
  })

  it('returns to post details when requested', async () => {
    const onBack = vi.fn()
    render(
      <PostViewer
        post={post}
        postType={null}
        creatorUsername={null}
        caption={null}
        onBack={onBack}
      />,
    )

    screen.getByRole('button', { name: 'Back to post details' }).click()
    expect(onBack).toHaveBeenCalledOnce()
  })
})

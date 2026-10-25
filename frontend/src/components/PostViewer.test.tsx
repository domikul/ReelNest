import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LibraryPost } from '../api/library'
import PostViewer from './PostViewer'

const post: LibraryPost = {
  id: '00000000-0000-0000-0000-000000000001',
  originalUrl: 'https://www.instagram.com/p/synthetic-viewer-post/',
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
    expect(screen.getByRole('link', { name: /Open original Instagram post/ }))
      .toHaveAttribute('rel', 'noopener noreferrer')
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

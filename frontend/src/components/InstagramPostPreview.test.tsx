import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import InstagramPostPreview from './InstagramPostPreview'

describe('Instagram post previews', () => {
  afterEach(cleanup)

  it.each([
    ['p', 'Instagram post preview'],
    ['reel', 'Instagram Reel preview'],
  ])('embeds a supported %s URL and keeps the original fallback available', (route, title) => {
    const originalUrl = `https://www.instagram.com/${route}/synthetic-code/`
    render(<InstagramPostPreview originalUrl={originalUrl} />)

    const iframe = screen.getByTitle(title)
    expect(iframe).toHaveAttribute(
      'src',
      `https://www.instagram.com/${route}/synthetic-code/embed/captioned/`,
    )
    expect(iframe).toHaveAttribute('loading', 'lazy')
    expect(iframe).toHaveAttribute('referrerpolicy', 'no-referrer')
    expect(iframe).toHaveAttribute('scrolling', 'no')
    expect(iframe).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin')
    expect(screen.getByRole('status')).toHaveTextContent('loads when this card nears the screen')
    expect(screen.getByRole('link', { name: /Open original on Instagram/ }))
      .toHaveAttribute('href', originalUrl)

    fireEvent.load(iframe)
    expect(screen.getByRole('status')).toHaveTextContent(
      'If the post is not visible, open the original.',
    )
  })

  it('shows a direct fallback when an embed fails', () => {
    const originalUrl = 'https://www.instagram.com/reel/synthetic-code/'
    render(<InstagramPostPreview originalUrl={originalUrl} />)

    fireEvent.error(screen.getByTitle('Instagram Reel preview'))

    expect(screen.queryByTitle('Instagram Reel preview')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('unavailable or blocked')
    expect(screen.getByRole('link', { name: /Open original on Instagram/ }))
      .toHaveAttribute('href', originalUrl)
  })

  it('falls back for unsupported Instagram URLs without attempting an embed', () => {
    const originalUrl = 'https://www.instagram.com/stories/synthetic/'
    render(<InstagramPostPreview originalUrl={originalUrl} />)

    expect(screen.queryByRole('iframe')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('does not support an embed')
    expect(screen.getByRole('link', { name: /Open original on Instagram/ }))
      .toHaveAttribute('href', originalUrl)
  })

  it('does not embed or link an untrusted URL', () => {
    render(<InstagramPostPreview originalUrl="https://example.invalid/reel/synthetic/" />)

    expect(screen.queryByRole('iframe')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('safe Instagram preview is not available')
    expect(screen.queryByRole('link', { name: /Open original on Instagram/ })).not.toBeInTheDocument()
  })

  it('falls back when a content security policy blocks the Instagram frame', () => {
    render(
      <InstagramPostPreview originalUrl="https://www.instagram.com/p/synthetic-code/" />,
    )

    const violation = new Event('securitypolicyviolation')
    Object.defineProperties(violation, {
      violatedDirective: { value: 'frame-src' },
      blockedURI: { value: 'https://www.instagram.com/p/synthetic-code/embed/captioned/' },
    })
    act(() => window.dispatchEvent(violation))

    expect(screen.queryByRole('iframe')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('unavailable or blocked')
    expect(screen.getByRole('link', { name: /Open original on Instagram/ })).toBeInTheDocument()
  })
})

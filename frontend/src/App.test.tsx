import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from './App'

describe('ReelNest application shell', () => {
  beforeEach(() => {
    window.localStorage.clear()
    delete document.documentElement.dataset.theme
  })

  afterEach(() => {
    cleanup()
  })

  it('renders the ReelNest welcome and empty-library state', () => {
    render(<App />)

    expect(
      screen.getByRole('heading', { name: 'Your saved reels. Finally at home.' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Bring your saved posts home' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toHaveTextContent(
      'Import',
    )
  })

  it.each(['light', 'dark', 'system'] as const)(
    'applies and persists the %s theme',
    (theme) => {
      render(<App />)

      fireEvent.change(screen.getByRole('combobox', { name: 'Color theme' }), {
        target: { value: theme },
      })

      expect(document.documentElement).toHaveAttribute('data-theme', theme)
      expect(window.localStorage.getItem('reelnest-theme')).toBe(theme)
    },
  )

  it('restores a saved theme on startup', () => {
    window.localStorage.setItem('reelnest-theme', 'dark')

    render(<App />)

    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
  })
})

import { useEffect, useState } from 'react'

type Theme = 'system' | 'light' | 'dark'

const themeStorageKey = 'reelnest-theme'

function getInitialTheme(): Theme {
  const savedTheme = window.localStorage.getItem(themeStorageKey)
  return savedTheme === 'light' || savedTheme === 'dark' ? savedTheme : 'system'
}

function App() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem(themeStorageKey, theme)
  }, [theme])

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="ReelNest home">
          <span className="brand-mark" aria-hidden="true">
            <span />
          </span>
          <span className="brand-name">ReelNest</span>
        </a>
        <label className="theme-picker">
          <span>Appearance</span>
          <select
            aria-label="Color theme"
            value={theme}
            onChange={(event) => {
              const value = event.target.value
              if (value === 'system' || value === 'light' || value === 'dark') {
                setTheme(value)
              }
            }}
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
      </header>

      <section className="welcome" aria-labelledby="welcome-title">
        <p className="eyebrow">A little less scrolling</p>
        <h1 id="welcome-title">Your saved reels. Finally at home.</h1>
        <p className="welcome-copy">
          A cozy, personal home for everything you save — without the endless
          scroll.
        </p>

        <div className="empty-state">
          <span className="empty-mark" aria-hidden="true">
            <span />
          </span>
          <h2>Your nest is ready</h2>
          <p>Your library will take shape in a later milestone.</p>
        </div>
      </section>

      <footer className="footer">
        <span>ReelNest</span>
        <span>Less scrolling. More living.</span>
      </footer>
    </main>
  )
}

export default App

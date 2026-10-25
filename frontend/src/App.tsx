import { useCallback, useEffect, useState } from 'react'
import { AuthApiError, getCsrfToken, getSessionStatus, signIn, signOut } from './api/auth'
import ImportPanel from './components/ImportPanel'
import LibraryView from './components/LibraryView'
import SignInForm from './components/SignInForm'

type Theme = 'system' | 'light' | 'dark'
type AuthState = 'checking' | 'authenticated' | 'anonymous' | 'unavailable'

const themeStorageKey = 'reelnest-theme'

function getInitialTheme(): Theme {
  const savedTheme = window.localStorage.getItem(themeStorageKey)
  return savedTheme === 'light' || savedTheme === 'dark' ? savedTheme : 'system'
}

function App() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme)
  const [authState, setAuthState] = useState<AuthState>('checking')
  const [csrfToken, setCsrfToken] = useState<string | null>(null)
  const [authBusy, setAuthBusy] = useState(false)
  const [authNotice, setAuthNotice] = useState<string | null>(null)
  const [authError, setAuthError] = useState<string | null>(null)
  const [libraryRefreshKey, setLibraryRefreshKey] = useState(0)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem(themeStorageKey, theme)
  }, [theme])

  async function initializeSession() {
    setAuthState('checking')
    setAuthError(null)
    try {
      const token = await getCsrfToken()
      const session = await getSessionStatus()
      setCsrfToken(token)
      setAuthState(session.authenticated ? 'authenticated' : 'anonymous')
    } catch (cause) {
      setCsrfToken(null)
      setAuthState('unavailable')
      setAuthError(
        cause instanceof AuthApiError
          ? cause.message
          : 'The sign-in service is unavailable. Please try again.',
      )
    }
  }

  useEffect(() => {
    void initializeSession()
  }, [])

  async function handleSignIn(username: string, password: string) {
    setAuthBusy(true)
    setAuthError(null)
    try {
      const token = csrfToken ?? (await getCsrfToken())
      await signIn(username, password, token)
      const nextToken = await getCsrfToken()
      const session = await getSessionStatus()
      if (!session.authenticated) {
        throw new AuthApiError('Sign-in could not be confirmed. Please retry.')
      }
      setCsrfToken(nextToken)
      setAuthState('authenticated')
      setAuthNotice(null)
    } catch (cause) {
      setAuthError(
        cause instanceof AuthApiError
          ? cause.message
          : 'Sign-in could not be completed. Please retry.',
      )
    } finally {
      setAuthBusy(false)
    }
  }

  async function handleSignOut() {
    setAuthBusy(true)
    setAuthError(null)
    try {
      const token = csrfToken ?? (await getCsrfToken())
      await signOut(token)
      setCsrfToken(null)
      setAuthState('anonymous')
      setAuthNotice('You have signed out.')
    } catch (cause) {
      setAuthError(
        cause instanceof AuthApiError
          ? cause.message
          : 'Sign-out could not be completed. Please retry.',
      )
    } finally {
      setAuthBusy(false)
    }
  }

  const handleSessionExpired = useCallback(() => {
    setCsrfToken(null)
    setAuthState('anonymous')
    setAuthNotice('Your session expired. Sign in again to continue.')
    setAuthError(null)
  }, [])

  function handleOpenImport() {
    document.getElementById('import')?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="ReelNest home">
          <span className="brand-mark" aria-hidden="true">
            <span />
          </span>
          <span className="brand-name">ReelNest</span>
        </a>
        <nav className="topnav" aria-label="Main navigation">
          {authState === 'authenticated' && <a href="#library">Library</a>}
          <a href="#import">Import</a>
        </nav>
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
        {authState === 'authenticated' && (
          <button
            className="sign-out-button"
            type="button"
            onClick={() => void handleSignOut()}
            disabled={authBusy}
          >
            {authBusy ? 'Signing out…' : 'Sign out'}
          </button>
        )}
      </header>

      <section className="welcome" aria-labelledby="welcome-title">
        <p className="eyebrow">A little less scrolling</p>
        <h1 id="welcome-title">Your saved reels. Finally at home.</h1>
        <p className="welcome-copy">
          A cozy, personal home for everything you save — without the endless
          scroll.
        </p>

        <div className="import-card" id="import" aria-labelledby="import-title">
          <span className="empty-mark" aria-hidden="true">
            <span />
          </span>
          <h2 id="import-title">Bring your saved posts home</h2>
          <p>
            Start with your Instagram saved-post export. ReelNest will keep the
            source details and show a summary before you continue.
          </p>
          {authState === 'checking' && (
            <p className="submission-status" role="status">Checking your session…</p>
          )}
          {authState === 'authenticated' && csrfToken && (
            <ImportPanel
              csrfToken={csrfToken}
              onSessionExpired={handleSessionExpired}
              onImportComplete={() => setLibraryRefreshKey((value) => value + 1)}
            />
          )}
          {authState === 'anonymous' && (
            <SignInForm
              busy={authBusy}
              notice={authNotice}
              error={authError}
              onSubmit={(username, password) => void handleSignIn(username, password)}
            />
          )}
          {authState === 'unavailable' && (
            <div className="sign-in-form">
              <p className="form-error" role="alert">
                {authError ?? 'The sign-in service is unavailable. Please try again.'}
              </p>
              <button
                className="import-button"
                type="button"
                onClick={() => void initializeSession()}
              >
                Retry connection
              </button>
            </div>
          )}
          {authState === 'authenticated' && authError && (
            <p className="form-error" role="alert">{authError}</p>
          )}
        </div>
      </section>

      {authState === 'authenticated' && csrfToken && (
        <LibraryView
          key={libraryRefreshKey}
          csrfToken={csrfToken}
          onSessionExpired={handleSessionExpired}
          onOpenImport={handleOpenImport}
        />
      )}

      <footer className="footer">
        <span>ReelNest</span>
        <span>Less scrolling. More living.</span>
      </footer>
    </main>
  )
}

export default App

import { useState } from 'react'
import type { FormEvent } from 'react'

interface SignInFormProps {
  busy: boolean
  notice: string | null
  error: string | null
  onSubmit: (mode: 'sign-in' | 'register', username: string, password: string) => void
}

function SignInForm({ busy, notice, error, onSubmit }: SignInFormProps) {
  const [mode, setMode] = useState<'sign-in' | 'register'>('sign-in')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLocalError(null)
    if (mode === 'register' && password !== confirmation) {
      setLocalError('Passwords do not match.')
      return
    }
    onSubmit(mode, username, password)
  }

  function changeMode(nextMode: 'sign-in' | 'register') {
    setMode(nextMode)
    setLocalError(null)
    setPassword('')
    setConfirmation('')
  }

  return (
    <form className="sign-in-form" onSubmit={handleSubmit}>
      <p>
        {mode === 'sign-in'
          ? 'Sign in to your private ReelNest library.'
          : 'Create an account to start your private ReelNest library.'}
      </p>
      <label>
        Username
        <input
          autoComplete="username"
          minLength={mode === 'register' ? 3 : undefined}
          maxLength={mode === 'register' ? 32 : undefined}
          name="username"
          required
          value={username}
          onChange={(event) => setUsername(event.target.value)}
        />
      </label>
      <label>
        Password
        <input
          autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
          minLength={mode === 'register' ? 12 : undefined}
          name="password"
          required
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      {mode === 'register' && (
        <label>
          Confirm password
          <input
            autoComplete="new-password"
            minLength={12}
            name="passwordConfirmation"
            required
            type="password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </label>
      )}
      {notice && <p className="auth-notice" role="status">{notice}</p>}
      {(localError || error) && <p className="form-error" role="alert">{localError || error}</p>}
      <button className="import-button" type="submit" disabled={busy}>
        {busy
          ? mode === 'sign-in' ? 'Signing in…' : 'Creating account…'
          : mode === 'sign-in' ? 'Sign in' : 'Create account'}
      </button>
      {busy && (
        <p className="submission-status" role="status">
          {mode === 'sign-in' ? 'Checking your sign-in…' : 'Creating your account…'}
        </p>
      )}
      <button
        className="auth-toggle"
        type="button"
        disabled={busy}
        onClick={() => changeMode(mode === 'sign-in' ? 'register' : 'sign-in')}
      >
        {mode === 'sign-in' ? 'New to ReelNest? Create an account' : 'Already have an account? Sign in'}
      </button>
    </form>
  )
}

export default SignInForm

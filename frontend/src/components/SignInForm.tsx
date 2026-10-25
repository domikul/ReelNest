import { useState } from 'react'
import type { FormEvent } from 'react'

interface SignInFormProps {
  busy: boolean
  notice: string | null
  error: string | null
  onSubmit: (username: string, password: string) => void
}

function SignInForm({ busy, notice, error, onSubmit }: SignInFormProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onSubmit(username, password)
  }

  return (
    <form className="sign-in-form" onSubmit={handleSubmit}>
      <p>Sign in to your private ReelNest library.</p>
      <label>
        Username
        <input
          autoComplete="username"
          name="username"
          required
          value={username}
          onChange={(event) => setUsername(event.target.value)}
        />
      </label>
      <label>
        Password
        <input
          autoComplete="current-password"
          name="password"
          required
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      {notice && <p className="auth-notice" role="status">{notice}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="import-button" type="submit" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
      {busy && <p className="submission-status" role="status">Checking your sign-in…</p>}
    </form>
  )
}

export default SignInForm

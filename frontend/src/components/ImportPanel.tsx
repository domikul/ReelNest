import { useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { describeImportItemError, ImportApiError, uploadSavedPosts } from '../api/imports'
import type { ImportSummary } from '../api/imports'

const maxFileSize = 10 * 1024 * 1024

function formatFileSize(size: number): string {
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function ImportResult({ summary }: { summary: ImportSummary }) {
  const displayedErrors = summary.errors.slice(0, 20)
  const hiddenErrorCount = Math.max(0, summary.errorCount - displayedErrors.length)

  return (
    <section
      className="import-result"
      aria-labelledby="import-result-title"
      aria-live="polite"
    >
      <div className="result-heading">
        <div>
          <p className="eyebrow">Import complete</p>
          <h3 id="import-result-title">
            {summary.errorCount > 0
              ? 'Some entries need attention'
              : 'Your saved posts are ready'}
          </h3>
        </div>
        <span
          className={`result-status${summary.errorCount > 0 ? ' result-status-warning' : ''}`}
        >
          {summary.errorCount > 0 ? 'Completed with issues' : 'Completed'}
        </span>
      </div>

      <dl className="summary-counts">
        <div>
          <dt>Added</dt>
          <dd>{summary.addedCount}</dd>
        </div>
        <div>
          <dt>Updated</dt>
          <dd>{summary.updatedCount}</dd>
        </div>
        <div>
          <dt>Skipped / duplicate</dt>
          <dd>{summary.skippedCount}</dd>
        </div>
        <div>
          <dt>Errors</dt>
          <dd>{summary.errorCount}</dd>
        </div>
      </dl>

      {summary.errorCount > 0 && (
        <div className="item-errors">
          <h4>Entries to review</h4>
          {displayedErrors.length > 0 ? (
            <ul>
              {displayedErrors.map((error, index) => (
                <li key={`${error.recordIndex}-${index}`}>
                  <span>Entry {error.recordIndex}</span>
                  <span>{describeImportItemError(error.code)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p>Some entries could not be imported. Retry the file if needed.</p>
          )}
          {hiddenErrorCount > 0 && (
            <p>
              {hiddenErrorCount} additional{' '}
              {hiddenErrorCount === 1 ? 'error is' : 'errors are'} not shown.
            </p>
          )}
        </div>
      )}
    </section>
  )
}

interface ImportPanelProps {
  csrfToken: string
  onSessionExpired: () => void
}

function ImportPanel({ csrfToken, onSessionExpired }: ImportPanelProps) {
  const [file, setFile] = useState<File | null>(null)
  const [summary, setSummary] = useState<ImportSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null
    setSummary(null)
    setError(null)

    if (!nextFile) {
      setFile(null)
      return
    }
    if (!nextFile.name.toLowerCase().endsWith('.json')) {
      setFile(null)
      setError('Choose a .json saved-post export.')
      event.target.value = ''
      return
    }
    if (nextFile.size > maxFileSize) {
      setFile(null)
      setError('This file is too large. Choose a JSON export smaller than 10 MB.')
      event.target.value = ''
      return
    }

    setFile(nextFile)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submittingRef.current) {
      return
    }
    if (!file) {
      setError('Choose a saved_posts JSON export before importing.')
      return
    }

    submittingRef.current = true
    setIsSubmitting(true)
    setError(null)
    setSummary(null)

    try {
      const result = await uploadSavedPosts(file, csrfToken)
      setSummary(result)
      setFile(null)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    } catch (cause) {
      if (
        cause instanceof ImportApiError &&
        (cause.status === 401 || cause.status === 403)
      ) {
        onSessionExpired()
        return
      }
      setError(
        cause instanceof ImportApiError
          ? cause.message
          : 'The import could not be completed. Please try again.',
      )
    } finally {
      submittingRef.current = false
      setIsSubmitting(false)
    }
  }

  return (
    <div className="import-flow">
      <form className="import-form" onSubmit={handleSubmit} noValidate>
        <label className="file-picker" htmlFor="saved-posts-file">
          <span className="file-picker-icon" aria-hidden="true">
            ↑
          </span>
          <span className="file-picker-label">
            <strong>{file ? 'Choose a different file' : 'Choose JSON file'}</strong>
            <span>Instagram saved_posts export</span>
          </span>
          <input
            ref={fileInputRef}
            id="saved-posts-file"
            name="file"
            type="file"
            accept=".json,application/json"
            aria-describedby="upload-guidance"
            disabled={isSubmitting}
            onChange={handleFileChange}
          />
        </label>

        {file && (
          <p className="selected-file" aria-live="polite">
            Selected: <strong>{file.name}</strong> · {formatFileSize(file.size)}
          </p>
        )}
        <p id="upload-guidance" className="upload-guidance">
          JSON only, up to 10 MB. The file is sent to ReelNest for this import
          and is not stored in browser storage.
        </p>

        <button className="import-button" type="submit" disabled={isSubmitting || !file}>
          {isSubmitting
            ? 'Uploading export…'
            : error
              ? 'Retry import'
              : 'Import saved posts'}
        </button>

        {isSubmitting && (
          <p className="submission-status" role="status" aria-live="polite">
            Uploading and checking your export…
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>

      {summary && <ImportResult summary={summary} />}
    </div>
  )
}

export default ImportPanel

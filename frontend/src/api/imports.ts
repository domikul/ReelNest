export interface ImportItemError {
  recordIndex: number
  code: string
}

export interface ImportSummary {
  importId: string
  status: 'COMPLETED' | 'COMPLETED_WITH_ERRORS'
  addedCount: number
  updatedCount: number
  skippedCount: number
  errorCount: number
  errors: ImportItemError[]
  createdAt: string
}

export class ImportApiError extends Error {
  readonly status: number | null

  constructor(message: string, status: number | null = null) {
    super(message)
    this.name = 'ImportApiError'
    this.status = status
  }
}

const validationMessages = new Set([
  'Upload must not be empty.',
  'Upload must contain valid JSON.',
  'Upload could not be read.',
  'Unsupported export structure. This endpoint accepts the observed saved_posts.json format.',
  'Upload exceeds the 10 MB limit.',
])

const itemErrorMessages: Record<string, string> = {
  invalid_record: 'This entry is not a JSON object.',
  invalid_identifier: 'This entry is missing a valid source identifier.',
  invalid_timestamp: 'This entry has an invalid timestamp.',
  invalid_metadata: 'This entry is missing its saved-post metadata.',
  missing_post_url: 'This entry does not include a saved-post link.',
  ambiguous_post_url: 'This entry includes more than one saved-post link.',
  invalid_post_url: 'This entry has an invalid saved-post link.',
  identifier_conflict: 'This entry conflicts with an existing saved post.',
  persistence_error: 'This entry could not be saved. You can retry the import.',
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

function isImportItemError(value: unknown): value is ImportItemError {
  return (
    isObject(value) &&
    typeof value.recordIndex === 'number' &&
    Number.isSafeInteger(value.recordIndex) &&
    value.recordIndex > 0 &&
    typeof value.code === 'string'
  )
}

function isImportSummary(value: unknown): value is ImportSummary {
  return (
    isObject(value) &&
    typeof value.importId === 'string' &&
    (value.status === 'COMPLETED' || value.status === 'COMPLETED_WITH_ERRORS') &&
    isCount(value.addedCount) &&
    isCount(value.updatedCount) &&
    isCount(value.skippedCount) &&
    isCount(value.errorCount) &&
    Array.isArray(value.errors) &&
    value.errors.every(isImportItemError) &&
    typeof value.createdAt === 'string'
  )
}

function validationMessage(status: number, detail: unknown): string {
  if (typeof detail === 'string' && validationMessages.has(detail)) {
    return detail
  }

  if (status === 413) {
    return 'This file is too large. Choose a JSON export smaller than 10 MB.'
  }
  if (status === 422) {
    return 'This export format is not supported. Choose the saved_posts JSON export.'
  }
  if (status >= 400 && status < 500) {
    return 'The export could not be validated. Check the JSON file and try again.'
  }
  return 'The import service is unavailable. Please try again.'
}

export function describeImportItemError(code: string): string {
  return itemErrorMessages[code] ?? 'This entry could not be imported.'
}

export async function uploadSavedPosts(file: File, csrfToken: string): Promise<ImportSummary> {
  const formData = new FormData()
  formData.append('file', file)

  let response: Response
  try {
    response = await fetch('/api/imports', {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-CSRF-TOKEN': csrfToken },
      body: formData,
    })
  } catch {
    throw new ImportApiError('Could not connect to ReelNest. Check your connection and retry.')
  }

  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new ImportApiError('Your session has expired. Sign in again to continue.', 401)
    }
    if (response.status === 403) {
      throw new ImportApiError('Your security session expired. Sign in again to continue.', 403)
    }
    const detail = isObject(payload) ? payload.detail : undefined
    throw new ImportApiError(validationMessage(response.status, detail), response.status)
  }

  if (!isImportSummary(payload)) {
    throw new ImportApiError('The server returned an unexpected response. Please retry the import.')
  }

  return payload
}

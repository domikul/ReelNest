interface FavoriteButtonProps {
  favorite: boolean
  busy: boolean
  error: string | null
  onToggle: () => void
}

function FavoriteButton({ favorite, busy, error, onToggle }: FavoriteButtonProps) {
  return (
    <div className="favorite-control">
      <button
        className={`favorite-button${favorite ? ' is-favorite' : ''}`}
        type="button"
        aria-pressed={favorite}
        disabled={busy}
        onClick={onToggle}
      >
        <span aria-hidden="true">{favorite ? '♥' : '♡'}</span>
        {busy
          ? 'Saving favorite…'
          : favorite
            ? 'Remove from favorites'
            : 'Add to favorites'}
      </button>
      {error && <p className="favorite-error" role="alert">{error}</p>}
    </div>
  )
}

export default FavoriteButton

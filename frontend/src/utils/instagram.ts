export function parseInstagramUrl(value: string): URL | null {
  try {
    const url = new URL(value)
    if (
      (url.protocol !== 'https:' && url.protocol !== 'http:') ||
      (url.hostname !== 'instagram.com' && !url.hostname.endsWith('.instagram.com')) ||
      url.username.length > 0 ||
      url.password.length > 0
    ) {
      return null
    }
    return url
  } catch {
    return null
  }
}

function getInstagramRoute(originalUrl: string): RegExpExecArray | null {
  const url = parseInstagramUrl(originalUrl)
  if (
    !url ||
    (url.hostname !== 'instagram.com' && url.hostname !== 'www.instagram.com')
  ) {
    return null
  }
  return /^\/(p|reel)\/([A-Za-z0-9_-]{1,128})\/?$/i.exec(url.pathname)
}

export function getInstagramEmbedUrl(originalUrl: string): string | null {
  const url = parseInstagramUrl(originalUrl)
  const match = getInstagramRoute(originalUrl)
  if (!url || !match) {
    return null
  }
  return `https://www.instagram.com/${match[1].toLowerCase()}/${match[2]}/embed/captioned/`
}

export function getInstagramPostTitle(originalUrl: string): string {
  const match = getInstagramRoute(originalUrl)
  return match?.[1].toLowerCase() === 'reel' ? 'Instagram Reel' : 'Instagram post'
}

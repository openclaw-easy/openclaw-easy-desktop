/**
 * Release feed for update checks.
 *
 * This build publishes through GitHub Releases rather than a hosted
 * update endpoint, so the latest version is read straight from the
 * repository's releases API and the installer assets attached to it.
 */

const RELEASES_API_URL =
  'https://api.github.com/repos/openclaw-easy/openclaw-easy-desktop/releases/latest'

export interface LatestRelease {
  version: string
  releaseDate?: string
  /** Asset filename → browser download URL. */
  downloads: Record<string, string>
}

/** Strips the leading `v` GitHub tags conventionally carry. */
function versionFromTag(tag: string): string {
  return tag.startsWith('v') ? tag.slice(1) : tag
}

/**
 * Fetch the newest published release. Throws on network failure or a
 * non-OK response so callers can apply their own retry/fallback.
 */
export async function fetchLatestRelease(): Promise<LatestRelease> {
  const response = await fetch(RELEASES_API_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  if (!response.ok) {
    throw new Error(`GitHub releases API returned HTTP ${response.status}`)
  }
  const data = await response.json()

  const downloads: Record<string, string> = {}
  for (const asset of data.assets ?? []) {
    if (asset?.name && asset?.browser_download_url) {
      downloads[asset.name] = asset.browser_download_url
    }
  }

  return {
    version: versionFromTag(String(data.tag_name ?? '')),
    releaseDate: data.published_at ?? undefined,
    downloads,
  }
}

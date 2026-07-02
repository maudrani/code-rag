/**
 * repoLabel(url) — a compact `owner/repo` label for the active-corpus chip (TKT-533). Takes the last
 * two path segments of a git URL (github/gitlab-style `scheme://host/owner/repo` or scp-like
 * `git@host:owner/repo`), dropping a trailing `.git`. Falls back to the raw url when it can't parse an
 * owner/repo — the chip stays honest. Visual width is bounded by CSS truncation (not this fn), so a
 * long, unparseable URL never breaks the header.
 */
export function repoLabel(url: string): string {
  const noGit = url.replace(/\.git$/, '')
  // scp-like: git@host:owner/repo — the path is everything after the colon
  const scp = noGit.match(/^[\w.-]+@[\w.-]+:(.+)$/)
  const path = scp ? scp[1] : noGit.replace(/^[a-z][\w+.-]*:\/\/[^/]+\//i, '')
  const segments = path.split('/').filter(Boolean)
  if (segments.length >= 2) {
    return segments.slice(-2).join('/')
  }
  return segments.length === 1 ? segments[0] : url
}

/** Only plain https/http/ssh-style git URLs; no whitespace, quotes or shell metacharacters, never starts with '-'. */
export function isValidGitUrl(url: string): boolean {
  if (url.length > 500 || url.startsWith('-')) return false;
  if (/[\s"'`$\;&|<>(){}*?!#\u0000-\u001f]/.test(url)) return false;
  return /^https?:\/\/[^/]+\/.+/.test(url) || /^git@[\w.-]+:[\w./~-]+$/.test(url);
}

/** A single plain folder name: no separators, no traversal, no leading dot/dash. */
export function isSafeDirName(name: string): boolean {
  return /^[A-Za-z0-9_][A-Za-z0-9._-]{0,99}$/.test(name) && !name.includes('..');
}

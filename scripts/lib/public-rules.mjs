// The public-repo guard's rules, shared by scripts/check-public.mjs (pre-commit and CI) and by
// Draw's pre-save checks (projects/draw), so a save from the phone is judged by the same rules as
// a commit from a session. Plain, dependency-free ESM: it is bundled into the app as-is.
//
// Findings name a rule, never the matched text: a CI log or a chat transcript must not become
// the leak.

// Generic shapes, checked against the private vault's real content: each catches what it names
// with little noise, so a hit is worth stopping for.
export const LINE_RULES = [
  ['anthropic-key', /sk-ant-[\w-]{20,}/],
  ['github-token', /\bgh[pousr]_[A-Za-z0-9]{36}\b/],
  ['github-pat', /github_pat_\w{50,}/],
  ['aws-key-id', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['slack-token', /\bxox[baprs]-[\w-]{10,}/],
  ['private-key-block', /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/],
  ['wireguard-key', /^\s*(?:PrivateKey|PresharedKey)\s*=\s*[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=/],
  // Passwords are usually too plain for an entropy check; these are the shapes they get written in.
  ['sudo-password-pipe', /\becho\s+(?!\$)\S+\s*\|\s*sudo\s+-S\b/],
  ['login-user-slash-password', /\blogin\s+\**(?:`[\w.-]+`\s*\/\s*`[^`\s]+`|[\w.-]+\/[^\s/)]+)/],
  ['private-ipv4', /\b(?:10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}\b/],
  ['ipv6-ula', /(?<![0-9a-f:])f[cd][0-9a-f]{2}(?::[0-9a-f]{0,4}){2,7}/i],
  ['ipv6-global', /\b(?!2001:db8)[23][0-9a-f]{3}(?::[0-9a-f]{1,4}){3,7}/i],
  ['windows-machine-name', /\bDESKTOP-[A-Z0-9]{7}\b/],
  ['windows-home-path', /\b[A-Za-z]:[\\/]+Users[\\/]+(?!Public\b|Default\b|<|\.\.\.|…)[^\\/\s"'`<]+/i],
  ['mac-home-path', /\/Users\/(?!Shared\b)[A-Za-z0-9._-]+/],
  ['linux-home-path', /\/home\/(?!user\b|runner\b)[a-z_][a-z0-9_-]*/],
  ['ios-device-id', /\b0000\d{4}-[0-9A-F]{16}\b/],
];
export const SECRET_FILE = /(^|\/)\.env(\.(?!example$)|$)|\.(pem|key|p12|pfx)$/i;

/** Rules that fire on one line of text (a line containing `public-ok` is exempt). */
export function lineFindings(line) {
  if (line.includes('public-ok')) return [];
  return LINE_RULES.filter(([, re]) => re.test(line)).map(([rule]) => rule);
}

/**
 * secrets.mjs — two complementary scans, from two different repositories.
 *
 * `game2/tools/validate-project-state.mjs:70-78` walks parsed state objects looking for
 * suspicious **key names**; `Gptgame/scripts/verify-continuity.mjs:92-100` scans document
 * text for credential **value** shapes. Neither catches what the other does: a key named
 * `api_key` holding a placeholder is a structural mistake worth failing on, and a bare
 * `ghp_…` pasted into a Markdown log has no key name at all.
 *
 * Both are cheap. Run both.
 */

const SECRET_KEY = /^(password|passwd|secret|api_?key|access_?token|auth_?token|private_?key|client_?secret|credentials?)$/i;

const SECRET_VALUE = [
  [/-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/, 'PEM private key block'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/, 'GitHub token (gh*_)'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/, 'GitHub fine-grained PAT'],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/, 'Slack token'],
  [/\bsk-[A-Za-z0-9]{32,}/, 'API secret key (sk-)'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key id'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, 'Google API key'],
];

/** Recursive key-name scan over parsed JSON/YAML state. */
export function scanSecretKeys(value, path = '') {
  const failures = [];
  const walk = (node, trail) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${trail}[${i}]`));
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      const here = trail ? `${trail}.${key}` : key;
      if (SECRET_KEY.test(key)) failures.push(`credential-shaped key at ${here}`);
      walk(child, here);
    }
  };
  walk(value, path);
  return failures;
}

/** Value-shape scan over raw text. `label` names the file in the failure. */
export function scanSecretValues(text, label = 'document') {
  const failures = [];
  for (const [pattern, description] of SECRET_VALUE) {
    if (pattern.test(String(text))) failures.push(`${label} contains what looks like a ${description}`);
  }
  return failures;
}

export const patterns = { SECRET_KEY, SECRET_VALUE };

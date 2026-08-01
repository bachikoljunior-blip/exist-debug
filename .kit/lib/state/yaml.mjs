/**
 * yaml.mjs — a deliberately small, deliberately strict YAML reader for state files.
 *
 * It exists because of a divergence the template has to settle. `game2/AI_DEVELOPMENT/
 * PROJECT_STATE.yaml` is named `.yaml` but contains JSON with camelCase keys, and
 * `survival/AI_DEVELOPMENT/PROJECT_STATE.json` is JSON with snake_case keys. Both chose JSON
 * for the same reason: `JSON.parse` is in the runtime and a YAML parser is a dependency, and
 * the kit does not take dependencies.
 *
 * The cost of that choice is paid on every edit. A state file is the one artefact a human and
 * an agent both hand-edit under time pressure, and JSON gives it no comments — so the reason a
 * value is what it is has to live somewhere else, where it rots. Every field in these files
 * exists because something went wrong once; losing the note is losing the reason.
 *
 * So: a subset parser, and a **strict** one. It refuses everything it does not fully
 * understand rather than guessing, because a silently mis-parsed state file is precisely the
 * class of defect this kit exists to stop — no exception, no log, plausible-looking output.
 *
 * Supported: block mappings, block sequences, `#` comments, `null`/`~`, booleans, integers,
 * floats, single- and double-quoted strings, plain strings, literal block scalars (`|`, `|-`,
 * `|+`), empty flow collections (`[]`, `{}`) and single-line flow sequences of scalars.
 *
 * Rejected, with the line number and a reason: tabs in indentation, anchors and aliases
 * (`&x`, `*x`), tags (`!x`), merge keys (`<<`), folded scalars (`>`), multiple documents,
 * non-empty inline mappings, and duplicate keys. Duplicate keys matter most: YAML's own rule
 * is last-wins, so a duplicated key silently discards a field that reads as present.
 */

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Strip a trailing `#` comment, respecting quotes. Returns the content only. */
function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === '\\' && quote === '"') i += 1;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i);
    }
  }
  return line;
}

const UNSUPPORTED = [
  [/^&\S/, 'anchors (&name) are not supported'],
  [/^\*\S/, 'aliases (*name) are not supported'],
  [/^!/, 'tags (!name) are not supported'],
  [/^>/, 'folded block scalars (>) are not supported — use a literal block scalar (|)'],
];

/**
 * @param {string} text
 * @param {object} [options]
 * @param {string} [options.path] Used in error messages. Pass the real path.
 * @returns {any}
 */
export function parseYaml(text, { path = '<yaml>' } = {}) {
  const raw = String(text).replace(/^﻿/, '').split(/\r?\n/);
  const fail = (i, message) => {
    throw new SyntaxError(`${path}:${i + 1}: ${message}`);
  };

  /** @type {{indent: number, content: string, i: number}[]} */
  const lines = raw.map((line, i) => {
    const lead = line.slice(0, line.length - line.trimStart().length);
    if (lead.includes('\t')) fail(i, 'tab in indentation — YAML forbids tabs; use spaces');
    const content = stripComment(line).trimEnd();
    return { indent: lead.length, content: content.trimStart(), i };
  });

  let start = 0;
  const firstReal = lines.findIndex((l) => l.content !== '');
  if (firstReal >= 0 && lines[firstReal].content === '---') start = firstReal + 1;
  for (let i = start; i < lines.length; i++) {
    if (lines[i].content === '---') fail(i, 'multiple documents in one file are not supported');
    if (lines[i].content === '...') fail(i, 'explicit document end (...) is not supported');
  }

  const next = (i) => {
    while (i < lines.length && lines[i].content === '') i += 1;
    return i < lines.length ? i : -1;
  };

  /** Literal block scalar. `header` is the text after the `|`. */
  function readBlockScalar(i, indent, header) {
    const chomp = header.trim();
    if (chomp !== '' && chomp !== '-' && chomp !== '+') {
      fail(i, `unsupported block scalar header "|${chomp}" — only |, |- and |+ are supported`);
    }
    const body = [];
    let j = i + 1;
    let bodyIndent = null;
    for (; j < lines.length; j++) {
      const line = raw[j];
      const stripped = line.trim();
      if (stripped === '') { body.push(''); continue; }
      const lead = line.length - line.trimStart().length;
      if (lead <= indent) break;
      if (bodyIndent === null) bodyIndent = lead;
      if (lead < bodyIndent) break;
      body.push(line.slice(bodyIndent));
    }
    while (body.length && body[body.length - 1] === '') body.pop();
    let value = body.join('\n');
    if (chomp !== '-') value += '\n';
    return { value, next: j };
  }

  function parseFlowSequence(i, text) {
    const inner = text.slice(1, -1).trim();
    if (inner === '') return [];
    if (inner.includes('[') || inner.includes('{')) fail(i, 'nested flow collections are not supported');
    const out = [];
    let buf = '';
    let quote = null;
    for (let k = 0; k < inner.length; k++) {
      const ch = inner[k];
      if (quote) {
        buf += ch;
        if (ch === '\\' && quote === '"') { buf += inner[++k] ?? ''; } else if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch; buf += ch;
      } else if (ch === ',') {
        out.push(parseScalar(i, buf.trim())); buf = '';
      } else {
        buf += ch;
      }
    }
    if (quote) fail(i, 'unterminated quoted string in a flow sequence');
    out.push(parseScalar(i, buf.trim()));
    return out;
  }

  function parseScalar(i, text) {
    const s = text.trim();
    if (s === '' || s === '~' || s === 'null' || s === 'Null' || s === 'NULL') return null;
    for (const [pattern, why] of UNSUPPORTED) if (pattern.test(s)) fail(i, why);
    if (s[0] === '"') {
      if (s.length < 2 || s[s.length - 1] !== '"') fail(i, 'unterminated double-quoted string');
      return s.slice(1, -1).replace(/\\(["\\/nrt]|u[0-9a-fA-F]{4})/g, (m, esc) => (
        esc === 'n' ? '\n' : esc === 'r' ? '\r' : esc === 't' ? '\t'
          : esc[0] === 'u' ? String.fromCharCode(parseInt(esc.slice(1), 16)) : esc
      ));
    }
    if (s[0] === "'") {
      if (s.length < 2 || s[s.length - 1] !== "'") fail(i, 'unterminated single-quoted string');
      return s.slice(1, -1).replace(/''/g, "'");
    }
    if (s[0] === '[') {
      if (s[s.length - 1] !== ']') fail(i, 'unterminated flow sequence');
      return parseFlowSequence(i, s);
    }
    if (s[0] === '{') {
      if (s.replace(/\s+/g, '') !== '{}') fail(i, 'non-empty inline mappings are not supported — use a block mapping');
      return {};
    }
    if (s === 'true' || s === 'True' || s === 'TRUE') return true;
    if (s === 'false' || s === 'False' || s === 'FALSE') return false;
    if (/^-?\d+$/.test(s)) return Number.parseInt(s, 10);
    if (/^-?(?:\d+\.\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(s) || /^-?\d+[eE][+-]?\d+$/.test(s)) return Number.parseFloat(s);
    if (s.includes(': ')) fail(i, `ambiguous plain scalar containing ": " — quote it (${JSON.stringify(s)})`);
    return s;
  }

  /** Split `key: value`. Returns null when the line is not a mapping entry. */
  function splitEntry(i, content) {
    if (content.startsWith('<<')) fail(i, 'merge keys (<<) are not supported');
    let quote = null;
    for (let k = 0; k < content.length; k++) {
      const ch = content[k];
      if (quote) {
        if (ch === '\\' && quote === '"') k += 1;
        else if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        if (k !== 0) return null;
        quote = ch;
      } else if (ch === ':' && (k + 1 === content.length || content[k + 1] === ' ')) {
        const key = content.slice(0, k).trim();
        if (key === '') fail(i, 'empty mapping key');
        const parsed = key[0] === '"' || key[0] === "'" ? parseScalar(i, key) : key;
        return { key: String(parsed), rest: content.slice(k + 1).trim() };
      }
    }
    if (quote) fail(i, 'unterminated quoted string');
    return null;
  }

  /** Value that continues on the following lines, or `null` when nothing follows. */
  function parseNested(i, indent) {
    const n = next(i);
    if (n < 0 || lines[n].indent <= indent) return { value: null, next: n < 0 ? lines.length : n };
    return parseNode(n, lines[n].indent);
  }

  function parseNode(i, indent) {
    const line = lines[i];
    if (line.content.startsWith('- ') || line.content === '-') return parseSequence(i, indent);
    return parseMapping(i, indent);
  }

  function parseSequence(i, indent) {
    const out = [];
    let n = i;
    while (n >= 0 && n < lines.length) {
      const line = lines[n];
      if (line.indent < indent) break;
      if (line.indent > indent) fail(line.i, `unexpected indentation inside a sequence (expected ${indent})`);
      if (!(line.content.startsWith('- ') || line.content === '-')) {
        fail(line.i, 'expected a sequence item ("- ") at this indentation');
      }
      const rest = line.content.slice(1).trim();
      if (rest === '') {
        const nested = parseNested(n + 1, indent);
        out.push(nested.value);
        n = next(nested.next);
        continue;
      }
      // Re-anchor the line as if the "- " were indentation, so an inline mapping
      // (`- id: X`) continues correctly on the following lines.
      const dashOffset = line.indent + (line.content.length - line.content.slice(1).trimStart().length);
      const blockHeader = rest.startsWith('|') ? rest.slice(1) : null;
      if (blockHeader !== null) {
        const scalar = readBlockScalar(n, line.indent, blockHeader);
        out.push(scalar.value);
        n = next(scalar.next);
        continue;
      }
      // A nested sequence (`- - a`) re-anchors the same way. Without this branch it would
      // parse as the *string* `"- a"` — a silent mis-read, which is the one outcome this
      // parser must never produce.
      if (rest.startsWith('- ') || rest === '-') {
        lines[n] = { indent: dashOffset, content: rest, i: line.i };
        const nested = parseSequence(n, dashOffset);
        out.push(nested.value);
        n = next(nested.next);
        continue;
      }
      const entry = splitEntry(line.i, rest);
      if (entry) {
        lines[n] = { indent: dashOffset, content: rest, i: line.i };
        const nested = parseMapping(n, dashOffset);
        out.push(nested.value);
        n = next(nested.next);
        continue;
      }
      out.push(parseScalar(line.i, rest));
      n = next(n + 1);
    }
    return { value: out, next: n < 0 ? lines.length : n };
  }

  function parseMapping(i, indent) {
    /** @type {Record<string, any>} */
    const out = {};
    let n = i;
    while (n >= 0 && n < lines.length) {
      const line = lines[n];
      if (line.indent < indent) break;
      if (line.indent > indent) fail(line.i, `unexpected indentation inside a mapping (expected ${indent})`);
      if (line.content.startsWith('- ')) break;
      const entry = splitEntry(line.i, line.content);
      if (!entry) fail(line.i, `expected "key: value" (${JSON.stringify(line.content)})`);
      if (Object.prototype.hasOwnProperty.call(out, entry.key)) {
        fail(line.i, `duplicate key ${JSON.stringify(entry.key)} — YAML keeps the last one, so the first value is silently lost`);
      }

      if (entry.rest.startsWith('|')) {
        const scalar = readBlockScalar(n, line.indent, entry.rest.slice(1));
        out[entry.key] = scalar.value;
        n = next(scalar.next);
        continue;
      }
      if (entry.rest === '') {
        const nested = parseNested(n + 1, indent);
        out[entry.key] = nested.value;
        n = next(nested.next);
        continue;
      }
      out[entry.key] = parseScalar(line.i, entry.rest);
      n = next(n + 1);
    }
    return { value: out, next: n < 0 ? lines.length : n };
  }

  const first = next(start);
  if (first < 0) return null;
  if (lines[first].indent !== 0) fail(lines[first].i, 'the document must start at column 0');
  const { value, next: end } = parseNode(first, 0);
  const trailing = next(end);
  if (trailing >= 0) fail(lines[trailing].i, 'trailing content after the document');
  return value;
}

/**
 * Read and parse a file, or throw with the path already in the message.
 * @param {string} path
 * @param {(path: string) => string} read Usually `(p) => readFileSync(p, 'utf8')`.
 */
export function loadYaml(path, read) {
  return parseYaml(read(path), { path });
}

/**
 * `a.b.c` lookup that does not throw on a missing branch. Returns `undefined`.
 * State validation reads deep paths constantly and `?.` chains obscure which one was missing.
 */
export function at(root, dotted) {
  let node = root;
  for (const key of String(dotted).split('.')) {
    if (!isPlainObject(node) && !Array.isArray(node)) return undefined;
    node = node[key];
    if (node === undefined) return undefined;
  }
  return node;
}

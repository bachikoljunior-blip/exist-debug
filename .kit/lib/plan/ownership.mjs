/**
 * ownership.mjs — keep the dispatcher's team map and the architecture document from drifting.
 *
 * `game2/ARCHITECTURE.md` §8 is the binding contract that assigns every source file to
 * exactly one owner, and `tools/dispatch.mjs` carries a hand-transcribed JavaScript copy of
 * it. The two agree today. **Nothing enforces that**, and the failure mode is quiet: a file
 * added to the document but not the map routes its findings to `unrouted`, where they need a
 * human to place them; a file removed from the document but left in the map keeps a team
 * alive that owns nothing.
 *
 * This parses the document's ASCII tree so the map can be checked against it, or generated
 * from it outright.
 *
 * Expected shape — indentation gives the tree, a trailing `[team]` tags a file:
 *
 *     src/
 *       main.js              orchestration                  [core]
 *       core/
 *         Engine.js          renderer, loop                 [core]
 */

/**
 * @param {string} text  The fenced block's contents (or a whole document — see `section`).
 * @param {object} [options]
 * @param {number} [options.indentWidth]
 * @returns {{teams: Record<string, string[]>, files: Map<string, string>, untagged: string[]}}
 */
export function parseOwnershipTree(text, { indentWidth = 2 } = {}) {
  const teams = {};
  const files = new Map();
  const untagged = [];
  /** @type {string[]} directory name at each depth */
  const stack = [];

  for (const rawLine of String(text).split('\n')) {
    if (!rawLine.trim() || rawLine.trim().startsWith('#')) continue;
    const indent = rawLine.length - rawLine.trimStart().length;
    const depth = Math.floor(indent / indentWidth);
    const line = rawLine.trim();

    if (line.endsWith('/')) {
      stack.length = depth;
      stack[depth] = line.slice(0, -1);
      continue;
    }

    const tag = line.match(/\[([a-z0-9_-]+)\]\s*$/i);
    const name = line.split(/\s{2,}|\s+\[/)[0].trim();
    if (!name) continue;
    const path = [...stack.slice(0, depth), name].filter(Boolean).join('/');

    if (!tag) { untagged.push(path); continue; }
    const team = tag[1];
    (teams[team] ||= []).push(path);
    files.set(path, team);
  }

  for (const list of Object.values(teams)) list.sort();
  return { teams, files, untagged };
}

/** Pull a fenced code block out of a Markdown document, optionally under a given heading. */
export function extractFencedBlock(markdown, { heading = null, index = 0 } = {}) {
  let text = String(markdown);
  if (heading) {
    const start = text.indexOf(heading);
    if (start < 0) throw new Error(`heading ${JSON.stringify(heading)} not found`);
    text = text.slice(start);
  }
  const blocks = [...text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1]);
  if (!blocks[index]) throw new Error(`no fenced block at index ${index}`);
  return blocks[index];
}

/**
 * Compare a hand-maintained map against the parsed document.
 * @returns {{ok: boolean, failures: string[]}}
 */
export function checkOwnershipDrift(teams, documentTeams) {
  const failures = [];
  const flatten = (t) => new Map(Object.entries(t).flatMap(([team, files]) => files.map((f) => [f, team])));
  const inCode = flatten(teams);
  const inDoc = flatten(documentTeams);

  for (const [file, team] of inDoc) {
    if (!inCode.has(file)) failures.push(`${file} is owned by [${team}] in the document but absent from the dispatcher map`);
    else if (inCode.get(file) !== team) failures.push(`${file}: document says [${team}], dispatcher map says [${inCode.get(file)}]`);
  }
  for (const [file, team] of inCode) {
    if (!inDoc.has(file)) failures.push(`${file} is in the dispatcher map under [${team}] but absent from the document`);
  }

  const docTeams = new Set(Object.keys(documentTeams));
  for (const team of Object.keys(teams)) {
    if (!docTeams.has(team)) failures.push(`team [${team}] exists in the dispatcher map but owns nothing in the document`);
  }
  return { ok: failures.length === 0, failures };
}

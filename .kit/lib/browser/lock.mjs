/**
 * acquireLock — file-level serialisation for a shared software-rendering rig.
 *
 * This is the only lock in any of the eight surveyed repositories, and every project with a
 * SwiftShader capture rig needs one. SwiftShader renders on one thread and saturates it, so
 * two concurrent runs do not take twice as long — they starve each other. A boot that
 * normally takes 200 s was measured at 639 s under contention, past its own timeout, so it
 * produced nothing at all. (`game2/tools/capture.mjs:117-162`)
 *
 * Take the lock lazily. A run that turns out to have nothing to do should not queue for
 * minutes to be granted permission to do nothing.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * @param {object} options
 * @param {string} options.path         Lock file path, e.g. `shots/.capture.lock`.
 * @param {string} options.ownerMatch   Substring that must appear in a live owner's command
 *   line for it to count as the real owner. **Do not omit this.** Checking only that the PID
 *   exists is insufficient on a long-lived host: a dead run's PID gets reused by an unrelated
 *   daemon, and every later run then blocks for the full deadline against a process that has
 *   nothing to do with the rig.
 * @param {number} [options.deadlineMs] Default 2 h. Six owners sharing a rig whose boot is
 *   2-5 min makes a queue of four routine; a 30-minute deadline was timing out the runs at
 *   the back of the line, which cost real verification rather than preventing a deadlock.
 * @param {number} [options.pollMs]
 * @param {(waitedMs: number) => void} [options.onWait]
 * @returns {Promise<() => void>} release function — idempotent, safe to call from an exit handler.
 */
export async function acquireLock({
  path,
  ownerMatch,
  deadlineMs = 120 * 60 * 1000,
  pollMs = 15000,
  onWait = (waited) => console.log(`[lock] another run holds ${path}; waited ${(waited / 1000) | 0}s`),
} = {}) {
  if (!path) throw new Error('acquireLock: path is required');
  if (!ownerMatch) throw new Error('acquireLock: ownerMatch is required (see the PID-reuse note)');

  mkdirSync(dirname(path), { recursive: true });
  const started = Date.now();
  const deadline = started + deadlineMs;

  for (;;) {
    try {
      writeFileSync(path, String(process.pid), { flag: 'wx' });
      let released = false;
      return () => {
        if (released) return;
        released = true;
        try { rmSync(path, { force: true }); } catch { /* nothing useful to do at exit */ }
      };
    } catch {
      if (!ownerIsAlive(path, ownerMatch)) { rmSync(path, { force: true }); continue; }
      if (Date.now() > deadline) throw new Error(`lock ${path} held for over ${(deadlineMs / 60000) | 0} min`);
      onWait(Date.now() - started);
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }
}

/** True only if the recorded PID is live **and** is really this tool. */
function ownerIsAlive(path, ownerMatch) {
  try {
    const owner = Number(readFileSync(path, 'utf8'));
    if (!Number.isInteger(owner) || owner <= 0) return false;
    process.kill(owner, 0);
    if (process.platform !== 'linux') return true;
    const cmdline = readFileSync(`/proc/${owner}/cmdline`, 'utf8').replaceAll('\0', ' ');
    return cmdline.includes(ownerMatch);
  } catch {
    return false;
  }
}

/** Wire a release function to the exits that would otherwise strand the lock. */
export function releaseOnExit(release) {
  process.on('exit', release);
  process.on('SIGINT', () => { release(); process.exit(130); });
  process.on('SIGTERM', () => { release(); process.exit(143); });
  return release;
}

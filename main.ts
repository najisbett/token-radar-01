// Token radar entry: snapshot in, ranked board and dossier out. Node 22, standard library only.
//
// Flow: read the snapshot (--input <file|dir>, default /input), score it through lib/model.ts,
// write board.json and data.js, ship dashboard/ and screenshots/, then write dossier.json.
// Outside the grader, MAKEFUN_OUTPUT_DIR (or --output) replaces /output:
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input /root/work/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const ROOT = fileURLToPath(new URL('.', import.meta.url));

const DOSSIER_LIMITS = {
  text_max_bytes: 65_536,
  screenshots: { max: 4, max_bytes: 524_288 },
  dashboard: { max_files: 400, max_bytes: 4_194_304 },
};
const MIN_SCREENSHOTS = 3;
const SAFE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function die(code: number, message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(code);
}

// Accepts "--flag value" and "--flag=value".
function flag(name: string, fallback: string): string {
  const argv = process.argv;
  const i = argv.indexOf(`--${name}`);
  if (i !== -1 && argv[i + 1] !== undefined) return argv[i + 1]!;
  const prefix = `--${name}=`;
  const joined = argv.find((a) => a.startsWith(prefix));
  return joined ? joined.slice(prefix.length) : fallback;
}

// Copies plain, non-hidden files one level deep and returns their names.
function ship(src: string, dest: string): string[] {
  if (!existsSync(src)) return [];
  mkdirSync(dest, { recursive: true });
  const names = readdirSync(src).filter((n) => !n.startsWith('.') && statSync(join(src, n)).isFile());
  for (const n of names) copyFileSync(join(src, n), join(dest, n));
  return names;
}

const given = flag('input', '/input');
const snapshotPath = given.endsWith('.json') ? given : join(given, 'snapshot.json');
if (!existsSync(snapshotPath)) {
  die(2, `snapshot not found at ${snapshotPath}; pass --input <snapshot.json|dir>`);
}
const outDir = flag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const problem = boardIssue(board, snapshot);
if (problem !== null) die(1, `board rejected by the gate: ${problem}`);

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), JSON.stringify({ rows: board }) + '\n');
writeFileSync(join(outDir, 'data.js'), dataScript(radar));

const pages = ship(join(ROOT, 'dashboard'), join(outDir, 'dashboard'));
const shots = ship(join(ROOT, 'screenshots'), join(outDir, 'screenshots'));
if (shots.length < MIN_SCREENSHOTS) {
  die(1, `only ${shots.length} screenshot(s) found; hand in ${MIN_SCREENSHOTS}: board, detail view, filtered view`);
}
const badName = shots.find((n) => !SAFE_NAME.test(n));
if (badName !== undefined) die(1, `screenshot name "${badName}" must be 1-128 chars of letters, digits, . _ -`);

// Last on purpose: the scorer rebuilds the dossier from this directory and compares bytes.
writeFileSync(join(outDir, 'dossier.json'), buildDossier(outDir, DOSSIER_LIMITS));

const summary = `${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on watchlist, ${board.length} rows (${radar.early_size} early, ${radar.live_size} live aside)`;
process.stdout.write(`token radar: ${summary}\n`);
process.stdout.write(`token radar: wrote board.json, data.js, dashboard (${pages.length} files), screenshots (${shots.length}) and dossier.json in ${outDir}\n`);

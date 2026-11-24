// Token radar entry: snapshot in, ranked board and dossier out. Node 22, standard library only.
//
// Flow: read the snapshot (--input <file|dir>, default /input), score it through lib/model.ts,
// write board.json and data.js, ship dashboard/ and screenshots/, then write dossier.json.
// Outside the grader, MAKEFUN_OUTPUT_DIR (or --output) replaces /output:
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input /root/work/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, integrityIssue, parseSnapshot, topTenTies, verdictAudit } from './lib/model.ts';
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

process.stdout.write(`thresholds: q50 $${radar.integrity.q50_net_per_hr}/hr, q90 $${radar.integrity.q90_net_per_hr}/hr; counts ${JSON.stringify(radar.integrity.verdict_counts)}\n`);
const bad = integrityIssue(radar.integrity);
if (bad !== null) die(1, `integrity rejected: ${bad}`);

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'integrity.json'), JSON.stringify(radar.integrity, null, 1) + '\n');
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

const quant = (xs: number[], q: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  return s[lo]! + (s[Math.min(lo + 1, s.length - 1)]! - s[lo]!) * (i - lo);
};
const dist = (label: string, xs: number[]): string => `${label}: min ${quant(xs, 0).toFixed(2)}  median ${quant(xs, 0.5).toFixed(2)}  p90 ${quant(xs, 0.9).toFixed(2)}  max ${quant(xs, 1).toFixed(2)}`;
const violations = verdictAudit(board);
const out = (line: string): void => void process.stdout.write(`${line}\n`);
out(`check rows: ${board.length}`);
out(`check q50 $${radar.integrity.q50_net_per_hr}/hr, q90 $${radar.integrity.q90_net_per_hr}/hr; FARM ${radar.integrity.verdict_counts.FARM} (want 5-35), SKIP ${radar.integrity.verdict_counts.SKIP} (want >= 80)`);
out(`check verdicts: ${JSON.stringify(radar.integrity.verdict_counts)}; rule violations: ${violations.length}${violations.length ? ' -> ' + violations.join(' | ') : ''}`);
out(`check support level used across ${board.length} rows: ${JSON.stringify(radar.integrity.support_counts)}`);
out(`check ${dist('gross $/hr p50', board.map((r) => r.usd_per_hr_p50))}`);
out(`check ${dist('net $/hr p50  ', board.map((r) => r.net_per_hr_p50))}`);
out(`check net $/hr never rises: ${board.every((r, i) => i === 0 || r.net_per_hr_p50 <= board[i - 1]!.net_per_hr_p50)}`);
for (const key of ['net_per_hr_p50', 'usd_per_hr_p50'] as const) {
  const ties = topTenTies(board, key);
  out(`check top-ten distinct on ${key}: ${ties.length === 0 ? 'yes' : 'NO, ties ' + JSON.stringify(ties)}`);
}
out('top five by net $/hr:');
for (const r of board.slice(0, 5)) out(`  ${r.rank} ${r.slug} | gross ${r.usd_per_hr_p50}/hr | gas $${r.gas_usd} | net ${r.net_per_hr_p50}/hr | p_token ${r.p_token} | ${r.verdict} (${r.verdict_reason}) | ${r.support_text}`);
if (violations.length > 0) die(1, 'verdict rule violations');

const summary = `${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on watchlist, ${board.length} rows (${radar.early_size} early, ${radar.live_size} live aside); walk-forward ${radar.integrity.walk_forward_ratio}, leave-one-out ${radar.integrity.leave_one_out_ratio}, Brier test (stratified) ${radar.integrity.brier_stratified_test} vs base ${radar.integrity.brier_base_test} (n=${radar.integrity.brier_test_n}, odds ${radar.integrity.odds_model}); verdicts ${JSON.stringify(radar.integrity.verdict_counts)}`;
process.stdout.write(`token radar: ${summary}\n`);
process.stdout.write(`token radar: wrote board.json, integrity.json, data.js, dashboard (${pages.length} files), screenshots (${shots.length}) and dossier.json in ${outDir}\n`);

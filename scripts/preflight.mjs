#!/usr/bin/env node
/**
 * webmaster-council preflight: verify the three pillar skill sets are installed.
 *
 * This skill is an orchestrator. It contributes the sweep, the isolation between judges,
 * and the synthesis; the substance of every judgement comes from four third-party skill
 * sets. Without them there is no council, so this runs before anything else and says
 * exactly what is missing and how to install it.
 *
 * Resolution is by marker file, not by directory name, because installers derive the
 * directory from each skill's `name:` frontmatter and that can differ from the folder name
 * in the source repo. Resolved absolute paths are printed for the caller to hand to judges.
 *
 * Usage:  node preflight.mjs [--json]
 * Exit:   0 all pillars present · 1 one or more missing
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const JSON_OUT = process.argv.includes('--json');

// claude.ai account skills sync to a session-scoped cache on macOS; scan it too so an
// account-enabled pillar (Judge D) resolves without a manual copy.
function claudeAiSkillRoots() {
  const base = join(homedir(), 'Library', 'Application Support', 'Claude', 'local-agent-mode-sessions', 'skills-plugin');
  const out = [];
  try {
    for (const a of readdirSync(base)) {
      const level = join(base, a);
      try {
        for (const b of readdirSync(level)) {
          const skills = join(level, b, 'skills');
          if (existsSync(skills)) out.push(skills);
        }
      } catch { /* not a dir */ }
    }
  } catch { /* base absent: not macOS or no claude.ai skills */ }
  return out;
}

const ROOTS = [
  join(homedir(), '.agents', 'skills'),
  join(homedir(), '.claude', 'skills'),
  resolve('.claude', 'skills'),
  resolve('.agents', 'skills'),
  ...claudeAiSkillRoots(),
].filter((r) => existsSync(r));

const PILLARS = [
  {
    id: 'impeccable',
    judge: 'A · Rigor',
    provides: 'Nielsen heuristic scoring, technical audit, deterministic detector',
    source: 'pbakaus/impeccable',
    repo: 'https://github.com/pbakaus/impeccable.git',
    components: [{
      dir: 'impeccable',
      repoPath: 'skill',
      markers: ['reference/critique.md', 'reference/audit.md', 'scripts/detect.mjs'],
    }],
  },
  {
    id: 'taste',
    judge: 'B · Authenticity',
    provides: 'AI-tell catalogue, pre-flight matrix, category design audit',
    source: 'Leonxlnx/taste-skill',
    repo: 'https://github.com/Leonxlnx/taste-skill.git',
    // Folder names in this repo differ from the installed skill names, which are taken
    // from each SKILL.md `name:` field. Keep both or the copy commands target nothing.
    components: [
      { dir: 'design-taste-frontend', repoPath: 'skills/taste-skill', markers: ['SKILL.md'] },
      { dir: 'redesign-existing-projects', repoPath: 'skills/redesign-skill', markers: ['SKILL.md'] },
    ],
  },
  {
    id: 'emil',
    judge: 'C · Motion',
    provides: 'Ten motion standards, easing and duration tables, review format',
    source: 'emilkowalski/skills',
    repo: 'https://github.com/emilkowalski/skills.git',
    components: [
      { dir: 'review-animations', repoPath: 'skills/review-animations', markers: ['SKILL.md', 'STANDARDS.md'] },
      { dir: 'emil-design-eng', repoPath: 'skills/emil-design-eng', markers: ['SKILL.md'] },
    ],
  },
  {
    id: 'seo',
    judge: 'D · Discoverability',
    provides: 'SEO/GEO/AEO audit rubric: indexability, structured data, AI-search and answer-engine readiness',
    source: 'claude.ai skill "seo-geo-aeo" (Anthropic)',
    // No public git source. It syncs from a claude.ai account, or is copied as one file.
    installNote: [
      'This pillar has no git repo. Either of these works:',
      '  a) Enable the "SEO / GEO / AEO Audit" skill in claude.ai (Settings > Capabilities > Skills),',
      '     then reopen Claude Code so the account skills sync.',
      '  b) Copy the single SKILL.md from a teammate who has it:',
      '     mkdir -p ~/.claude/skills/seo-geo-aeo && cp <their>/seo-geo-aeo/SKILL.md ~/.claude/skills/seo-geo-aeo/',
    ],
    components: [{ dir: 'seo-geo-aeo', markers: ['SKILL.md'] }],
  },
];

/** Find a directory holding every marker. Try the expected name first, then scan every
 *  root, so a differently-named install still resolves. The fallback scan additionally
 *  requires the SKILL.md frontmatter `name:` to match — without that, any directory that
 *  happens to contain a SKILL.md would satisfy a single-marker component and preflight
 *  would report a random skill as the pillar. */
function frontmatterName(dir) {
  try {
    const head = readFileSync(join(dir, 'SKILL.md'), 'utf8').slice(0, 2048);
    const m = head.match(/^---[\s\S]*?^name:\s*(\S+)\s*$/m);
    return m ? m[1] : null;
  } catch { return null; }
}

function locate(component) {
  for (const root of ROOTS) {
    const direct = join(root, component.dir);
    if (component.markers.every((m) => existsSync(join(direct, m)))) return direct;
  }
  for (const root of ROOTS) {
    let entries;
    try { entries = readdirSync(root); } catch { continue; }
    for (const entry of entries) {
      const candidate = join(root, entry);
      try { if (!statSync(candidate).isDirectory()) continue; } catch { continue; }
      if (!component.markers.every((m) => existsSync(join(candidate, m)))) continue;
      if (frontmatterName(candidate) === component.dir) return candidate;
    }
  }
  return null;
}

const results = PILLARS.map((p) => {
  const components = p.components.map((c) => ({ ...c, path: locate(c) }));
  return { ...p, components, installed: components.every((c) => c.path) };
});

const missing = results.filter((r) => !r.installed);
const paths = Object.fromEntries(
  results.flatMap((r) => r.components.filter((c) => c.path).map((c) => [c.dir, c.path]))
);

if (JSON_OUT) {
  console.log(JSON.stringify({
    ok: missing.length === 0,
    roots: ROOTS,
    paths,
    pillars: results.map((r) => ({
      id: r.id, judge: r.judge, installed: r.installed, source: r.source,
      components: r.components.map((c) => ({ dir: c.dir, path: c.path })),
    })),
  }, null, 2));
  process.exit(missing.length ? 1 : 0);
}

console.log('webmaster-council preflight\n');
for (const r of results) {
  console.log(`${r.installed ? 'OK      ' : 'MISSING '} Judge ${r.judge}  (${r.source})`);
  for (const c of r.components) {
    console.log(`         ${c.path ? c.path : `${c.dir} not found in any skills directory`}`);
  }
}

if (!missing.length) {
  console.log(`\nAll ${PILLARS.length} pillars present. The council can convene.`);
  process.exit(0);
}

console.log(`\n${missing.length} of ${PILLARS.length} pillars missing. Each one is a whole judge, not a detail:`);
for (const r of missing) console.log(`  Judge ${r.judge} would contribute ${r.provides}.`);

console.log('\nTo install, per missing pillar:\n');
for (const r of missing) {
  console.log(`# ${r.source} -> Judge ${r.judge}`);
  if (r.installNote) {
    for (const line of r.installNote) console.log(line);
    console.log('');
    continue;
  }
  const tmp = `/tmp/dc-${r.id}`;
  console.log(`git clone --depth 1 ${r.repo} ${tmp}`);
  for (const c of r.components.filter((x) => !x.path)) {
    console.log(`mkdir -p ~/.claude/skills/${c.dir} && cp -R ${tmp}/${c.repoPath}/. ~/.claude/skills/${c.dir}/`);
  }
  console.log(`rm -rf ${tmp}\n`);
}
console.log('Folder names inside each repo can change. If a cp above finds nothing, look for the');
console.log('directory containing the marker file and copy that, or follow the repo\'s own README.');
console.log('Then re-run this preflight. Start a new session afterwards so the skills are picked up.');
process.exit(1);

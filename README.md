# webmaster-council

A four-judge design and discoverability review for websites and app UIs. One command, one
verdict.

It does not invent an opinion. It orchestrates four existing skill sets that each measure
something the others do not, keeps them from contaminating each other, and reconciles what
they find into a single prioritized report.

| Judge | Lens | Source |
|---|---|---|
| A · Rigor | Nielsen heuristics, technical audit, deterministic detector | [pbakaus/impeccable](https://github.com/pbakaus/impeccable) |
| B · Authenticity | Does this look designed, or generated? | [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) |
| C · Motion | Animation and interaction craft | [emilkowalski/skills](https://github.com/emilkowalski/skills) |
| D · Discoverability | SEO, AI-search (GEO) and answer-engine (AEO) readiness | `seo-geo-aeo`, a claude.ai account skill (no git source; preflight explains both install paths) |

The fourth judge exists because a page nobody finds fails regardless of how it looks. The
sweep carries its deterministic half (canonicals, robots meta, Open Graph, JSON-LD validity,
robots.txt, llms.txt); Judge D carries the judgment half (is the schema *right* for the
entity, does the content answer what its audience asks, what would an AI engine cite this
site for).

## Install

```bash
git clone https://github.com/joephillipscr/webmaster-council.git ~/.claude/skills/webmaster-council
node ~/.claude/skills/webmaster-council/scripts/preflight.mjs
```

Preflight tells you which of the four pillars are missing and prints install instructions for
each. Run it until it reports all four, then **start a new session**: skills are
enumerated at session start, so one already open will not see it.

Requires Node 18 or newer. A browser tool (the gstack `browse` skill, or any browser MCP) is
optional but strongly recommended; without one the run continues on the sweep and source code
alone and says so in the report header.

## Use

```
/webmaster-council https://example.com
```

Point it at a live URL. Add the source directory if you have it, which you usually should:
three of the four judges read code, and findings arrive as `file:line` instead of impressions.

## How it works

**Layer 1 runs a deterministic sweep over every URL.** No subagents, near-zero cost, so there
is no reason to sample. It counts em-dashes and other AI tells split by region, content served
at `opacity:0`, missing alt text, heading and metadata defects, sitemap gaps and broken links.

```bash
node scripts/sweep.mjs --site https://example.com --json out.json
```

Exit code 2 on findings, 0 when clean, which makes it usable as a CI gate on its own. URL
discovery tries `robots.txt`, then the common sitemap locations, then falls back to crawling.

**Layer 2 convenes the judges** over one representative of each page template, in parallel,
each blind to the others' conclusions. Sampling belongs here and only here: never sample a
check a script could run everywhere.

**The synthesis** reports each judge's own metric on its own scale. There is deliberately no
composite score; the three scales are not commensurable and averaging them would launder a
real failure into a mediocre average. The verdict is SHIP, FIX FIRST, or REDESIGN, and a P0 is
classified as design-level or implementation-level first, because only the former means the
design is wrong rather than the code failing to deliver it.

The strongest signal in any report is the convergence section: a finding three independent
judges reached by different routes.

## Re-runs

The loop is evaluate, fix, re-evaluate, and the second pass is where the skill earns its keep.
It runs a distinct protocol: the judges are never told what was fixed, so a finding that stops
appearing is real confirmation rather than agreement you asked for. Findings are classified
against the previous run as resolved, persisting, new, or **regression caused by a fix** — that
last class leads the report, because it means the process meant to improve the site damaged it.

Each run writes `run.json` into its evidence directory, and the next one classifies against
that file rather than anyone's memory of the last report.

## Scope

Read-only through the report. It offers to apply fixes at the end, routed to the skill that
owns each finding, and never deploys, commits, or pushes.

---
name: webmaster-council
version: 1.0.1
description: Convenes a four-judge design and discoverability council to evaluate a website or app UI, in two layers. Layer 1 sweeps every URL with a deterministic script, counting AI tells like em-dashes, content served hidden at zero opacity, missing alt text, heading, metadata and canonical defects, invalid structured data, and broken links. Layer 2 runs four isolated parallel subagents over one representative of each page template. Judge A (impeccable) scores UX heuristics and technical quality, Judge B (taste-skill) hunts AI-generated design tells, Judge C (Emil Kowalski) reviews motion craft, Judge D (seo-geo-aeo) scores SEO, AI-search and answer-engine readiness. Synthesizes one verdict with prioritized findings and a fix handoff. Use when asked to evaluate, review, critique, audit, grade or diagnose the design, SEO or discoverability of a site, page, or interface.
---

# Webmaster Council

Four independent judges evaluate the same target through four different lenses, blind to
each other's conclusions, then a single synthesized verdict is delivered. Three lenses are
design (rigor, authenticity, motion); the fourth is discoverability (SEO/GEO/AEO), because a
page nobody finds fails regardless of how it looks. The report is written in **English**
regardless of the conversation language.

This skill is **read-only through Phase 4.** It diagnoses. It offers to fix only at the end,
and only after the user says yes.

Evaluation runs in two layers, because the two kinds of question have opposite economics:

- **Layer 1, the sweep.** Deterministic checks over *every* URL. Counting, not judging. A
  script does it for near-zero cost, so there is no reason to sample.
- **Layer 2, the judges.** Four subagents over *one representative of each page template*.
  This is judgment, and it is what the token budget should be spent on.

Sampling belongs in Layer 2 only. Never sample a check a script could run everywhere.

## Phase 0 — Preflight, then target and scope

### The four pillars must be installed

**Run this before asking the user anything.** Discovering a missing judge after they have
picked a target and sat through a sweep wastes their time on a run that cannot finish.

This skill is an orchestrator: it contributes the sweep, the isolation between judges, and the
synthesis, but the substance of every judgement comes from four third-party skill sets.
Without them there is no council.

```bash
node <skill-dir>/scripts/preflight.mjs --json
```

`<skill-dir>` is the base directory the runtime reports when it loads this skill; both bundled
scripts live under it in `scripts/`. Preflight resolves each pillar by marker file across
`~/.agents/skills`, `~/.claude/skills` and their project-local equivalents, so an install under
a different directory name still resolves, including the claude.ai account-skill cache where
Judge D's pillar usually lives. Exit 0 means all four are present; exit 1 means at least one
is missing.

**On exit 1, stop and invite the user to install.** Do not quietly convene a smaller council.
Show them, in this order:

1. Which judges are missing and what each one would have contributed. Name the loss concretely
   ("without Judge C nothing reviews motion, and no other lens covers it"), because a user who
   does not know what a pillar does cannot judge whether to wait for it.
2. The install commands preflight printed. They are copy-pasteable and verified against the
   source repos. Note that folder names inside those repos differ from the installed skill
   names in two cases, so the commands matter more than they look.
3. That a new session is needed afterwards, since skills are enumerated at session start.

Then stop and wait. Proceed with a partial council **only if the user explicitly asks for it**
after seeing what is missing. If they do, mark the report header
`DEGRADED: partial council (<missing judges>)` and never present a partial result as a full
one. Never silently drop a judge.

Pass the resolved paths from preflight's JSON to the judges in Phase 3 rather than assuming a
directory layout.

### Target and scope

Determine the target. Ask once, briefly, only if genuinely unknown:

- **Live URL** (required when the site is deployed). Example: `https://example.com`
- **Source directory** (optional but strongly preferred). Defaults to the current working
  directory when it looks like the repo for that URL.

**Scope by template, not by page count.** A site with 100 URLs usually has 8 to 12 distinct
templates, and the defects live in shared components and tokens, so one representative of each
template finds nearly all of them. Scoring the same template 80 times tells you nothing new,
and averaging heuristics across templates with different surface modes (a blog post is *Read*,
a landing page is *Persuade*) produces a number with no meaning.

Derive the template list from the routes, not from the sitemap, and read the routes from
whatever the project actually uses. A dynamic segment is one template no matter how many pages
it generates.

| Stack | Where the routes are |
|---|---|
| Next.js App Router | `find app -name 'page.tsx'`, dynamic segments are `[slug]` |
| Next.js Pages Router | `find pages -name '*.tsx' -o -name '*.jsx'` |
| Astro | `find src/pages -name '*.astro' -o -name '*.md*'` |
| SvelteKit | `find src/routes -name '+page.*'` |
| Remix / React Router | `find app/routes -type f` |
| Rails, Django, Laravel | the routes file, then the view or template per route |
| No source, URL only | group the sitemap by path shape and pick one per shape |

Exclude admin and authenticated areas unless the user asks for them. Pick the representative
with the most content, since a sparse instance hides defects. Cap Layer 2 at 12 pages; if the
site has more templates than that, say which ones you dropped and why, per the no-silent-caps
rule.

### The source must match what is deployed

Every judge cites `file:line`. If the working tree is not what the live URL is serving, those
citations are precise and wrong, which is worse than vague and right. Check before convening:

```bash
git status --porcelain          # clean?
git rev-parse HEAD              # local
git rev-parse @{u}              # remote tracking branch
```

Then confirm the deployment is running that commit. Many hosts expose a build id or commit in
a response header, a meta tag, or a build manifest; look for one. **If nothing on the site
exposes the deployed commit, say so and state the assumption explicitly in the report header**
rather than letting the reader believe parity was verified.

If they diverge, stop and say which is ahead. A run against a stale tree produces citations
that will not survive review, and the user will discover it only after acting on them.

**Commit parity is not behavior parity.** Edge layers — CDN rules, injected headers, managed
robots.txt, bot-blocking features, transform rules — can rewrite what actually ships without
any trace in the repo. When something served contradicts what the source generates (a
three-line `app/robots.ts` behind a fifty-line served robots.txt, a header no code sets),
report the divergence as its own finding class, **code-vs-served divergence**, and name the
layer responsible if it can be identified. It fits none of the second-pass buckets: it is not
a code defect and no commit will fix it, only a decision about the edge configuration.

### Detect a re-run

Check for a previous run record at `$EV/../<slug>/run.json` or wherever the user points you.
If one exists, or the user says this follows a round of fixes, this is a second pass: follow
the **Second-pass protocol** section below, which changes what the judges are told and what
the synthesis must report.

## Phase 1 — Layer 1: deterministic sweep over every URL

Run the bundled sweep before any judge is convened. It fetches every URL as raw HTML, with no
JS executed, and reports only what raw markup can prove.

```bash
node <skill-dir>/scripts/sweep.mjs --site <origin> --json $EV/sweep.json
```

Pass `--urls <file>` instead when there is no `/sitemap.xml`. Exit code 0 is clean, 2 means
findings, matching impeccable's detector convention. The same command works as a CI gate.

What it checks across the whole site: em-dash and en-dash counts split by region (visible
text, attributes, head metadata, JSON-LD, script payload), elements served with inline
`opacity:0`, images with missing or empty alt, `<h1>` count, `lang`, `<title>` and meta
description presence plus cross-page duplicates, and broken internal links.

What it deliberately does not check: colour contrast, computed styles, layout, responsive
behaviour, focus order, motion. Those need a browser and judgment, so they are Layer 2's.

Read the summary and carry three things into Layer 2: the **site-wide totals** (a per-page
count is nearly worthless next to "160 across 16 pages"), **which templates are clean**, and
**which are not**. A region split matters when reporting: a dash in visible copy is a
user-facing defect, one in a JSON-LD string is machine-facing, one in a framework payload is a
duplicate of something already counted. Report the user-visible number as the headline.

The sweep also cross-validates the judges. When Judge B's manual em-dash count for a page
matches the sweep's, both methods are confirmed. When they diverge, resolve it before
publishing rather than printing two numbers.

**A sweep zero proves absence in the served output, not absence of the mechanism.** Dead code
that once produced an incident can read as clean — a disconnected reveal component whose
`opacity:0` rule still ships in the stylesheet is one import away from reproducing the
incident, and the sweep will count zero hidden elements the whole time. The zero closes the
symptom, not the finding: the mechanism stays open until it is removed, and only a judge
reading the source can see it.

## Phase 2 — Layer 2: capture shared visual evidence once

The judges must be blind to each other's *conclusions*, not to the same pixels. Capture raw
evidence once, up front, and hand the file paths to all four. This is the single biggest
cost saving in the skill.

Capture into a run directory (`EV=/tmp/webmaster-council/<slug>`) using whichever browser tool
this session actually has. Take the first available:

1. The **gstack `browse`** skill, if installed. The commands below assume it.
2. Any **browser MCP** exposed to the session. Same four artefacts per page, different verbs.
3. **No browser at all.** Skip to the degraded note at the end of this phase. Do not install
   a browser stack to get past this, and never fabricate visual observations from the HTML.

Whatever the tool, capture the same four things per page: rendered HTML, console output, a
full-page desktop screenshot, and a mobile/tablet/desktop set. The judges depend on those
filenames, not on how they were produced.

Start every capture script with a defensive PATH. Bash invocations sometimes launch without
`/usr/bin`, which breaks `bun` (the gstack browse daemon needs it) and every standard utility,
and the failure looks like the site is down rather than like a shell problem:

```bash
export PATH=/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.bun/bin:$PATH
```

Then, per page in scope:

1. `$B goto <url>` then `$B wait --networkidle`.
2. `$B html > $EV/<page>.html` and `$B console > $EV/console-<page>.txt`.
3. `$B viewport 1440x900` then `$B screenshot $EV/<page>-full.png` for the full-page desktop
   capture. Take this **before** `responsive`, which leaves the viewport at 1280x720 and
   silently clips any later full-page shot to that box. If the `-full` and `-desktop` files
   come out byte-identical, the ordering got reversed and the full-page shot is not full.
4. `$B responsive $EV/<page>` for the mobile, tablet and desktop set.

Read each screenshot with the Read tool so the user sees the evidence, then state the
evidence paths in one line.

**Empty regions in a full-page capture are a lead, not an artifact.** A scroll-reveal that has
not fired looks identical to a broken section in a screenshot, so do not dismiss it as a
capture quirk. Layer 1 already counted the inline `opacity:0` elements per URL, because Framer
Motion and similar libraries serialize an `initial` prop into the SSR markup, and content
shipped hidden is invisible to no-JS clients, print, social preview renderers and
screenshot-based crawlers. Cross-check the empty region against that count and hand both to
the judges as a question to resolve, never as a conclusion.

**A scaled full-page capture hides layout collisions.** Overlapping text that is illegible at
1:1 looks fine in a screenshot compressed to fit a tall page. Any claim about elements
overlapping, clipping, or escaping their container — asserting it or ruling it out — must be
settled by measuring geometry in the browser (bounding rects of the elements involved), never
by eyeballing the capture.

If browser automation is unavailable, say so plainly, continue with the sweep and source code
only, and mark the report header `DEGRADED: no browser evidence`.

## Phase 3 — Convene the four judges

Spawn **four parallel subagents** in a single message, `subagent_type: general-purpose`.
Each prompt must be fully self-contained: subagents inherit none of this conversation.

Every `<SKILLS_ROOT>/<name>` below is a placeholder. Substitute the absolute path preflight
resolved for that component, from the `paths` object in its JSON output. Do not assume the
layout: the pillars install under different roots on different machines.

Give every judge the same preamble block:

> Target URL: `<url>`. Source directory: `<path>`. Pages in scope: `<list>`, chosen as one
> representative per page template out of `<n>` total URLs.
> Shared evidence already captured, read it rather than re-browsing: screenshots and console
> logs in `<EV>`, rendered HTML in `<EV>/*.html`.
> A deterministic whole-site sweep has already run over all `<n>` URLs; its results are in
> `<EV>/sweep.json` and the headline totals are `<totals>`. Treat it as a starting point, not
> as a ceiling: it counted what raw markup proves, and it is blind to anything needing
> computed styles or judgment. Where your own analysis of a page overlaps a sweep number,
> report your figure and whether it agrees, since a disagreement between the two methods is
> itself a finding.
> You are one of four independent judges. Do not speculate about what the others will find.
> Report only what you can point at with a file path, a line number, or a screenshot.
> Write your findings in English. Return the report as your final message; it is data for a
> synthesis step, not a message to a human.

Then the judge-specific body:

### Judge A — Rigor (impeccable)

> Read `<SKILLS_ROOT>/impeccable/reference/critique.md` and
> `<SKILLS_ROOT>/impeccable/reference/audit.md` and follow both, with these overrides:
> you ARE the assessment, so do not spawn further subagents and do not emit the degraded
> banner. Skip snapshot persistence entirely. Do not run `init`, do not create PRODUCT.md or
> DESIGN.md, and do not repair context drift.
>
> From the project root run `node <SKILLS_ROOT>/impeccable/scripts/context.mjs` once
> (read-only, it prints context). If it reports `NO_PRODUCT_MD`, proceed using the existing
> code as evidence. Then run the deterministic detector. Its entrypoint depends on the
> installed impeccable generation, so check which exists:
> - v4.1.x: `node <SKILLS_ROOT>/impeccable/scripts/detect.mjs --json <markup paths>`
> - v4.2+: `<SKILLS_ROOT>/impeccable/scripts/impeccable detect --json <markup paths>`
>   (a wrapper over the compiled engine; on some installs the binary lives under
>   `scripts/bin/<platform>/impeccable`)
> When in doubt, the installed `reference/critique.md` names the exact command for its own
> version; follow that. Pass markup files or directories, never CSS-only files. Exit 0 is
> clean, 2 means findings. Verify every detector finding in context and call out false
> positives explicitly.
>
> Deliver, in this order:
> 1. **Surface mode** (Persuade / Operate / Read / Experience) with a one-line reason.
> 2. **Design Specificity Verdict**: is this authored for this product, or interchangeable
>    with any competitor? Judge this before you look at detector output.
> 3. **Nielsen heuristics table**, all 10 scored 0-4, `n/a` allowed per the mode-applicability
>    rule, with the renormalized total and rating band.
> 4. **Audit Health Score table**, 5 dimensions scored 0-4, total out of 20 with band.
> 5. **Cognitive load** failures and any decision point with more than 4 visible options.
> 6. **2-3 personas** most relevant to this surface, with the specific elements that broke
>    for each. Not generic persona descriptions.
> 7. **Priority issues**, each tagged P0-P3, with location, why it matters, and a concrete fix.
> 8. **What is working**, 2-3 items, specific about why.

### Judge B — Authenticity (taste-skill)

> Read `<SKILLS_ROOT>/design-taste-frontend/SKILL.md` sections 9 (AI Tells), 11 (Redesign
> Protocol) and 14 (Final Pre-Flight Check), and read
> `<SKILLS_ROOT>/redesign-existing-projects/SKILL.md` in full.
>
> Your single question: **does this look like it was designed, or like it was generated?**
> You are not scoring usability. Judge A owns that. You hunt for the fingerprints.
>
> Deliver, in this order:
> 1. **Design Read**: one line naming what this page is trying to be, per section 0.B.
> 2. **AI Tells found**: a table with columns Tell | Where (file:line or screenshot region) |
>    Evidence. One row per confirmed tell. Quote the offending string or selector. Only list
>    tells you actually located. An empty table is a real and valuable result.
> 3. **Pre-Flight failures**: run the section 14 matrix against the target and list only the
>    boxes that fail, each with its evidence. Count the em-dashes on every page and report
>    the exact number and locations; section 9.G bans them outright.
> 4. **Design Audit by category** per redesign-existing-projects: typography, color and
>    surfaces, layout, interactivity and states, content, component patterns, iconography,
>    code quality, strategic omissions. Report only categories with real findings.
> 5. **Authenticity verdict**: one of AUTHORED / MIXED / GENERATED, with the two or three
>    findings that drove the call.
> 6. **Fix order** for what you found, following the skill's Fix Priority list.

### Judge C — Motion (Emil Kowalski)

> Read `<SKILLS_ROOT>/review-animations/SKILL.md` and
> `<SKILLS_ROOT>/review-animations/STANDARDS.md` and follow them. That skill sets
> `disable-model-invocation: true`, so read the files directly rather than invoking it.
> Also read the Review Checklist section of `<SKILLS_ROOT>/emil-design-eng/SKILL.md`.
>
> Review every animation, transition and gesture in the source: CSS transitions and
> keyframes, Framer Motion / Motion, GSAP, Tailwind animate utilities, scroll-driven effects.
> Search the source directory for `transition`, `animate`, `keyframes`, `@starting-style`,
> `ease-`, `cubic-bezier`, `motion.`, `useScroll`, `ScrollTrigger`, `prefers-reduced-motion`.
>
> Your bias is toward motion that feels right, not motion that runs. Default to flagging.
> Approval is earned. Measure against the Ten Non-Negotiable Standards.
>
> Deliver exactly the required output format:
> 1. **Findings table**, a single markdown table with columns Before | After | Why. One row
>    per issue, each citing `file:line`. Never a Before:/After: list.
> 2. **Verdict**, grouped by impact tier, highest first, omitting empty tiers.
> 3. An explicit **Block** or **Approve** decision per the skill's criteria.
>
> When a precise value is needed (a curve, a duration, a spring config), pull the exact one
> from STANDARDS.md rather than approximating. If the target has no animation at all, say so
> and note whether that is a correct choice for this surface or a missed opportunity.

### Judge D — Discoverability (seo-geo-aeo)

> Read `<SKILLS_ROOT>/seo-geo-aeo/SKILL.md` and follow its analysis and scoring rubric, with
> these overrides: the scope is already decided (the pages in your preamble), so skip its
> confirm-scope step. Skip its downloadable report generation entirely — no docx, no pdf.
> Your findings return as your final message; they are data for a synthesis step.
>
> You judge whether this site can be **found**: by search engines (SEO), by AI-powered search
> like Perplexity, ChatGPT Search and Gemini (GEO), and by answer engines and featured
> snippets (AEO). The other judges own how it looks and feels; you own whether anyone ever
> sees it.
>
> The deterministic layer already counted what raw markup proves — canonicals, robots meta,
> Open Graph, JSON-LD validity, titles, descriptions, h1/lang, sitemap gaps, robots.txt,
> llms.txt — in `<EV>/sweep.json`. Do not recount; interpret. Your value is judgment: whether
> the structured data is the *right* schema for the entity and not merely valid, whether
> content answers the questions its audience asks, whether the page survives a renderer that
> does not scroll, whether the E-E-A-T signals hold up, whether hreflang and locale routing
> match the site's actual language strategy.
>
> Also read the source when available: sitemap generation, metadata code, schema builders,
> and anything that decides what a crawler receives, citing `file:line`. Compare what the
> source *generates* with what the live site *serves* — robots.txt, headers, sitemap — and
> report any divergence explicitly: edge layers can inject rules the repo knows nothing
> about, and a crawler only ever sees the served version.
>
> Deliver, in this order:
> 1. **Scores**: SEO, GEO and AEO each 1-10 per the rubric, one line of justification each.
> 2. **Indexability verdict**: can every money page be found, crawled and rendered? Name any
>    page that cannot, and why.
> 3. **Structured-data judgment**: right schema for the entity, or merely valid markup?
> 4. **GEO/AEO readiness**: llms.txt, semantic structure, answerability of the copy, FAQ and
>    entity coverage. What would an AI engine cite this site for, and does the content earn it?
> 5. **Priority issues**, each tagged P0-P3, with location, why it matters, and a concrete fix.
> 6. **What is working**, 2-3 items, specific.

## Phase 4 — Synthesize the verdict

Do not concatenate the four reports. Weave them. Read all four, then write one report.

Lead with a header line declaring provenance:
`Method: 4-judge council (A rigor · B authenticity · C motion · D discoverability) · pass <n> · <t> templates of <u> URLs · commit <sha> · <date>`
plus any `DEGRADED:` markers, and the parity note if the deployed commit could not be verified.

On a second pass, the report changes shape: open with the four buckets from the **Second-pass
protocol** (regressions first, then persisting, then new, with resolved counted as progress),
and show every scorecard metric against its previous value. A flat list of findings identical
in shape to the first report throws away the only thing a re-run can tell you.

Then, in this order:

**1. Council Verdict.** One of three decisions, with a two-sentence justification.

First classify every P0 as **design-level** or **implementation-level**. The two demand
opposite responses, and collapsing them is how a verdict ends up telling someone to throw
away work that is sound.

- **Design-level P0**: the concept, composition, or direction is what fails. Fixing it changes
  what the page looks like when it works. A generic layout, a palette that fights the brand,
  a hierarchy with no primary, an interface interchangeable with any competitor.
- **Implementation-level P0**: the design is sound and the code fails to deliver it. Fixing it
  changes nothing about the intended appearance. Content that ships hidden, a broken
  responsive breakpoint, a control that does not render, an asset that never loads.

The test: **would a correct fix change what the page looks like once it works?** No means
implementation-level. A second check, when that one feels close: does the fix survive with the
existing design system fully intact? If yes, it is implementation-level.

| Decision | When |
|---|---|
| **SHIP** | No P0 of either kind. Judge A totals in the Good band or better. Judge B is AUTHORED. Judge C approves. No Judge D dimension below 6. |
| **FIX FIRST** | An implementation-level P0, or any P1, or Judge A in the Acceptable band, or Judge B is MIXED, or Judge C blocks, or any Judge D dimension at 5 or below. |
| **REDESIGN** | A design-level P0, or Judge A in the Poor band or below, or Judge B is GENERATED. |

A discoverability failure never triggers REDESIGN on its own: being invisible to crawlers is
almost always the code failing to deliver, not the design being wrong. It routes to FIX FIRST,
and a Judge D dimension at 1-3 (the rubric's "penalized or invisible" band) is a P0.

An implementation-level P0 is still a P0: it leads the priority findings and it blocks
shipping. It just does not condemn the design that the code is failing to deliver.

**If your judgment still disagrees with what this table returns, say so in the verdict rather
than quietly substituting your own call.** State what the table returns, what you would do
instead, and why. A verdict rule that produces the wrong label on a real target is a defect in
this skill, and the run that exposes it is the only chance to record it.

**2. Scorecard.** Report each judge's own metric. Do not invent a composite number; the four
scales are not commensurable and averaging them would launder a real failure into a mediocre
average.

| Panel | Metric | Result |
|---|---|---|
| Layer 1 · Sweep | Whole site, `n` URLs | `n` errors, `n` warnings · em-dash `n` · `opacity:0` `n` |
| A · Rigor | Nielsen heuristics | `?/40` (band) |
| A · Rigor | Audit health | `?/20` (band) |
| B · Authenticity | AI tells confirmed | `n` found, `n` pre-flight boxes failed → AUTHORED / MIXED / GENERATED |
| C · Motion | Animation review | `n` findings → Block / Approve |
| D · Discoverability | SEO / GEO / AEO | `?/10` · `?/10` · `?/10` |

**3. Where the judges agree.** A finding raised independently by two or more judges is the
strongest signal in the report. Lead the findings section with these and say who converged.

**4. Where they disagree.** Name the conflict and rule on it yourself. Judge B may flag a
convention that Judge A scored well, or Judge C may want motion deleted that Judge B wanted
added. State which lens wins here and why. Do not paper over it.

**Negative scope claims are verified, not trusted.** When a judge asserts where a defect does
*not* apply — "the other locale is fine", "the rest of the site uses this component", "only
this template is affected" — that assertion is a checkable claim, and it is the kind judges
get wrong most often, because ruling something out takes a search they may not have run.
Verify it yourself before it scopes a fix or closes a finding. A false positive wastes a
review cycle; a false negative-of-scope has justified real fixes that should never have been
made.

**5. Priority findings.** A single merged list across all four judges, ordered P0 then P1
then P2, deduplicated. Each entry:

- **[P?] What** — the problem in one line
- **Judge** — A, B, C, or the ones that converged
- **Where** — `file:line` or the screenshot and region
- **Why it matters** — impact on the user or on the business goal of the page
- **Fix** — concrete, not "consider exploring"
- **Handoff** — the exact skill and command that fixes it, from the table below

**6. What is working.** Three items maximum, specific.

**7. Evidence.** The run directory path and what is in it.

Be direct. Vague feedback wastes the user's time. Do not soften findings, and do not pad the
report with items that carry no consequence.

### Fix handoff table

| Finding type | Route to |
|---|---|
| UX, hierarchy, IA, copy, states, a11y, perf, responsive | `$impeccable` + the command Judge A named (`polish`, `clarify`, `layout`, `typeset`, `harden`, `adapt`, `optimize`, `colorize`) |
| AI tells, generic layout, weak type, flat surfaces, dead sections | `redesign-existing-projects`, applied in its Fix Priority order |
| Bland or timid overall direction | `impeccable bolder`, or `high-end-visual-design` for an Awwwards-tier pass |
| Overloaded or noisy direction | `impeccable quieter` or `impeccable distill` |
| Animation defects | `animate` (Emil's build skill), or `improve-animations` for a whole-codebase roadmap |
| No motion where motion belongs | `find-animation-opportunities` |
| Copy that reads as machine-written | `humanizer` |
| SEO, structured data, GEO/AEO content gaps | `seo-geo-aeo` for the full audit-and-fix pass; the sweep (`scripts/sweep.mjs` in CI) to keep the deterministic layer from regressing |

## Phase 5 — Recommend one action, then offer

**Close with a recommendation, never with a menu.** By this point you hold the whole picture:
four judges, a whole-site sweep, severities, and effort estimates. Ending on "what would you
like to do?" hands the decision back at the exact moment you are best placed to make it, and
it forces the user to re-derive a ranking you already have.

Structure the close as:

1. **One recommended next action**, named and justified in a single clause. Pick the smallest
   change that removes the most damage, which is usually the P0 and often an interim guard
   that lands in minutes ahead of the structural fix. Give its rough size so the user can say
   yes without asking what it costs.
2. **One line for what follows it**, so the sequence is visible without being a menu.
3. **A separate short list of decisions that are genuinely the user's**, if any exist. Taste,
   brand voice, and business tradeoffs are theirs, not yours. Present the tradeoff and say
   plainly that it is their call. Never fold these into the recommendation, and never pad the
   list with things you should have decided yourself.

Then ask for the go-ahead on the recommended action alone.

Do not offer publishing, exporting, or sharing the report as a peer alternative to doing the
work. They are different kinds of thing, and pairing them in one question makes both harder to
answer. Mention a shareable version in a trailing clause if it is genuinely useful, or not at
all.

Rules if the user says yes:

- Fix P0 first, then P1. Do not touch P2 or P3 unless asked.
- Apply through the routed skill, not by improvising edits.
- Do not deploy, publish, push, or commit. That is a separate decision the user makes.
- Report what changed and what was deliberately left alone.
- After the fixes land, re-run the Layer 1 sweep and save the result beside the original
  (`sweep-after.json`). It is the cheapest possible proof that the fixes did not regress the
  deterministic layer, and the before/after pair belongs in the evidence directory.

If the user says no, stop. The report is the deliverable.

## Second-pass protocol

A re-run after a round of fixes is not a repeat of the first evaluation. It is a measurement,
and it is where this skill is worth the most and fails the worst. The rules below exist
because each one was learned from a real second pass that went wrong without it.

### Never tell the judges what was fixed

Convene them exactly as before, blind to the changes. This is the whole reason a second pass
means anything.

If a judge stops reporting a finding on their own, that is confirmation. If you prime them
with "the contrast issue is fixed", you are not measuring, you are asking them to agree with
you, and they will. And when something you believe fixed is still there, blind judges are the
only mechanism that will tell you.

The temptation to prime is strongest for findings you personally fixed and are proud of.
Resist it there most of all.

### Classify every finding against the previous run

The synthesis must place each finding in one of four buckets, not present a flat list:

| Bucket | Meaning | Weight |
|---|---|---|
| **Resolved** | In the prior run, absent now, judges blind | The report's evidence of progress. Count them. |
| **Persisting** | In both runs | Either the fix missed, or it was never applied. Say which. |
| **New** | Absent before, present now, unrelated to any fix | Ordinary finding, ordinary severity. |
| **Regression** | Present now, caused by a fix made after the last run | **Highest severity class. Always leads the report.** |

A regression outranks everything, including a P0 carried over, because it means the loop is
running backwards: the process meant to improve the site damaged it. Name the fix that caused
it and say plainly that it was self-inflicted. Do not soften this when the fix was yours.

### Recurrence across capture sessions is proof

A judge may reasonably mark a one-off defect as possibly transient. If the same defect appears
again in an independent capture session, that judgement is settled: it is real, and the second
run is the only place that can be established. Carry forward every "possibly transient" note
from the prior run and rule on it explicitly.

Recurrence settles **existence, not cause**. A defect proven real by recurrence still needs
its diagnosis established independently — the judge's hypothesis about why it happens carries
no more weight for being attached to a defect that turned out to be real. Both can be wrong
while the finding stands.

### Name failure classes and cite the precedent

An incident establishes a **class**, not just a finding. Once "content invisible to
non-scrolling renderers" has cost a run, a later defect in that class — a scroll-reveal at
`opacity:0` yesterday, a `loading="lazy"` hero at 5,000px today — is reported *as* that class,
citing the precedent, whatever its surface form. The class is what keeps the same wound from
reopening under a different name, and a finding that joins an established class inherits the
attention its precedent earned. Record classes in `run.json` so later passes can match against
them.

### Rule on cross-run contradictions

Judges from different runs will contradict each other, and the earlier one is not privileged.
Verify with your own tools and rule, exactly as for a within-run disagreement.

This matters more than it sounds: a false claim from an earlier run can justify a fix that
should never have been made. When you find one, check whether anything was already built on
it, and say so.

### Report the trajectory

Show each metric against its previous value: heuristic totals, audit health, sweep counts,
Judge B's verdict band, Judge C's block or approve. A number that moved is the clearest signal
in the report. A number that did not move after a fix aimed at it is the second clearest.

### Write the run record

At the end of Phase 4, write `$EV/run.json` with the date, the verified commit, the scorecard,
and every finding with its id, severity, location and bucket. The next run classifies against
this file rather than against anybody's memory of what the last report said.

## Guardrails

- Never let a judge see another judge's output before Phase 4.
- Never report a finding you cannot point at. No inferred defects.
- An empty AI Tells table or an Approve from Judge C is a legitimate result, not a failure to
  look hard enough. Do not manufacture findings to justify the run.
- Never modify files during Phases 0 through 4.
- Never sample a check that Layer 1 can run over every URL. If the sweep cannot answer a
  question, that is what the judges are for; if it can, quoting a three-page number when a
  whole-site number was one command away understates the problem to the user.
- Never convene judges against a tree that does not match what is deployed, and never let a
  reader assume parity was verified when it was not.
- Never tell a judge what changed since the last run, however convenient it would be.
- Never report a regression caused by a previous fix as an ordinary new finding, and never
  soften it because the fix was yours.
- On a client site, treat the live URL as read-only: no form submissions, no clicking
  irreversible controls, no account actions.

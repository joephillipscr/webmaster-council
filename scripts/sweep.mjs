#!/usr/bin/env node
/**
 * webmaster-council Layer 1: deterministic whole-site sweep.
 *
 * Fetches every URL as raw HTML (no JS execution) and reports only what raw
 * markup can prove. Everything requiring computed styles, layout, or judgment
 * is out of scope by design and belongs to the judges in Layer 2.
 *
 * Usage:
 *   node sweep.mjs --site https://example.com [--json out.json] [--limit N]
 *   node sweep.mjs --urls urls.txt [--json out.json]
 *
 * URL discovery: --site fetches /sitemap.xml (following sitemap indexes one
 * level). --urls reads one URL per line. Exit code 2 when findings exist,
 * 0 when clean, 1 on a hard error, matching impeccable's detector convention.
 */

const args = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 || i === args.length - 1 ? fallback : args[i + 1];
};
const has = (name) => args.includes(`--${name}`);

const SITE = opt('site');
const URLS_FILE = opt('urls');
const JSON_OUT = opt('json');
const LIMIT = parseInt(opt('limit', '0'), 10) || 0;
const CONCURRENCY = parseInt(opt('concurrency', '6'), 10);

if (!SITE && !URLS_FILE) {
  console.error('Need --site <origin> or --urls <file>. See header for usage.');
  process.exit(1);
}

const EM_DASH = '—';
const EN_DASH = '–';

// ---------------------------------------------------------------- discovery

/** Sitemap locations vary by framework: Next.js emits /sitemap.xml, Astro emits
 *  /sitemap-index.xml, others advertise theirs only in robots.txt. Try all of it before
 *  giving up, then fall back to crawling. A sweep that refuses to run on a site without
 *  /sitemap.xml is useless to anyone whose stack differs from the one it was built against. */
const SITEMAP_CANDIDATES = [
  '/sitemap.xml', '/sitemap-index.xml', '/sitemap_index.xml',
  '/sitemap/sitemap.xml', '/wp-sitemap.xml',
];

async function sitemapsFromRobots(origin) {
  try {
    const res = await fetch(new URL('/robots.txt', origin).href, { redirect: 'follow' });
    if (!res.ok) return [];
    const txt = await res.text();
    return [...txt.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]);
  } catch { return []; }
}

async function fromSitemap(origin) {
  const roots = [
    ...(await sitemapsFromRobots(origin)),
    ...SITEMAP_CANDIDATES.map((p) => new URL(p, origin).href),
  ];
  const seen = new Set();
  const out = [];
  const queue = [...new Set(roots)];

  while (queue.length) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);
    let xml;
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) continue;
      xml = await res.text();
    } catch {
      continue;
    }
    if (!/<loc>/i.test(xml)) continue;
    const locs = [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((m) => m[1]);
    const isIndex = /<sitemapindex/i.test(xml);
    for (const loc of locs) (isIndex ? queue : out).push(loc);
  }
  return [...new Set(out)];
}

const SKIP_EXT = /\.(png|jpe?g|gif|svg|webp|avif|ico|css|js|mjs|json|xml|txt|pdf|zip|mp4|webm|woff2?|ttf)$/i;

/** Breadth-first crawl from the origin, same-origin only. The floor that makes this script
 *  work on any site, however it is built. Bounded so it cannot run away on a large site. */
async function fromCrawl(origin, max) {
  const start = new URL(origin).href;
  const seen = new Set([start.replace(/\/$/, '')]);
  const out = [];
  let frontier = [start];

  while (frontier.length && out.length < max) {
    const batch = frontier.slice(0, CONCURRENCY);
    frontier = frontier.slice(CONCURRENCY);
    const found = await Promise.all(batch.map(async (url) => {
      out.push(url);
      try {
        const res = await fetch(url, { redirect: 'follow' });
        if (!res.ok || !/text\/html/i.test(res.headers.get('content-type') || '')) return [];
        const html = await res.text();
        return [...html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["']/gi)].map((m) => m[1]);
      } catch { return []; }
    }));
    for (const href of found.flat()) {
      let abs;
      try { abs = new URL(href, origin).href; } catch { continue; }
      if (new URL(abs).origin !== new URL(origin).origin) continue;
      if (SKIP_EXT.test(new URL(abs).pathname)) continue;
      const key = abs.replace(/\/$/, '');
      if (seen.has(key)) continue;
      seen.add(key);
      frontier.push(abs);
    }
  }
  return out.slice(0, max);
}

let DISCOVERY = 'urls-file';

async function discover() {
  if (URLS_FILE) {
    const { readFileSync } = await import('node:fs');
    return readFileSync(URLS_FILE, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
  }
  const fromMap = await fromSitemap(SITE);
  if (fromMap.length) {
    DISCOVERY = 'sitemap';
    return fromMap;
  }
  const maxCrawl = parseInt(opt('max-crawl', '300'), 10);
  process.stderr.write(`No sitemap found; crawling from ${SITE} (max ${maxCrawl} pages)...\n`);
  DISCOVERY = 'crawl';
  const crawled = await fromCrawl(SITE, maxCrawl);
  if (!crawled.length) {
    console.error(`Could not reach ${SITE}, and no sitemap was found. Pass --urls instead.`);
    process.exit(1);
  }
  if (crawled.length >= maxCrawl) {
    process.stderr.write(`Crawl hit the ${maxCrawl}-page cap; coverage is partial. Raise --max-crawl for a complete sweep.\n`);
  }
  return crawled;
}

// ------------------------------------------------------------ html regions

/** Split raw HTML into the regions a finding can live in. They read very
 *  differently: a dash in visible copy is a user-facing defect, one in an RSC
 *  payload is a duplicate of something else, one in JSON-LD is machine-facing. */
function regions(html) {
  const jsonLdBlocks = [...html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  )].map((m) => m[1]);
  const jsonLd = jsonLdBlocks.join('\n');

  const allScripts = [...html.matchAll(/<script[\s\S]*?<\/script>/gi)].map((m) => m[0]).join('\n');
  const otherScripts = allScripts.replace(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi, ''
  );

  const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  const head = headMatch ? headMatch[1] : '';
  const headMeta = [
    ...[...head.matchAll(/<title[^>]*>([\s\S]*?)<\/title>/gi)].map((m) => m[1]),
    ...[...head.matchAll(/<meta[^>]+content=["']([^"']*)["']/gi)].map((m) => m[1]),
  ].join('\n');

  // Renderable markup: strip script and style wholesale.
  const renderable = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<head[^>]*>[\s\S]*?<\/head>/i, '');

  const attrs = [...renderable.matchAll(/\b(alt|title|aria-label|placeholder)=["']([^"']*)["']/gi)]
    .map((m) => `${m[1]}="${m[2]}"`).join('\n');

  const visibleText = renderable
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return { jsonLd, jsonLdBlocks, otherScripts, headMeta, attrs, visibleText, renderable, head };
}

function countChar(haystack, ch) {
  let n = 0;
  for (const c of haystack) if (c === ch) n++;
  return n;
}

function contexts(text, ch, max = 4) {
  const out = [];
  let from = 0;
  while (out.length < max) {
    const i = text.indexOf(ch, from);
    if (i === -1) break;
    out.push(text.slice(Math.max(0, i - 45), i + 45).replace(/\s+/g, ' ').trim());
    from = i + 1;
  }
  return out;
}

// ---------------------------------------------------------------- analysis

function analyze(url, status, html) {
  const r = regions(html);
  const f = { url, status, findings: [], stats: {} };
  const add = (rule, severity, detail, evidence = []) =>
    f.findings.push({ rule, severity, detail, evidence });

  // --- dashes, split by region (Judge B's lens, made countable)
  const dash = {
    visible: countChar(r.visibleText, EM_DASH),
    attrs: countChar(r.attrs, EM_DASH),
    headMeta: countChar(r.headMeta, EM_DASH),
    jsonLd: countChar(r.jsonLd, EM_DASH),
    scripts: countChar(r.otherScripts, EM_DASH),
  };
  const userVisible = dash.visible + dash.attrs + dash.headMeta;
  f.stats.emDash = { ...dash, userVisible };
  f.stats.enDash = countChar(r.visibleText, EN_DASH);

  if (userVisible > 0) {
    add('em-dash', 'error',
      `${userVisible} user-visible em-dash (visible text ${dash.visible}, attributes ${dash.attrs}, head metadata ${dash.headMeta})`,
      [...contexts(r.visibleText, EM_DASH), ...contexts(r.attrs, EM_DASH, 2), ...contexts(r.headMeta, EM_DASH, 2)]);
  }
  if (f.stats.enDash > 0) {
    add('en-dash', 'warning', `${f.stats.enDash} en-dash in visible text`,
      contexts(r.visibleText, EN_DASH));
  }

  // --- content shipped hidden (the P0 pattern from the first real run)
  const hidden = [...r.renderable.matchAll(/style=["'][^"']*opacity\s*:\s*0(?![.\d])[^"']*["']/gi)];
  f.stats.opacityZero = hidden.length;
  if (hidden.length) {
    const h1Hidden = /<h1[^>]+style=["'][^"']*opacity\s*:\s*0(?![.\d])/i.test(r.renderable);
    add('ssr-hidden-content', h1Hidden ? 'error' : 'warning',
      `${hidden.length} element(s) served with inline opacity:0${h1Hidden ? ', including the <h1>' : ''}`,
      hidden.slice(0, 3).map((m) => m[0]));
  }

  // --- images
  const imgs = [...r.renderable.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  f.stats.images = imgs.length;
  const noAlt = imgs.filter((t) => !/\balt=/i.test(t));
  const emptyAlt = imgs.filter((t) => /\balt=["']\s*["']/i.test(t));
  if (noAlt.length) add('img-missing-alt', 'error', `${noAlt.length} <img> with no alt attribute`, noAlt.slice(0, 3));
  if (emptyAlt.length) add('img-empty-alt', 'warning', `${emptyAlt.length} <img> with empty alt (decorative only)`, emptyAlt.slice(0, 3));
  f.stats.altTexts = [...r.renderable.matchAll(/<img\b[^>]*\balt=["']([^"']+)["']/gi)].map((m) => m[1]);

  // --- document structure
  const h1s = [...r.renderable.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)];
  f.stats.h1Count = h1s.length;
  if (h1s.length === 0) add('h1-missing', 'error', 'No <h1> on the page');
  if (h1s.length > 1) add('h1-multiple', 'warning', `${h1s.length} <h1> elements`);

  const lang = html.match(/<html[^>]+lang=["']([^"']+)["']/i);
  f.stats.lang = lang ? lang[1] : null;
  if (!lang) add('lang-missing', 'error', '<html> has no lang attribute');

  const title = r.head.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  f.stats.title = title ? title[1].trim() : null;
  if (!f.stats.title) add('title-missing', 'error', 'No <title>');

  const desc = r.head.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i);
  f.stats.description = desc ? desc[1].trim() : null;
  if (!f.stats.description) add('description-missing', 'warning', 'No meta description');

  f.stats.hasNoscript = /<noscript/i.test(html);

  // --- discoverability (the deterministic slice of SEO/GEO/AEO; judgment is Judge D's)
  const canonicalTag = [...r.head.matchAll(/<link\b[^>]*>/gi)]
    .map((m) => m[0]).find((t) => /rel=["']canonical["']/i.test(t));
  const canonicalHref = canonicalTag ? (canonicalTag.match(/href=["']([^"']+)["']/i) || [])[1] : null;
  f.stats.canonical = canonicalHref || null;
  if (!canonicalHref) add('canonical-missing', 'warning', 'No rel=canonical in <head>');

  const robotsMeta = r.head.match(/<meta[^>]+name=["']robots["'][^>]+content=["']([^"']*)["']/i)
    || r.head.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']robots["']/i);
  f.stats.robotsMeta = robotsMeta ? robotsMeta[1] : null;
  if (robotsMeta && /noindex/i.test(robotsMeta[1])) {
    add('meta-noindex', 'error',
      `Page is discoverable (sitemap or internal link) yet carries robots "${robotsMeta[1]}"`);
  }

  const og = {};
  for (const key of ['title', 'description', 'image']) {
    og[key] = new RegExp(`property=["']og:${key}["']`, 'i').test(r.head);
  }
  const ogMissing = Object.keys(og).filter((k) => !og[k]);
  if (ogMissing.length) {
    add('og-incomplete', 'warning', `Open Graph missing: og:${ogMissing.join(', og:')}`);
  }

  f.stats.jsonLdTypes = [];
  let jsonLdInvalid = 0;
  for (const block of r.jsonLdBlocks) {
    try {
      const parsed = JSON.parse(block);
      for (const node of [].concat(parsed['@graph'] || parsed)) {
        if (node && node['@type']) f.stats.jsonLdTypes.push(String(node['@type']));
      }
    } catch { jsonLdInvalid++; }
  }
  if (jsonLdInvalid) {
    add('jsonld-invalid', 'error',
      `${jsonLdInvalid} JSON-LD block(s) fail to parse; search engines and AI crawlers will drop them`);
  }
  if (!r.jsonLdBlocks.length) add('jsonld-absent', 'warning', 'No structured data on the page');

  // --- internal links, for the cross-page pass
  const origin = new URL(url).origin;
  f.stats.links = [...r.renderable.matchAll(/<a\b[^>]*href=["']([^"'#]+)["']/gi)]
    .map((m) => m[1])
    .filter((h) => h.startsWith('/') || h.startsWith(origin))
    .map((h) => (h.startsWith('/') ? origin + h : h));

  return f;
}

// ------------------------------------------------------------------ runner

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }));
  return out;
}

async function fetchPage(url) {
  try {
    const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'webmaster-council-sweep' } });
    const html = await res.text();
    return analyze(url, res.status, html);
  } catch (err) {
    return { url, status: 0, findings: [{ rule: 'fetch-failed', severity: 'error', detail: String(err.message || err), evidence: [] }], stats: {} };
  }
}

const urls = (await discover()).slice(0, LIMIT || undefined);
process.stderr.write(`Sweeping ${urls.length} URLs...\n`);
const pages = await mapPool(urls, CONCURRENCY, fetchPage);

const siteFindings = [];

// --- pages reachable by internal link but absent from the sitemap.
// The sweep must never call itself whole-site while trusting a sitemap that may be
// incomplete. Anything linked from a swept page is part of the site, so fetch and analyze
// it too, and report the sitemap gap as a finding in its own right: a real route missing
// from the sitemap is an SEO defect, not a crawler limitation.
const linkTargets = [...new Set(pages.flatMap((p) => p.stats.links || []))];
const known = new Set(pages.map((p) => p.url.replace(/\/$/, '')));
const orphans = linkTargets.filter((l) => !known.has(l.replace(/\/$/, '')));

process.stderr.write(`Found ${orphans.length} linked URLs absent from the sitemap; fetching them too...\n`);
const orphanPages = await mapPool(orphans, CONCURRENCY, fetchPage);

const reachable = orphanPages.filter((p) => p.status >= 200 && p.status < 400);
const broken = orphanPages.filter((p) => p.status >= 400 || p.status === 0);

if (broken.length) {
  siteFindings.push({
    rule: 'broken-internal-link', severity: 'error',
    detail: `${broken.length} internal link target(s) not reachable`,
    evidence: broken.slice(0, 10).map((b) => `${b.status} ${b.url}`),
  });
}
// A query-string URL is a facet of a page, not a page. Sitemaps are right to omit them, so
// lumping the two together would turn a real defect into a number nobody trusts. They still
// get swept and still count toward the totals, because they are things a visitor can land on.
const routeOrphans = reachable.filter((p) => !new URL(p.url).search);
const facetOrphans = reachable.filter((p) => new URL(p.url).search);

// Only meaningful when a sitemap defined the baseline. Under crawl discovery every page is
// reached by link, so "absent from the sitemap" would describe the whole site and mean nothing.
if (routeOrphans.length && DISCOVERY === 'sitemap') {
  siteFindings.push({
    rule: 'missing-from-sitemap', severity: 'error',
    detail: `${routeOrphans.length} live route(s) linked from the site but absent from the sitemap`,
    evidence: routeOrphans.slice(0, 15).map((p) => p.url),
  });
}
if (facetOrphans.length) {
  siteFindings.push({
    rule: 'query-facet-indexable', severity: 'warning',
    detail: `${facetOrphans.length} query-string facet URL(s) linked and crawlable; correctly absent from the sitemap, but check they carry a canonical or noindex so they do not compete with the page they filter`,
    evidence: facetOrphans.slice(0, 8).map((p) => p.url),
  });
}

// Orphans are part of the swept set from here on, so every total below counts them.
pages.push(...reachable);

// --- cross-page checks. These run after the orphan merge on purpose: a duplicate title
// between a sitemap page and one the sitemap omitted is exactly the pair worth catching.
const byTitle = new Map();
const byDesc = new Map();
for (const p of pages) {
  if (p.stats.title) byTitle.set(p.stats.title, [...(byTitle.get(p.stats.title) || []), p.url]);
  if (p.stats.description) byDesc.set(p.stats.description, [...(byDesc.get(p.stats.description) || []), p.url]);
}
for (const [t, us] of byTitle) if (us.length > 1) siteFindings.push({ rule: 'title-duplicate', severity: 'warning', detail: `${us.length} pages share the title "${t}"`, evidence: us.slice(0, 5) });
for (const [d, us] of byDesc) if (us.length > 1) siteFindings.push({ rule: 'description-duplicate', severity: 'warning', detail: `${us.length} pages share a meta description`, evidence: us.slice(0, 5) });

// --- discoverability, site level
const canonicalHosts = new Map();
for (const p of pages) {
  if (!p.stats.canonical) continue;
  try {
    const h = new URL(p.stats.canonical, p.url).host;
    canonicalHosts.set(h, (canonicalHosts.get(h) || 0) + 1);
  } catch {
    siteFindings.push({ rule: 'canonical-malformed', severity: 'error', detail: `Unparseable canonical on ${p.url}`, evidence: [p.stats.canonical] });
  }
}
if (canonicalHosts.size > 1) {
  siteFindings.push({
    rule: 'canonical-host-mixed', severity: 'error',
    detail: 'Canonicals point at more than one host; pick one and hold it site-wide',
    evidence: [...canonicalHosts].map(([h, n]) => `${h} (${n} pages)`),
  });
}

const firstOk = pages.find((p) => p.status >= 200 && p.status < 400);
if (firstOk) {
  const origin = new URL(firstOk.url).origin;
  const probe = async (path) => {
    try {
      const res = await fetch(origin + path, { redirect: 'follow' });
      return res.ok ? await res.text() : null;
    } catch { return null; }
  };
  const robots = await probe('/robots.txt');
  if (robots === null) {
    siteFindings.push({ rule: 'robots-missing', severity: 'warning', detail: 'No robots.txt', evidence: [] });
  } else if (!/^\s*sitemap:/im.test(robots)) {
    siteFindings.push({ rule: 'robots-no-sitemap', severity: 'warning', detail: 'robots.txt does not declare a Sitemap: line', evidence: [] });
  }
  // llms.txt is the emerging AI-crawler manifest; absence is information, not a defect.
  const llms = await probe('/llms.txt');
  siteFindings.push({
    rule: 'llms-txt', severity: 'info',
    detail: llms !== null ? 'llms.txt present' : 'No llms.txt (AI-crawler manifest); Judge D weighs whether this site should have one',
    evidence: [],
  });
}

// ------------------------------------------------------------------ report

const totals = {
  urls: pages.length,
  emDashUserVisible: pages.reduce((n, p) => n + (p.stats.emDash?.userVisible || 0), 0),
  opacityZero: pages.reduce((n, p) => n + (p.stats.opacityZero || 0), 0),
  errors: pages.reduce((n, p) => n + p.findings.filter((f) => f.severity === 'error').length, 0) + siteFindings.filter((f) => f.severity === 'error').length,
  warnings: pages.reduce((n, p) => n + p.findings.filter((f) => f.severity === 'warning').length, 0) + siteFindings.filter((f) => f.severity === 'warning').length,
};

const report = { site: SITE || URLS_FILE, totals, siteFindings, pages };
if (JSON_OUT) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));
}

const byRule = new Map();
for (const p of pages) for (const f of p.findings) byRule.set(f.rule, (byRule.get(f.rule) || 0) + 1);

console.log(`\n=== webmaster-council sweep: ${report.site}`);
console.log(`URL discovery: ${DISCOVERY}${DISCOVERY === 'crawl' ? ' (no sitemap found; coverage may be partial)' : ''}`);
console.log(`${totals.urls} URLs · ${totals.errors} errors · ${totals.warnings} warnings`);
console.log(`em-dash (user-visible): ${totals.emDashUserVisible} · opacity:0 elements: ${totals.opacityZero}\n`);
console.log('By rule:');
for (const [rule, n] of [...byRule].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${rule}`);
for (const f of siteFindings) console.log(`  site  ${f.rule}: ${f.detail}`);

console.log('\nWorst pages:');
for (const p of [...pages].sort((a, b) => b.findings.length - a.findings.length).slice(0, 12)) {
  if (!p.findings.length) continue;
  console.log(`  ${p.findings.length}  ${p.url}`);
  for (const f of p.findings) console.log(`       [${f.severity}] ${f.rule}: ${f.detail}`);
}

console.log('\nNOT checked here (needs a browser, belongs to Layer 2): color contrast,');
console.log('computed styles, layout, responsive behaviour, focus order, motion.');

if (JSON_OUT) console.log(`\nJSON: ${JSON_OUT}`);
process.exit(totals.errors + totals.warnings > 0 ? 2 : 0);

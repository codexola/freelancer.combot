/**
 * Freelancer.com プロジェクト一覧ページの監視
 * 新規プロジェクトを検出しバックグラウンドに通知
 */

(function () {
  'use strict';

  if (window.__fabProjectsMonitorLoaded) return;
  window.__fabProjectsMonitorLoaded = true;

  const { parseProjectHref, normalizeDetailsUrl, compareProjectsByNewest } =
    window.FabProjectUrl || {};

  if (!parseProjectHref) {
    console.error('[fab] FabProjectUrl helpers missing — monitor cannot run');
    return;
  }

  const RECENT_PROJECTS_API =
  'https://www.freelancer.com/ajax-api/navigation/recent-projects-and-contests.php?limit=50&compact=true&new_errors=true&new_pools=true';

let isMonitoring = false;
let observer = null;
let scanIntervalId = null;
let seenProjectIds = new Set();
let hasSeededSeen = false;

function parseBidCount(text) {
  if (!text) return null;
  const matches = [...text.matchAll(/(\d+)\s*bids?\b/gi)];
  if (!matches.length) return null;
  const counts = matches.map((m) => parseInt(m[1], 10)).filter((n) => n < 5000);
  return counts.length ? counts[counts.length - 1] : null;
}

function parseBudgetInfo(text) {
  if (!text) return { budget: '', bidType: 'fixed', budgetMinUsd: 0 };

  const hourlyMatch = text.match(/\$\s*([\d,]+(?:\.\d+)?)\s*(?:\/\s*hr|\/hr|per hour)/i);
  if (hourlyMatch) {
    const budget = `$${hourlyMatch[1]} / hr`;
    return { budget, bidType: 'hourly', budgetMinUsd: parseBudgetMinUsd(budget) };
  }

  const rangeMatch = text.match(/\$\s*([\d,]+(?:\.\d+)?)\s*-\s*\$\s*([\d,]+(?:\.\d+)?)/);
  if (rangeMatch) {
    const budget = `$${rangeMatch[1]} - $${rangeMatch[2]}`;
    return { budget, bidType: 'fixed', budgetMinUsd: parseBudgetMinUsd(budget) };
  }

  const avgMatch = text.match(/\$\s*([\d,]+(?:\.\d+)?)\s*(?:Average bid|Avg Bid)/i);
  if (avgMatch) {
    const budget = `$${avgMatch[1]}`;
    return { budget, bidType: 'fixed', budgetMinUsd: parseBudgetMinUsd(budget) };
  }

  const genericMatch = text.match(/\$\s*([\d,]+(?:\.\d+)?)/);
  if (genericMatch) {
    const budget = `$${genericMatch[1]}`;
    return { budget, bidType: 'fixed', budgetMinUsd: parseBudgetMinUsd(budget) };
  }

  return { budget: '', bidType: 'fixed', budgetMinUsd: 0 };
}

function parseBudgetMinUsd(budgetText) {
  if (!budgetText) return 0;
  const isHourly = /per hour|hourly|\/hr|\/hour/i.test(budgetText);
  const numbers = budgetText.match(/[\d,]+\.?\d*/g)?.map((n) => parseFloat(n.replace(/,/g, ''))) || [];
  if (!numbers.length) return 0;
  const minVal = Math.min(...numbers);
  let currency = 'USD';
  if (budgetText.includes('€') || /EUR/i.test(budgetText)) currency = 'EUR';
  else if (budgetText.includes('£') || /GBP/i.test(budgetText)) currency = 'GBP';
  else if (/AUD/i.test(budgetText)) currency = 'AUD';
  else if (/CAD/i.test(budgetText)) currency = 'CAD';
  else if (/INR|₹/i.test(budgetText)) currency = 'INR';
  const rates = { USD: 1, EUR: 1.08, GBP: 1.27, AUD: 0.65, CAD: 0.74, INR: 0.012 };
  const usd = minVal * (rates[currency] || 1);
  return isHourly ? usd * 40 : usd;
}

function extractClientCountry(card) {
  const locationEl = card.querySelector(
    '[class*="location"], [class*="Location"], [class*="country"], [class*="Country"], fl-flag'
  );
  const locationText = (locationEl?.textContent || locationEl?.getAttribute('title') || '').trim();
  if (locationText && !/days?\s*left|verified|bid now/i.test(locationText)) return locationText;

  if (/\bLocal\b/.test(card.textContent)) return 'Local';

  return '';
}

function parseTimeAgo(text) {
  if (!text) return null;
  const lower = text.toLowerCase().trim();
  if (/days?\s*left|remaining|left to bid/i.test(lower)) return null;
  if (lower.includes('just now')) return 0;
  if (lower.includes('seconds ago') || lower.includes('second ago')) {
    const secMatch = lower.match(/(\d+)\s*seconds?\s*ago/);
    return secMatch ? parseInt(secMatch[1], 10) : 0;
  }
  if (lower.includes('a minute ago') || lower === '1 minute ago') return 60;
  const minMatch = lower.match(/(\d+)\s*minutes?\s*ago/);
  if (minMatch) return parseInt(minMatch[1], 10) * 60;
  const hourMatch = lower.match(/(\d+)\s*hours?\s*ago/);
  if (hourMatch) return parseInt(hourMatch[1], 10) * 3600;
  const dayMatch = lower.match(/(\d+)\s*days?\s*ago/);
  if (dayMatch) return parseInt(dayMatch[1], 10) * 86400;
  return null;
}

function findCardParent(el) {
  let node = el;
  for (let i = 0; i < 10 && node; i++) {
    if (node.querySelector?.('a[href*="/projects/"]')) return node;
    node = node.parentElement;
  }
  return el.parentElement;
}

function getProjectCards() {
  const bidNowEls = Array.from(document.querySelectorAll('a, button, fl-button, [role="button"]'))
    .filter((el) => /bid\s*now/i.test((el.textContent || '').trim()));

  const cards = [];
  const seen = new Set();
  for (const el of bidNowEls) {
    const card =
      el.closest(
        'article, li, fl-project-contest-card, fl-project-card, [class*="JobSearch"], [class*="ProjectCard"], [class*="project-card"]'
      ) || findCardParent(el);
    if (card && !seen.has(card)) {
      seen.add(card);
      cards.push(card);
    }
  }

  if (cards.length) return cards;

  const selectors = [
    'fl-project-contest-card',
    'fl-project-card',
    '[class*="ProjectCard"]',
    '[class*="project-card"]',
    '.JobSearchCard-item'
  ];
  for (const sel of selectors) {
    const found = document.querySelectorAll(sel);
    if (found.length) return Array.from(found);
  }

  return [];
}

function findBestProjectLink(card) {
  const links = Array.from(card.querySelectorAll('a[href*="/projects/"], a[href*="/contest/"]'));
  const ranked = links
    .map((el) => {
      const href = el.getAttribute('href') || '';
      const parsed = parseProjectHref(href);
      return { el, href, parsed };
    })
    .filter((item) => item.parsed);

  ranked.sort((a, b) => {
    const aDepth = a.parsed.projectId.split('/').length;
    const bDepth = b.parsed.projectId.split('/').length;
    if (bDepth !== aDepth) return bDepth - aDepth;
    if (/bid/i.test(a.el.textContent || '')) return -1;
    if (/bid/i.test(b.el.textContent || '')) return 1;
    return 0;
  });

  return ranked[0] || null;
}

function extractProjectFromCard(card) {
  const link = findBestProjectLink(card);
  if (!link?.parsed) return null;

  const { projectId, url } = link.parsed;
  const titleEl =
    card.querySelector('h2, h3, h4, [class*="title"], [class*="Title"]') || link.el;
  const title = (titleEl?.textContent || link.el.textContent || '').trim().split('\n')[0].trim();
  if (!title || title.length < 5) return null;

  const cardText = card.innerText || card.textContent || '';
  const bidCount = parseBidCount(cardText);
  const { budget, bidType, budgetMinUsd } = parseBudgetInfo(cardText);

  const timeEl = Array.from(card.querySelectorAll('fl-text, span, small, time, div')).find((el) =>
    /(?:seconds?|minutes?|hours?|days?)\s*ago|just now/i.test(el.textContent)
  );
  const secondsAgo = parseTimeAgo(timeEl?.textContent || '');
  const isListedOld =
    /\d+\s*days?\s*left/i.test(cardText) &&
    !/(?:seconds?|minutes?|hours?)\s*ago|just now/i.test(cardText);

  const descEl = card.querySelector('[class*="description"], [class*="Description"], p');
  const description = (descEl?.textContent || '').trim();

  const skillEls = card.querySelectorAll('[class*="skill"], [class*="Skill"], fl-tag, .Tag');
  const skills = Array.from(skillEls).map((el) => el.textContent.trim()).filter(Boolean);

  const isNda = /\bnda\b|ip agreement|sealed/i.test(cardText);
  const isUrgent = /urgent/i.test(cardText);
  const clientCountry = extractClientCountry(card);

  return {
    projectId,
    url,
    title,
    bidCount,
    secondsAgo,
    isListedOld,
    budget,
    budgetMinUsd,
    description,
    skills,
    isNda,
    isUrgent,
    clientCountry,
    bidType,
    detectedAt: Date.now(),
    source: 'dom'
  };
}

function scanProjectsFromLinks() {
  const seen = new Set();
  const projects = [];

  for (const link of document.querySelectorAll('a[href*="/projects/"], a[href*="/contest/"]')) {
    const href = link.getAttribute('href') || '';
    const parsed = parseProjectHref(href);
    if (!parsed || seen.has(parsed.projectId)) continue;

    const rawTitle = (link.textContent || '').trim().split('\n')[0].trim();
    if (!rawTitle || rawTitle.length < 5 || /^bid\s*now$/i.test(rawTitle)) continue;

    seen.add(parsed.projectId);
    projects.push({
      projectId: parsed.projectId,
      url: parsed.url,
      title: rawTitle,
      bidCount: null,
      secondsAgo: null,
      isListedOld: false,
      budget: '',
      budgetMinUsd: 0,
      description: '',
      skills: [],
      isNda: false,
      isUrgent: false,
      clientCountry: '',
      bidType: 'fixed',
      detectedAt: Date.now(),
      source: 'dom-link'
    });
  }

  return projects;
}

function scanProjects() {
  const cards = getProjectCards();
  let projects = cards.map(extractProjectFromCard).filter((p) => p && p.projectId && p.title);
  if (!projects.length) {
    projects = scanProjectsFromLinks();
  }
  return projects;
}

function normalizeApiProject(item) {
  if (!item || typeof item !== 'object') return null;

  const seoUrl = item.seo_url || item.seoUrl || item.slug || '';
  const rawId = item.id || item.project_id || item.projectId;
  const href = item.url || item.link || (seoUrl ? `/projects/${seoUrl}` : `/projects/${rawId}`);
  const parsed = parseProjectHref(href);
  const projectId = parsed?.projectId || seoUrl || (rawId != null ? String(rawId) : '');
  const title = (item.title || item.name || '').trim();
  if (!projectId || !title) return null;

  const currencySign = item.currency?.sign || item.currency_sign || '$';
  const budgetMin = item.budget?.minimum ?? item.minimum_budget ?? item.min_budget;
  const budgetMax = item.budget?.maximum ?? item.maximum_budget ?? item.max_budget;
  const budgetText =
    item.budget_text ||
    (budgetMin != null
      ? `${currencySign}${budgetMin}${budgetMax != null ? ` - ${currencySign}${budgetMax}` : ''}`
      : '');

  const submittedAt = item.time_submitted || item.submitdate || item.submitted_at || item.time_created;
  const secondsAgo = submittedAt
    ? Math.max(0, Math.floor(Date.now() / 1000 - Number(submittedAt)))
    : null;

  const bidType = /hourly|per hour/i.test(String(item.type || item.project_type || budgetText))
    ? 'hourly'
    : 'fixed';

  const budgetInfo = parseBudgetInfo(budgetText);

  return {
    projectId: String(projectId),
    numericProjectId: rawId != null ? Number(rawId) : null,
    seoUrl: seoUrl || projectId,
    url: parsed?.url || normalizeDetailsUrl(href),
    title,
    bidCount: item.bid_count ?? item.bidCount ?? item.bids ?? null,
    secondsAgo,
    postedAt: submittedAt ? Number(submittedAt) : null,
    isListedOld: false,
    budget: budgetText || budgetInfo.budget,
    budgetMinUsd: budgetInfo.budgetMinUsd || parseBudgetMinUsd(budgetText),
    description: (item.description || item.preview_description || '').trim(),
    skills: Array.isArray(item.jobs) ? item.jobs.map((j) => j.name || j).filter(Boolean) : [],
    isNda: !!(item.nda || item.is_sealed || item.sealed),
    isUrgent: !!item.urgent,
    clientCountry: item.owner_country || item.country || item.client_country || '',
    bidType,
    detectedAt: Date.now(),
    source: 'api'
  };
}

function extractApiProjects(data) {
  const candidates = [
    data?.result?.projects,
    data?.result?.projects_and_contests,
    data?.result?.contests,
    data?.result,
    data?.projects,
    data?.projects_and_contests
  ];
  const items = candidates.find((value) => Array.isArray(value)) || [];
  return items.map(normalizeApiProject).filter(Boolean);
}

async function fetchRecentProjectsFromApi() {
  const res = await fetch(RECENT_PROJECTS_API, {
    credentials: 'include',
    headers: { Accept: 'application/json' }
  });
  if (!res.ok) return [];
  const data = await res.json();
  return extractApiProjects(data);
}

function mergeProjects(...groups) {
  const map = new Map();
  for (const group of groups) {
    for (const project of group) {
      if (!project?.projectId) continue;
      const existing = map.get(project.projectId);
      if (!existing) {
        map.set(project.projectId, project);
        continue;
      }
      const merged = { ...existing, ...project };
      if (existing.secondsAgo == null && project.secondsAgo != null) {
        merged.secondsAgo = project.secondsAgo;
      }
      if (existing.isListedOld && !project.isListedOld && project.secondsAgo != null) {
        merged.isListedOld = false;
      }
      map.set(project.projectId, merged);
    }
  }
  return Array.from(map.values());
}

async function loadSeenProjects() {
  const archiveRes = await chrome.runtime.sendMessage({ type: 'GET_ARCHIVE_IDS' }).catch(() => null);
  if (archiveRes?.ids?.length) {
    seenProjectIds = new Set(archiveRes.ids);
    return;
  }
  seenProjectIds = new Set();
}

function notifyNewProjects(projects, seedBaseline = false) {
  if (!projects.length && !seedBaseline) return;
  chrome.runtime
    .sendMessage({
      type: 'NEW_PROJECTS_DETECTED',
      projects,
      seedBaseline,
      pageUrl: window.location.href
    })
    .catch(() => {});
}

function notifyScanResult(stats) {
  chrome.runtime
    .sendMessage({
      type: 'MONITOR_SCAN_RESULT',
      ...stats,
      pageUrl: window.location.href
    })
    .catch(() => {});
}

function notifyMonitorError(error) {
  chrome.runtime
    .sendMessage({
      type: 'MONITOR_ERROR',
      message: String(error?.message || error),
      pageUrl: window.location.href
    })
    .catch(() => {});
}

async function runScan() {
  if (!isMonitoring) return;

  try {
  const domProjects = scanProjects();
  const apiProjects = await fetchRecentProjectsFromApi().catch(() => []);
  const projects = mergeProjects(apiProjects, domProjects).sort(compareProjectsByNewest);

  if (!hasSeededSeen) {
    projects.forEach((p) => seenProjectIds.add(p.projectId));
    hasSeededSeen = true;
    notifyNewProjects(projects, true);
    notifyScanResult({
      domCount: domProjects.length,
      apiCount: apiProjects.length,
      newCount: 0,
      seeded: true
    });
    return;
  }

  const newProjects = [];
  for (const project of projects) {
    if (!seenProjectIds.has(project.projectId)) {
      seenProjectIds.add(project.projectId);
      newProjects.push(project);
    }
  }

  notifyScanResult({
    domCount: domProjects.length,
    apiCount: apiProjects.length,
    newCount: newProjects.length,
    seeded: false
  });

  if (newProjects.length) {
    newProjects.sort(compareProjectsByNewest);
    notifyNewProjects(newProjects);
  }
  } catch (err) {
    notifyMonitorError(err);
  }
}

async function startMonitoring() {
  if (isMonitoring) return;
  isMonitoring = true;
  await loadSeenProjects();
  hasSeededSeen = seenProjectIds.size > 0;

  runScan().catch(() => {});
  observer = new MutationObserver(() => {
    runScan().catch(() => {});
  });
  observer.observe(document.body, { childList: true, subtree: true });

  const pollMs = await new Promise((resolve) => {
    chrome.storage.local.get(['settings'], (result) => {
      resolve(result.settings?.pollIntervalMs || 1500);
    });
  });
  if (scanIntervalId) clearInterval(scanIntervalId);
  scanIntervalId = setInterval(() => {
    runScan().catch(() => {});
  }, pollMs);
}

function stopMonitoring() {
  isMonitoring = false;
  hasSeededSeen = false;
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  if (scanIntervalId) {
    clearInterval(scanIntervalId);
    scanIntervalId = null;
  }
}

async function enrichProject(project) {
  const api = window.FabFreelancerApi;
  if (!api?.fetchProjectDetails) return project;
  try {
    const details = await api.fetchProjectDetails(project);
    return details ? { ...project, ...details } : project;
  } catch {
    return project;
  }
}

async function apiPlaceBid(project, bidData, settings) {
  const api = window.FabFreelancerApi;
  if (!api?.placeBidViaApi) {
    return { success: false, error: 'api_module_missing' };
  }
  return api.placeBidViaApi(project, bidData, settings);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'START_MONITORING') {
    startMonitoring().then(() => sendResponse({ ok: true }));
  } else if (msg.type === 'STOP_MONITORING') {
    stopMonitoring();
    sendResponse({ ok: true });
  } else if (msg.type === 'SCAN_PROJECTS') {
    runScan().then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
  } else if (msg.type === 'ENRICH_PROJECT') {
    enrichProject(msg.project).then((project) => sendResponse({ ok: true, project }));
  } else if (msg.type === 'API_PLACE_BID') {
    apiPlaceBid(msg.project, msg.bidData, msg.settings).then(sendResponse);
  } else if (msg.type === 'GET_MONITOR_STATUS') {
    sendResponse({ isMonitoring });
  } else if (msg.type === 'PING') {
    sendResponse({ ok: true, hasApi: !!window.FabFreelancerApi });
  }
  return true;
});

chrome.runtime
  .sendMessage({ type: 'CONTENT_SCRIPT_READY', page: 'projects-monitor' })
  .catch(() => {});

chrome.storage.local.get(['settings'], (result) => {
  if (result.settings?.isRunning) startMonitoring();
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.settings?.newValue?.isRunning) startMonitoring();
  else if (changes.settings?.newValue?.isRunning === false) stopMonitoring();
});

})();

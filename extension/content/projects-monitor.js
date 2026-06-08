/**
 * Freelancer.com プロジェクト一覧ページの監視
 * 新規プロジェクトを検出しバックグラウンドに通知
 */

(function () {
  'use strict';

  const SEEN_KEY = 'fab_seen_projects';
  const RECENT_PROJECTS_API =
    'https://www.freelancer.com/ajax-api/navigation/recent-projects-and-contests.php?limit=20&compact=true&new_errors=true&new_pools=true';
  let isMonitoring = false;
  let observer = null;
  let scanIntervalId = null;
  let seenProjectIds = new Set();
  let hasSeededSeen = false;

  function parseBidCount(text) {
    if (!text) return null;
    const match = text.match(/(\d+)\s*bids?/i);
    return match ? parseInt(match[1], 10) : null;
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
    if (locationText) return locationText;

    const text = card.textContent || '';
    const flagMatch = text.match(/(?:from|in|client[:\s]+)\s*([A-Za-z][A-Za-z\s]{2,30})/i);
    return flagMatch ? flagMatch[1].trim() : '';
  }

  function parseTimeAgo(text) {
    if (!text) return null;
    const lower = text.toLowerCase().trim();
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

  function extractProjectFromCard(card) {
    const titleEl = card.querySelector('a[href*="/projects/"], fl-link[href*="/projects/"] a, .ProjectCard-title a, h2 a, [data-project-id]');
    const linkEl = card.querySelector('a[href*="/projects/"]') || titleEl;
    if (!linkEl) return null;

    const href = linkEl.getAttribute('href') || '';
    const projectIdMatch = href.match(/projects\/([^/?#]+)/);
    const projectId = projectIdMatch ? projectIdMatch[1] : href;

    const title = (titleEl?.textContent || linkEl.textContent || '').trim();
    const bidEl = card.querySelector('[class*="bid"], [class*="Bid"], .ProjectCard-bid, fl-text');
    const bidText = bidEl?.textContent || card.textContent;
    const bidCount = parseBidCount(bidText);

    const timeEl = Array.from(card.querySelectorAll('fl-text, span, small, time')).find((el) =>
      /ago|just now|seconds|minutes|hours/i.test(el.textContent)
    );
    const secondsAgo = parseTimeAgo(timeEl?.textContent || '');

    const budgetEl = card.querySelector('[class*="budget"], [class*="Budget"], [class*="price"]');
    const budget = budgetEl?.textContent?.trim() || '';

    const descEl = card.querySelector('[class*="description"], [class*="Description"], p');
    const description = descEl?.textContent?.trim() || '';

    const skillEls = card.querySelectorAll('[class*="skill"], [class*="Skill"], fl-tag, .Tag');
    const skills = Array.from(skillEls).map((el) => el.textContent.trim()).filter(Boolean);

    const isNda = /nda|ip agreement|sealed/i.test(card.textContent);
    const isUrgent = /urgent/i.test(card.textContent);
    const clientCountry = extractClientCountry(card);
    const bidType = /per hour|hourly|\/hr/i.test(budget) ? 'hourly' : 'fixed';
    const budgetMinUsd = parseBudgetMinUsd(budget);

    return {
      projectId,
      url: href.startsWith('http') ? href : `https://www.freelancer.com${href}`,
      title,
      bidCount,
      secondsAgo,
      budget,
      budgetMinUsd,
      description,
      skills,
      isNda,
      isUrgent,
      clientCountry,
      bidType,
      detectedAt: Date.now()
    };
  }

  function getProjectCards() {
    const selectors = [
      'fl-project-contest-card',
      'fl-project-card',
      '[class*="ProjectCard"]',
      '[class*="project-card"]',
      'article',
      '.JobSearchCard-item'
    ];
    for (const sel of selectors) {
      const cards = document.querySelectorAll(sel);
      if (cards.length > 0) return Array.from(cards);
    }
    return Array.from(document.querySelectorAll('a[href*="/projects/"]'))
      .map((a) => a.closest('article, li, div[class*="card"], fl-project-contest-card') || a.parentElement)
      .filter(Boolean);
  }

  function scanProjects() {
    const cards = getProjectCards();
    const projects = cards.map(extractProjectFromCard).filter((p) => p && p.projectId && p.title);
    return projects;
  }

  function normalizeApiProject(item) {
    if (!item || typeof item !== 'object') return null;

    const seoUrl = item.seo_url || item.seoUrl || item.slug;
    const rawId = item.id || item.project_id || item.projectId;
    const projectId = seoUrl || (rawId != null ? String(rawId) : '');
    const title = (item.title || item.name || '').trim();
    if (!projectId || !title) return null;

    const currencySign = item.currency?.sign || item.currency_sign || '$';
    const budgetMin = item.budget?.minimum ?? item.minimum_budget ?? item.min_budget;
    const budgetMax = item.budget?.maximum ?? item.maximum_budget ?? item.max_budget;
    const budgetText = item.budget_text ||
      (budgetMin != null
        ? `${currencySign}${budgetMin}${budgetMax != null ? ` - ${currencySign}${budgetMax}` : ''}`
        : '');

    const submittedAt = item.time_submitted || item.submitdate || item.submitted_at;
    const secondsAgo = submittedAt
      ? Math.max(0, Math.floor(Date.now() / 1000 - Number(submittedAt)))
      : null;

    const bidType = /hourly|per hour/i.test(String(item.type || item.project_type || budgetText))
      ? 'hourly'
      : 'fixed';

    const href = item.url || item.link || `/projects/${projectId}`;
    return {
      projectId: String(projectId),
      url: href.startsWith('http') ? href : `https://www.freelancer.com${href}`,
      title,
      bidCount: item.bid_count ?? item.bidCount ?? item.bids ?? null,
      secondsAgo,
      budget: budgetText,
      budgetMinUsd: parseBudgetMinUsd(budgetText),
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
        map.set(project.projectId, { ...map.get(project.projectId), ...project });
      }
    }
    return Array.from(map.values());
  }

  function loadSeenProjects() {
    return new Promise((resolve) => {
      chrome.storage.local.get([SEEN_KEY], (result) => {
        seenProjectIds = new Set(result[SEEN_KEY] || []);
        resolve();
      });
    });
  }

  function saveSeenProjects() {
    const ids = Array.from(seenProjectIds).slice(-5000);
    chrome.storage.local.set({ [SEEN_KEY]: ids });
  }

  function notifyNewProjects(projects) {
    if (!projects.length) return;
    chrome.runtime.sendMessage({
      type: 'NEW_PROJECTS_DETECTED',
      projects,
      pageUrl: window.location.href
    }).catch(() => {});
  }

  async function runScan() {
    if (!isMonitoring) return;

    const domProjects = scanProjects();
    const apiProjects = await fetchRecentProjectsFromApi().catch(() => []);
    const projects = mergeProjects(domProjects, apiProjects);
    if (!projects.length) return;

    if (!hasSeededSeen) {
      projects.forEach((p) => seenProjectIds.add(p.projectId));
      saveSeenProjects();
      hasSeededSeen = true;
      return;
    }

    const newProjects = [];
    for (const project of projects) {
      if (!seenProjectIds.has(project.projectId)) {
        seenProjectIds.add(project.projectId);
        newProjects.push(project);
      }
    }

    if (newProjects.length) {
      saveSeenProjects();
      notifyNewProjects(newProjects);
    }
  }

  async function startMonitoring() {
    if (isMonitoring) return;
    isMonitoring = true;
    hasSeededSeen = false;
    await loadSeenProjects();

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

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'START_MONITORING') {
      startMonitoring().then(() => sendResponse({ ok: true }));
    } else if (msg.type === 'STOP_MONITORING') {
      stopMonitoring();
      sendResponse({ ok: true });
    } else if (msg.type === 'SCAN_PROJECTS') {
      runScan().then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
    } else if (msg.type === 'GET_MONITOR_STATUS') {
      sendResponse({ isMonitoring });
    } else if (msg.type === 'PING') {
      sendResponse({ ok: true });
    }
    return true;
  });

  chrome.runtime.sendMessage({ type: 'CONTENT_SCRIPT_READY', page: 'projects-monitor' }).catch(() => {});

  chrome.storage.local.get(['settings'], (result) => {
    if (result.settings?.isRunning) startMonitoring();
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.settings?.newValue?.isRunning) startMonitoring();
    else if (changes.settings?.newValue?.isRunning === false) stopMonitoring();
  });
})();

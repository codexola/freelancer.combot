/**
 * Freelancer.com プロジェクト一覧ページの監視
 * 新規プロジェクトを検出しバックグラウンドに通知
 */

(function () {
  'use strict';

  const SEEN_KEY = 'fab_seen_projects';
  let isMonitoring = false;
  let observer = null;

  function parseBidCount(text) {
    if (!text) return 999;
    const match = text.match(/(\d+)\s*bids?/i);
    return match ? parseInt(match[1], 10) : 0;
  }

  const EXCLUDED_COUNTRIES = [
    'india', 'pakistan', 'algeria', 'angola', 'benin', 'botswana', 'burkina faso', 'burundi',
    'cameroon', 'cape verde', 'central african republic', 'chad', 'comoros', 'congo',
    'democratic republic of the congo', 'djibouti', 'egypt', 'equatorial guinea', 'eritrea',
    'eswatini', 'ethiopia', 'gabon', 'gambia', 'ghana', 'guinea', 'guinea-bissau',
    'ivory coast', 'kenya', 'lesotho', 'liberia', 'libya', 'madagascar', 'malawi', 'mali',
    'mauritania', 'mauritius', 'morocco', 'mozambique', 'namibia', 'niger', 'nigeria',
    'rwanda', 'senegal', 'seychelles', 'sierra leone', 'somalia', 'south africa',
    'south sudan', 'sudan', 'tanzania', 'togo', 'tunisia', 'uganda', 'zambia', 'zimbabwe'
  ];

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
    const text = card.textContent || '';
    const locationEl = card.querySelector('[class*="location"], [class*="Location"], [class*="country"], [class*="Country"]');
    const locationText = (locationEl?.textContent || '').trim();
    const candidates = [locationText, text];
    for (const c of EXCLUDED_COUNTRIES) {
      for (const src of candidates) {
        if (src.toLowerCase().includes(c)) return c;
      }
    }
    const flagMatch = text.match(/(?:from|in|client[:\s]+)\s*([A-Za-z\s]{3,30})/i);
    return flagMatch ? flagMatch[1].trim() : locationText || '';
  }

  function parseTimeAgo(text) {
    if (!text) return Infinity;
    const lower = text.toLowerCase().trim();
    if (lower.includes('just now') || lower.includes('seconds ago')) {
      const secMatch = lower.match(/(\d+)\s*seconds?\s*ago/);
      return secMatch ? parseInt(secMatch[1], 10) : 0;
    }
    if (lower.includes('a minute ago') || lower.includes('1 minute')) return 60;
    const minMatch = lower.match(/(\d+)\s*minutes?\s*ago/);
    if (minMatch) return parseInt(minMatch[1], 10) * 60;
    const hourMatch = lower.match(/(\d+)\s*hours?\s*ago/);
    if (hourMatch) return parseInt(hourMatch[1], 10) * 3600;
    return Infinity;
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

  function notifyNewProjects(projects) {
    chrome.runtime.sendMessage({
      type: 'NEW_PROJECTS_DETECTED',
      projects,
      pageUrl: window.location.href
    }).catch(() => {});
  }

  function startMonitoring() {
    if (isMonitoring) return;
    isMonitoring = true;

    const runScan = () => {
      if (!isMonitoring) return;
      const projects = scanProjects();
      if (projects.length) notifyNewProjects(projects);
    };

    runScan();
    observer = new MutationObserver(() => runScan());
    observer.observe(document.body, { childList: true, subtree: true });

    setInterval(runScan, 1500);
  }

  function stopMonitoring() {
    isMonitoring = false;
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'START_MONITORING') {
      startMonitoring();
      sendResponse({ ok: true });
    } else if (msg.type === 'STOP_MONITORING') {
      stopMonitoring();
      sendResponse({ ok: true });
    } else if (msg.type === 'SCAN_PROJECTS') {
      sendResponse({ projects: scanProjects() });
    } else if (msg.type === 'GET_MONITOR_STATUS') {
      sendResponse({ isMonitoring });
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

/**
 * Read Freelancer.com localStorage / sessionStorage (same-origin page context)
 */
(function (global) {
  'use strict';

  function safeJsonParse(raw) {
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function parseUserId() {
    try {
      const hj = localStorage.getItem('_hjUserAttributes');
      if (hj) {
        const decoded = JSON.parse(atob(hj));
        if (decoded?.userId) return String(decoded.userId);
      }
    } catch {
      /* ignore */
    }

    const viewed = safeJsonParse(localStorage.getItem('viewedItems'));
    if (viewed && typeof viewed === 'object') {
      const userKey = Object.keys(viewed).find((k) => /^id-\d+$/.test(k));
      if (userKey) return userKey.replace(/^id-/, '');
    }

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) || '';
      const nested = safeJsonParse(localStorage.getItem(key));
      if (!nested || typeof nested !== 'object') continue;
      const innerKey = Object.keys(nested).find((k) => /^id-\d+$/.test(k));
      if (innerKey) return innerKey.replace(/^id-/, '');
    }

    return null;
  }

  function parseViewedNumericIds() {
    const ids = new Set();
    const viewed = safeJsonParse(localStorage.getItem('viewedItems'));
    if (!viewed || typeof viewed !== 'object') return ids;

    for (const entry of Object.values(viewed)) {
      const projects = entry?.item?.project;
      if (!projects || typeof projects !== 'object') continue;
      for (const id of Object.keys(projects)) {
        if (/^\d+$/.test(id)) ids.add(id);
      }
    }
    return ids;
  }

  function parseSearchServiceFilters() {
    const raw = safeJsonParse(localStorage.getItem('searchServiceFilters'));
    if (!raw || typeof raw !== 'object') {
      return { projectSort: 'latest', projectLanguages: [], clientCountries: [] };
    }

    let item = null;
    for (const entry of Object.values(raw)) {
      if (entry?.item?.projects) {
        item = entry.item;
        break;
      }
    }
    if (!item?.projects) {
      return { projectSort: 'latest', projectLanguages: [], clientCountries: [] };
    }

    const projects = item.projects;
    const projectLanguages = (projects.projectLanguages || [])
      .filter((l) => l.selected)
      .map((l) => l.value)
      .filter(Boolean);

    const clientCountries = (projects.clientCountries || [])
      .map((c) => (typeof c === 'string' ? c : c.value || c.name || ''))
      .filter(Boolean);

    const types = (projects.types || [])
      .filter((t) => t.selected)
      .map((t) => t.value);

    return {
      projectSort: projects.projectSort || 'latest',
      projectLanguages,
      clientCountries,
      projectTypes: types.length ? types : ['fixed', 'hourly'],
      query: item.shared?.q || ''
    };
  }

  function getUserScopedEntry(storageKey) {
    const raw = safeJsonParse(localStorage.getItem(storageKey));
    if (!raw || typeof raw !== 'object') return { userKey: null, entry: null, item: null };
    const userKey = Object.keys(raw).find((k) => /^id-\d+$/.test(k));
    if (!userKey) return { userKey: null, entry: null, item: null };
    return { userKey, entry: raw[userKey], item: raw[userKey]?.item || null };
  }

  function parseLastUsedForms(userId) {
    const { userKey, item } = getUserScopedEntry('lastUsedForms');
    if (!item || typeof item !== 'object') return { userKey, forms: {} };
    const uid = userId || (userKey ? userKey.replace(/^id-/, '') : parseUserId());
    const forms = {};
    for (const [key, value] of Object.entries(item)) {
      if (!key.startsWith('bidForm-')) continue;
      const numericId = key.replace(/^bidForm-/, '');
      if (!/^\d+$/.test(numericId)) continue;
      forms[numericId] = value;
    }
    return { userId: uid, userKey, forms };
  }

  function computeExcludingCommission(bidAmount) {
    const amount = Number(bidAmount);
    if (!amount) return '0.00';
    const ratio = amount >= 100 ? 0.9 : 0.75;
    return (amount * ratio).toFixed(2);
  }

  function getBidFormForProject(numericProjectId, userId) {
    const numeric = String(numericProjectId || '').trim();
    if (!/^\d+$/.test(numeric)) return null;
    const { forms } = parseLastUsedForms(userId);
    return forms[numeric] || null;
  }

  function updateBidFormForProject(numericProjectId, bidData, settings, userId) {
    const numeric = String(numericProjectId || '').trim();
    if (!/^\d+$/.test(numeric)) return false;

    const raw = safeJsonParse(localStorage.getItem('lastUsedForms')) || {};
    let userKey = userId ? `id-${userId}` : null;
    if (!userKey) {
      userKey = Object.keys(raw).find((k) => /^id-\d+$/.test(k)) || `id-${parseUserId() || '0'}`;
    }
    if (!raw[userKey]) {
      raw[userKey] = { timeCreated: Date.now(), timeUpdated: Date.now(), item: {} };
    }
    const item = raw[userKey].item || (raw[userKey].item = {});
    const formKey = `bidForm-${numeric}`;
    const existing = item[formKey] || {};
    const isHourly = (bidData.bidType || existing.bid?.bidType) === 'hourly';
    const bidAmount = isHourly
      ? String(bidData.hourlyRate || settings?.defaultHourlyRate || existing.bid?.bidAmount || '')
      : String(bidData.bidAmount || settings?.defaultBidAmount || existing.bid?.bidAmount || '');
    const period = Number(
      bidData.deliveryDays || settings?.defaultDeliveryDays || existing.bid?.period || 7
    );

    item[formKey] = {
      ...existing,
      bid: {
        ...(existing.bid || {}),
        bidAmount,
        period,
        bidAmountExcludingCommission: computeExcludingCommission(bidAmount)
      },
      proposal: {
        ...(existing.proposal || {}),
        proposal: String(bidData.proposal || existing.proposal?.proposal || '')
      },
      upgrades: existing.upgrades || { sponsored: false, highlight: false, sealed: false },
      location_disclaimer: existing.location_disclaimer ?? false
    };
    if (!isHourly && bidAmount) {
      item[formKey].milestone_request = existing.milestone_request || [
        {
          id: Date.now(),
          amount: bidAmount,
          fundByDate: null,
          description: 'Project milestone'
        }
      ];
    }

    raw[userKey].timeUpdated = Date.now();
    localStorage.setItem('lastUsedForms', JSON.stringify(raw));
    return true;
  }

  function readSessionSnapshot() {
    const userId = parseUserId();
    const viewedNumericIds = Array.from(parseViewedNumericIds());
    const searchFilters = parseSearchServiceFilters();
    const { forms } = parseLastUsedForms(userId);
    const trackingSession = sessionStorage.getItem('_tracking_client_session') || '';
    const notificationSession = sessionStorage.getItem('notification_socket_session_id') || '';

    return {
      userId,
      viewedNumericIds,
      searchFilters,
      lastUsedFormCount: Object.keys(forms).length,
      trackingSession,
      notificationSession,
      readAt: Date.now()
    };
  }

  function isProjectSeenByFreelancer(project, viewedNumericSet) {
    if (!project || !viewedNumericSet?.size) return false;
    const numeric = project.numericProjectId || project.numericId;
    if (numeric != null && viewedNumericSet.has(String(numeric))) return true;
    if (/^\d+$/.test(String(project.projectId)) && viewedNumericSet.has(String(project.projectId))) {
      return true;
    }
    return false;
  }

  global.FabFreelancerSession = {
    readSessionSnapshot,
    parseUserId,
    parseViewedNumericIds,
    parseSearchServiceFilters,
    parseLastUsedForms,
    getBidFormForProject,
    updateBidFormForProject,
    isProjectSeenByFreelancer
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);

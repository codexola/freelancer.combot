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

  function readSessionSnapshot() {
    const userId = parseUserId();
    const viewedNumericIds = Array.from(parseViewedNumericIds());
    const searchFilters = parseSearchServiceFilters();
    const trackingSession = sessionStorage.getItem('_tracking_client_session') || '';
    const notificationSession = sessionStorage.getItem('notification_socket_session_id') || '';

    return {
      userId,
      viewedNumericIds,
      searchFilters,
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
    isProjectSeenByFreelancer
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);

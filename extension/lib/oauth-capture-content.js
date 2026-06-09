/**
 * Capture Freelancer OAuth token from in-page API requests (logged-in session).
 */
(function (global) {
  'use strict';

  const OAUTH_HEADER = 'freelancer-oauth-v1';
  let lastReported = '';

  function extractTokenFromHeaders(headers) {
    if (!headers) return '';
    if (headers instanceof Headers) {
      return headers.get(OAUTH_HEADER) || headers.get('Freelancer-Oauth-V1') || '';
    }
    if (Array.isArray(headers)) {
      for (let i = 0; i < headers.length; i += 2) {
        const name = String(headers[i] || '').toLowerCase();
        if (name === OAUTH_HEADER) return String(headers[i + 1] || '');
      }
      return '';
    }
    if (typeof headers === 'object') {
      for (const [key, value] of Object.entries(headers)) {
        if (String(key).toLowerCase() === OAUTH_HEADER && value) return String(value);
      }
    }
    return '';
  }

  function reportToken(token) {
    const trimmed = String(token || '').trim();
    if (!trimmed || trimmed.length < 8 || trimmed === lastReported) return;
    lastReported = trimmed;
    chrome.runtime.sendMessage({ type: 'OAUTH_TOKEN_CAPTURED', token: trimmed }).catch(() => {});
  }

  function isFreelancerApiUrl(url) {
    const text = String(url || '');
    return /freelancer\.com\/api\//i.test(text) || /\/api\/projects\//i.test(text);
  }

  const originalFetch = global.fetch;
  if (typeof originalFetch === 'function') {
    global.fetch = function patchedFetch(input, init) {
      try {
        const url = typeof input === 'string' ? input : input?.url;
        if (isFreelancerApiUrl(url)) {
          const token = extractTokenFromHeaders(init?.headers);
          if (token) reportToken(token);
        }
      } catch {
        /* ignore */
      }
      return originalFetch.apply(this, arguments);
    };
  }

  const XhrProto = global.XMLHttpRequest?.prototype;
  if (XhrProto) {
    const originalSetHeader = XhrProto.setRequestHeader;
    XhrProto.setRequestHeader = function setRequestHeader(name, value) {
      if (String(name).toLowerCase() === OAUTH_HEADER) {
        reportToken(value);
      }
      return originalSetHeader.apply(this, arguments);
    };
  }

  function scanStorageForOAuthToken() {
    const candidates = [];
    const storages = [global.localStorage, global.sessionStorage].filter(Boolean);
    for (const storage of storages) {
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i) || '';
        const raw = storage.getItem(key);
        if (!raw) continue;
        if (/oauth2_/i.test(raw)) {
          const match = raw.match(/oauth2_[A-Za-z0-9._-]+/);
          if (match) candidates.push(match[0]);
        }
        if (/^oauth2_/i.test(raw.trim())) candidates.push(raw.trim());
      }
    }
    if (candidates.length) reportToken(candidates[0]);
  }

  scanStorageForOAuthToken();
  setTimeout(scanStorageForOAuthToken, 3000);

  global.FabOAuthCapture = { reportToken, scanStorageForOAuthToken };
})(typeof globalThis !== 'undefined' ? globalThis : window);

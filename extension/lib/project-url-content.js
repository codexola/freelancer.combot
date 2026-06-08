/**
 * Classic-script build of project-url helpers for content scripts.
 */
(function (global) {
  'use strict';

  function cleanPathSegments(path) {
    return path
      .replace(/\/details\/?$/i, '')
      .replace(/\/$/, '')
      .split('/')
      .filter(Boolean)
      .map((seg) => seg.replace(/\.html$/i, ''))
      .filter(Boolean);
  }

  function normalizeDetailsUrl(href) {
    if (!href) return '';

    const absolute = href.startsWith('http')
      ? href
      : `https://www.freelancer.com${href.startsWith('/') ? href : `/${href}`}`;

    try {
      const url = new URL(absolute.split('?')[0].split('#')[0]);
      let segments = cleanPathSegments(url.pathname.replace(/^\/projects\/?/i, ''));
      if (!segments.length) return '';

      let path = `/projects/${segments.join('/')}`;
      if (!/\/details$/i.test(path)) {
        path += '/details';
      }
      return `https://www.freelancer.com${path}`;
    } catch {
      return absolute.replace(/\.html\/?/gi, '/').replace(/\/?$/, '/details');
    }
  }

  function parseProjectHref(href) {
    if (!href) return null;

    const cleaned = href.split('?')[0].split('#')[0];
    const match = cleaned.match(/(?:projects|contest)\/(.+)$/i);
    if (!match) return null;

    const segments = cleanPathSegments(match[1]);
    if (!segments.length) return null;

    const lastSeg = segments[segments.length - 1];
    const numericProjectId = /^\d+$/.test(lastSeg) ? Number(lastSeg) : null;
    const projectId = segments.length >= 2 ? `${segments[0]}/${segments[1]}` : segments[0];
    const categorySlug = segments.length >= 2 ? segments[0] : '';
    const projectSlug = segments.length >= 2 ? segments[1] : segments[0];

    return {
      projectId,
      numericProjectId,
      categorySlug,
      projectSlug,
      seoUrl: segments.length >= 2 ? `${segments[0]}/${segments[1]}` : segments[0],
      url: normalizeDetailsUrl(href)
    };
  }

  function getProjectSortPriority(project) {
    if (project.secondsAgo != null && project.secondsAgo >= 0) {
      return project.secondsAgo;
    }
    if (project.postedAt) {
      return Math.max(0, Math.floor(Date.now() / 1000 - Number(project.postedAt)));
    }
    if (project.isNewDetection && project.detectedAt) {
      return Math.floor((Date.now() - project.detectedAt) / 1000);
    }
    return Number.MAX_SAFE_INTEGER;
  }

  function compareProjectsByNewest(a, b) {
    return getProjectSortPriority(a) - getProjectSortPriority(b);
  }

  global.FabProjectUrl = {
    parseProjectHref,
    normalizeDetailsUrl,
    getProjectSortPriority,
    compareProjectsByNewest
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);

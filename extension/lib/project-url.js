/**
 * Freelancer project URL parsing and normalization
 * /projects/{category}/{project-slug}/details
 */

export function parseProjectHref(href) {
  if (!href) return null;

  const cleaned = href.split('?')[0].split('#')[0];
  const match = cleaned.match(/(?:projects|contest)\/(.+)$/i);
  if (!match) return null;

  const path = match[1].replace(/\/details\/?$/i, '').replace(/\/$/, '');
  const parts = path.split('/').filter(Boolean);
  if (!parts.length) return null;

  const projectId = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0];

  return {
    projectId,
    categorySlug: parts.length >= 2 ? parts[0] : '',
    projectSlug: parts.length >= 2 ? parts[1] : parts[0],
    url: normalizeDetailsUrl(href)
  };
}

export function normalizeDetailsUrl(href) {
  if (!href) return '';

  const absolute = href.startsWith('http')
    ? href
    : `https://www.freelancer.com${href.startsWith('/') ? href : `/${href}`}`;

  try {
    const url = new URL(absolute.split('?')[0].split('#')[0]);
    let path = url.pathname.replace(/\/$/, '');
    if (!/\/details$/i.test(path)) {
      path += '/details';
    }
    return `https://www.freelancer.com${path}`;
  } catch {
    return absolute.replace(/\/?$/, '/details');
  }
}

export function getProjectSortPriority(project) {
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

export function compareProjectsByNewest(a, b) {
  return getProjectSortPriority(a) - getProjectSortPriority(b);
}

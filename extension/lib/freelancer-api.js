/**
 * Freelancer.com session/OAuth API — fast bid path without full page render
 */

const API_BASE = 'https://www.freelancer.com/api';

export async function fetchWithSession(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { ok: res.ok, status: res.status, data };
}

function pickCountry(owner = {}, project = {}) {
  const candidates = [
    owner.country?.name,
    owner.country,
    owner.location?.country?.name,
    owner.location?.country,
    owner.timezone?.country,
    project.owner_country,
    project.country,
    project.client_country
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return '';
}

function pickLanguage(project = {}, owner = {}) {
  const candidates = [
    project.language,
    project.language_code,
    project.lang,
    owner.language,
    owner.preferred_language
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return '';
}

function normalizeProjectRecord(raw, fallback = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const project = raw.project || raw.result?.project || raw.result || raw;
  const owner = project.owner || project.employer || project.user || {};
  const currency = project.currency || {};
  const budget = project.budget || {};
  const sign = currency.sign || '$';
  const budgetMin = budget.minimum ?? project.minimum_budget;
  const budgetMax = budget.maximum ?? project.maximum_budget;
  const budgetText =
    budgetMin != null
      ? `${sign}${budgetMin}${budgetMax != null ? ` - ${sign}${budgetMax}` : ''}`
      : fallback.budget || '';

  const bidType =
    project.type === 'hourly' || /hourly/i.test(String(project.type || '')) ? 'hourly' : 'fixed';

  return {
    numericProjectId: project.id || project.project_id || fallback.numericProjectId || null,
    projectId: fallback.projectId || String(project.seo_url || project.id || ''),
    title: project.title || project.name || fallback.title || '',
    description: project.description || project.preview_description || fallback.description || '',
    budget: budgetText,
    bidType,
    bidCount: project.bid_count ?? project.bid_stats?.bid_count ?? fallback.bidCount,
    clientCountry: pickCountry(owner, project) || fallback.clientCountry || '',
    country: pickCountry(owner, project),
    projectLanguage: pickLanguage(project, owner),
    language: pickLanguage(project, owner),
    skills: Array.isArray(project.jobs)
      ? project.jobs.map((j) => j.name || j).filter(Boolean)
      : fallback.skills || [],
    isNda: !!(project.nda || project.is_sealed || project.sealed),
    seoUrl: project.seo_url || fallback.projectId
  };
}

export async function fetchProjectDetails(project) {
  const numericId = project.numericProjectId || project.numericId;
  const seo = project.seoUrl || project.projectId;

  const attempts = [];
  if (numericId) {
    attempts.push(`${API_BASE}/projects/0.1/projects/${numericId}/?compact=true&job_details=true&user_details=true`);
  }
  if (seo && String(seo).includes('/')) {
    attempts.push(
      `${API_BASE}/projects/0.1/projects/?seo_urls[]=${encodeURIComponent(seo)}&compact=true&job_details=true&user_details=true`
    );
  }
  if (seo) {
    attempts.push(
      `${API_BASE}/projects/0.1/projects/?project_ids[]=${encodeURIComponent(numericId || seo)}&compact=true&job_details=true&user_details=true`
    );
  }

  for (const url of attempts) {
    const { ok, data } = await fetchWithSession(url);
    if (!ok || !data) continue;

    const list = data.result?.projects;
    if (Array.isArray(list) && list.length) {
      return normalizeProjectRecord(list[0], project);
    }
    const record = normalizeProjectRecord(data, project);
    if (record?.title) return record;
  }

  return null;
}

export async function fetchSelfUserId(oauthToken) {
  const headers = oauthToken ? { 'freelancer-oauth-v1': oauthToken } : {};
  const { ok, data } = await fetchWithSession(`${API_BASE}/users/0.1/self/`, { headers });
  if (!ok) return null;
  return data?.result?.id || data?.result?.user_id || null;
}

export async function placeBidViaApi(project, bidData, settings) {
  const numericId = project.numericProjectId || project.numericId;
  if (!numericId) {
    return { success: false, skipped: false, error: 'numeric_project_id_missing' };
  }

  const oauthToken = settings.freelancerOAuthToken?.trim();
  const authHeaders = oauthToken ? { 'freelancer-oauth-v1': oauthToken } : {};

  let bidderId = settings.freelancerUserId || null;
  if (!bidderId) {
    bidderId = await fetchSelfUserId(oauthToken);
  }
  if (!bidderId) {
    return { success: false, skipped: false, error: 'bidder_id_unavailable' };
  }

  const isHourly = (project.bidType || bidData.bidType) === 'hourly';
  const payload = {
    project_id: Number(numericId),
    bidder_id: Number(bidderId),
    description: String(bidData.proposal || '').slice(0, 1500),
    milestone_percentage: 100
  };

  if (isHourly) {
    payload.amount = Number(bidData.hourlyRate || settings.defaultHourlyRate);
  } else {
    payload.amount = Number(bidData.bidAmount || settings.defaultBidAmount);
    payload.period = Number(bidData.deliveryDays || settings.defaultDeliveryDays);
  }

  const { ok, status, data } = await fetchWithSession(`${API_BASE}/projects/0.1/bids/`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify(payload)
  });

  if (ok && (data?.status === 'success' || data?.result)) {
    return { success: true, message: 'API入札完了', viaApi: true };
  }

  const errMsg =
    data?.message || data?.error_code || `API bid failed (${status})`;

  if (/nda|sealed|document|sign|agreement|not_authenticated/i.test(errMsg)) {
    return { success: false, needsBrowser: true, error: errMsg };
  }

  return { success: false, skipped: false, error: errMsg };
}

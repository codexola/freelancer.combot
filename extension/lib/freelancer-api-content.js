/**
 * Session-cookie Freelancer API helpers (content script context)
 */
(function (global) {
  'use strict';

  const API_BASE = 'https://www.freelancer.com/api';

  async function fetchWithSession(url, options = {}) {
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

  function pickCountry(owner, project) {
    owner = owner || {};
    project = project || {};
    const candidates = [
      owner.country?.name,
      owner.country,
      owner.location?.country?.name,
      owner.location?.country,
      project.owner_country,
      project.country
    ];
    for (const c of candidates) {
      if (typeof c === 'string' && c.trim()) return c.trim();
    }
    return '';
  }

  function pickLanguage(project, owner) {
    const candidates = [project.language, project.language_code, owner?.language];
    for (const c of candidates) {
      if (typeof c === 'string' && c.trim()) return c.trim();
    }
    return '';
  }

  function normalizeProjectRecord(raw, fallback) {
    if (!raw || typeof raw !== 'object') return null;
    fallback = fallback || {};
    const project = raw.project || raw.result?.project || raw.result || raw;
    const owner = project.owner || project.employer || {};
    const currency = project.currency || {};
    const budget = project.budget || {};
    const sign = currency.sign || '$';
    const budgetMin = budget.minimum ?? project.minimum_budget;
    const budgetMax = budget.maximum ?? project.maximum_budget;
    const budgetText =
      budgetMin != null
        ? `${sign}${budgetMin}${budgetMax != null ? ` - ${sign}${budgetMax}` : ''}`
        : fallback.budget || '';
    const bidType = project.type === 'hourly' || /hourly/i.test(String(project.type || '')) ? 'hourly' : 'fixed';

    return {
      numericProjectId: project.id || project.project_id || fallback.numericProjectId || null,
      projectId: fallback.projectId || String(project.seo_url || project.id || ''),
      title: project.title || fallback.title || '',
      description: project.description || project.preview_description || fallback.description || '',
      budget: budgetText,
      bidType,
      bidCount: project.bid_count ?? fallback.bidCount,
      clientCountry: pickCountry(owner, project) || fallback.clientCountry || '',
      country: pickCountry(owner, project),
      projectLanguage: pickLanguage(project, owner),
      language: pickLanguage(project, owner),
      skills: Array.isArray(project.jobs)
        ? project.jobs.map((j) => j.name || j).filter(Boolean)
        : fallback.skills || [],
      isNda: !!(project.nda || project.is_sealed || project.sealed || project.is_ndasa),
      requiresDocument: !!(
        project.nda ||
        project.is_sealed ||
        project.sealed ||
        project.is_ndasa ||
        project.frontend_apply_status === 'document_required'
      ),
      seoUrl: project.seo_url || fallback.projectId
    };
  }

  async function fetchProjectDetails(project) {
    const numericId = project.numericProjectId || project.numericId;
    const seo = project.seoUrl || project.projectId;
    const attempts = [];

    if (numericId) {
      attempts.push(
        `${API_BASE}/projects/0.1/projects/${numericId}/?compact=true&job_details=true&user_details=true`
      );
    }
    if (seo && String(seo).includes('/')) {
      attempts.push(
        `${API_BASE}/projects/0.1/projects/?seo_urls[]=${encodeURIComponent(seo)}&compact=true&job_details=true&user_details=true`
      );
    }
    if (seo) {
      const slug = String(seo).split('/').pop();
      if (slug && slug !== seo) {
        attempts.push(
          `${API_BASE}/projects/0.1/projects/?seo_urls[]=${encodeURIComponent(slug)}&compact=true&job_details=true&user_details=true`
        );
      }
    }

    for (const url of attempts) {
      const { ok, data } = await fetchWithSession(url);
      if (!ok || !data) continue;
      const list = data.result?.projects;
      if (Array.isArray(list) && list.length) {
        return normalizeProjectRecord(list[0], project);
      }
      const record = normalizeProjectRecord(data, project);
      if (record?.numericProjectId || record?.title) return record;
    }
    return null;
  }

  async function fetchSelfInfo(oauthToken) {
    const headers = oauthToken ? { 'freelancer-oauth-v1': oauthToken } : {};
    const { ok, data } = await fetchWithSession(`${API_BASE}/users/0.1/self/?profile_details=true`, {
      headers
    });
    if (!ok) return null;
    const result = data?.result || {};
    return {
      userId: result.id || result.user_id || null,
      displayName: result.display_name || result.public_name || result.username || '',
      profiles: result.profiles || result.profile_details || []
    };
  }

  async function fetchSelfUserId(oauthToken) {
    const info = await fetchSelfInfo(oauthToken);
    return info?.userId || null;
  }

  function pickProfileId(profiles, profileName) {
    if (!profiles?.length) return null;
    const wanted = (profileName || 'general').toLowerCase();
    const match = profiles.find((p) => {
      const name = (p.name || p.profile_name || p.title || '').toLowerCase();
      return name.includes(wanted) || wanted.includes(name);
    });
    const picked = match || profiles[0];
    return picked?.id || picked?.profile_id || null;
  }

  async function resolveProjectForBid(project) {
    if (project.numericProjectId) {
      const details = await fetchProjectDetails(project);
      return details ? { ...project, ...details } : project;
    }
    const details = await fetchProjectDetails(project);
    return details ? { ...project, ...details } : project;
  }

  async function placeBidViaApi(project, bidData, settings) {
    let resolved = await resolveProjectForBid(project);
    const numericId = resolved.numericProjectId || resolved.numericId;
    if (!numericId) {
      return { success: false, error: 'numeric_project_id_missing', needsBrowser: false };
    }

    if (resolved.requiresDocument || resolved.isNda) {
      return {
        success: false,
        needsBrowser: true,
        error: 'document_signing_required'
      };
    }

    const oauthToken = (settings.freelancerOAuthToken || '').trim();
    const authHeaders = oauthToken ? { 'freelancer-oauth-v1': oauthToken } : {};

    let bidderId = settings.freelancerUserId || null;
    let profileId = settings.freelancerProfileId || null;
    const selfInfo = await fetchSelfInfo(oauthToken);
    if (!bidderId && selfInfo?.userId) bidderId = selfInfo.userId;
    if (!profileId && selfInfo?.profiles?.length) {
      profileId = pickProfileId(selfInfo.profiles, settings.profileName);
    }
    if (!bidderId) return { success: false, error: 'bidder_id_unavailable', needsBrowser: false };

    const isHourly = (resolved.bidType || bidData.bidType) === 'hourly';
    const payload = {
      project_id: Number(numericId),
      bidder_id: Number(bidderId),
      description: String(bidData.proposal || '').slice(0, 1500),
      milestone_percentage: 100
    };
    if (profileId) payload.profile_id = Number(profileId);
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
      return { success: true, message: 'API入札完了', viaApi: true, numericProjectId: numericId };
    }

    const errMsg = data?.message || data?.error_code || `API bid failed (${status})`;
    const errStr = String(errMsg);
    if (/nda|sealed|document|sign|agreement|intellectual property|not_authenticated|login/i.test(errStr)) {
      return { success: false, needsBrowser: true, error: errMsg };
    }
    return { success: false, needsBrowser: false, error: errMsg };
  }

  global.FabFreelancerApi = {
    fetchProjectDetails,
    fetchSelfUserId,
    fetchSelfInfo,
    resolveProjectForBid,
    placeBidViaApi
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);

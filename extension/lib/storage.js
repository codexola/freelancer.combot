/**
 * 設定・入札履歴の永続化レイヤー
 * 開始/停止/保管/削除/変更の明示的指令があるまで常に現状を保管
 */

export const DEFAULT_SETTINGS = {
  isRunning: false,
  maxBidCount: 50,
  bidWindowMinSec: 0,
  bidWindowMaxSec: 600,
  bidExecutionGraceSec: 300,
  slowNetworkMode: false,
  skipUnknownCountry: true,
  preferApiBidding: true,
  freelancerOAuthToken: '',
  freelancerUserId: null,
  pollIntervalMs: 500,
  defaultBidAmount: 500,
  defaultDeliveryDays: 7,
  defaultHourlyRate: 25,
  profileName: 'General',
  fullName: '',
  fullAddress: '',
  freelancerProfileId: null,
  apiOnlyBidding: true,
  autoBidMethodSwitch: true,
  signatureStrokes: [],
  portfolioLinks: [],
  portfolioLinksText: '',
  claudeApiKey: '',
  openaiApiKey: '',
  preferredAiProvider: 'claude',
  proposalStyle: 'professional',
  proposalPrompt: '',
  proposalMinLength: 1000,
  proposalMaxLength: 1400,
  requireAiProposal: true,
  autoSignDocuments: true,
  skipNdaProjects: false,
  skipExcludedCategories: true,
  skillsFilter: [],
  minPriceUsd: 100,
  minBudget: 100,
  maxBudget: 10000,
  excludedCountries: [
    'india', 'pakistan',
    'algeria', 'angola', 'benin', 'botswana', 'burkina faso', 'burundi',
    'cameroon', 'cape verde', 'central african republic', 'chad', 'comoros',
    'congo', 'democratic republic of the congo', 'djibouti', 'egypt',
    'equatorial guinea', 'eritrea', 'eswatini', 'ethiopia', 'gabon',
    'gambia', 'ghana', 'guinea', 'guinea-bissau', 'ivory coast', "cote d'ivoire",
    'kenya', 'lesotho', 'liberia', 'libya', 'madagascar', 'malawi', 'mali',
    'mauritania', 'mauritius', 'morocco', 'mozambique', 'namibia', 'niger',
    'nigeria', 'rwanda', 'senegal', 'seychelles', 'sierra leone', 'somalia',
    'south africa', 'south sudan', 'sudan', 'tanzania', 'togo', 'tunisia',
    'uganda', 'zambia', 'zimbabwe'
  ],
  projectTypes: ['fixed', 'hourly'],
  languages: ['en', 'es', 'pt', 'zh'],
  lastUpdated: null
};

export const DEFAULT_STATS = {
  totalBids: 0,
  todayBids: 0,
  todayDate: '',
  successfulBids: 0,
  failedBids: 0,
  skippedBids: 0,
  lastBidAt: null,
  bidHistory: [],
  bidRecords: [],
  recentLogs: []
};

export async function getSettings() {
  const result = await chrome.storage.local.get(['settings']);
  return { ...DEFAULT_SETTINGS, ...result.settings };
}

export async function saveSettings(partial) {
  const current = await getSettings();
  const updated = {
    ...current,
    ...partial,
    lastUpdated: new Date().toISOString()
  };
  await chrome.storage.local.set({ settings: updated });
  chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED', settings: updated }).catch(() => {});
  return updated;
}

export async function getStats() {
  const result = await chrome.storage.local.get(['stats']);
  const stats = { ...DEFAULT_STATS, ...result.stats };
  const today = new Date().toDateString();
  if (stats.todayDate !== today) {
    stats.todayBids = 0;
    stats.todayDate = today;
    await chrome.storage.local.set({ stats });
  }
  return stats;
}

export async function saveStats(partial) {
  const current = await getStats();
  const updated = { ...current, ...partial };
  await chrome.storage.local.set({ stats: updated });
  chrome.runtime.sendMessage({ type: 'STATS_UPDATED', stats: updated }).catch(() => {});
  return updated;
}

export async function addBidLog(entry) {
  const stats = await getStats();
  const log = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    ...entry
  };
  stats.bidHistory.unshift(log);
  if (stats.bidHistory.length > 500) stats.bidHistory.pop();
  stats.recentLogs.unshift({
    time: log.timestamp,
    message: entry.message || entry.status,
    level: entry.level || 'info'
  });
  if (stats.recentLogs.length > 100) stats.recentLogs.pop();
  await saveStats(stats);
  return log;
}

export async function saveBidRecord(entry) {
  const stats = await getStats();
  const records = stats.bidRecords || [];
  const idx = records.findIndex((r) => r.projectId === entry.projectId && entry.projectId);
  const existing = idx >= 0 ? records[idx] : null;
  const record = {
    id: entry.id || existing?.id || crypto.randomUUID(),
    timestamp: existing?.timestamp || entry.timestamp || new Date().toISOString(),
    projectId: entry.projectId || '',
    title: entry.title || existing?.title || '',
    url: entry.url || existing?.url || '',
    proposal: entry.proposal || existing?.proposal || '',
    status: entry.status || existing?.status || 'attempted',
    message: entry.message ?? existing?.message ?? ''
  };
  if (idx >= 0) {
    records[idx] = record;
  } else {
    records.unshift(record);
  }
  if (records.length > 200) records.length = 200;
  stats.bidRecords = records;
  await saveStats(stats);
  return record;
}

export async function recordBidAttempt(result) {
  const stats = await getStats();
  const today = new Date().toDateString();
  if (stats.todayDate !== today) {
    stats.todayBids = 0;
    stats.todayDate = today;
  }
  if (!result.skipped) {
    stats.totalBids++;
    stats.todayBids++;
    stats.lastBidAt = new Date().toISOString();
    if (result.success) stats.successfulBids++;
    else stats.failedBids++;
  } else {
    stats.skippedBids++;
  }
  await saveStats(stats);
  if (result.proposal?.trim() || result.url) {
    await saveBidRecord({
      projectId: result.projectId,
      title: result.title,
      url: result.url,
      proposal: result.proposal || '',
      status: result.success ? 'success' : result.skipped ? 'skipped' : 'failed',
      message: result.message || ''
    });
  }
}

export async function deleteSettings() {
  await chrome.storage.local.set({
    settings: { ...DEFAULT_SETTINGS, lastUpdated: new Date().toISOString() }
  });
}

export async function deleteStats() {
  await chrome.storage.local.set({ stats: { ...DEFAULT_STATS } });
}

export async function getProcessedProjects() {
  const result = await chrome.storage.local.get(['processedProjects']);
  return result.processedProjects || {};
}

export async function markProjectProcessed(projectId, status) {
  const processed = await getProcessedProjects();
  processed[projectId] = { status, at: Date.now() };
  const keys = Object.keys(processed);
  if (keys.length > 1000) {
    const sorted = keys.sort((a, b) => processed[a].at - processed[b].at);
    sorted.slice(0, 200).forEach((k) => delete processed[k]);
  }
  await chrome.storage.local.set({ processedProjects: processed });
}

export async function isProjectInFlight(projectId) {
  const processed = await getProcessedProjects();
  const entry = processed[projectId];
  if (!entry) return false;
  const inFlight = ['queued', 'bidding'].includes(entry.status);
  if (!inFlight) return false;
  const staleMs = 5 * 60 * 1000;
  if (Date.now() - entry.at > staleMs) {
    return false;
  }
  return true;
}

export async function clearStaleQueuedProjects() {
  const processed = await getProcessedProjects();
  const staleMs = 5 * 60 * 1000;
  let changed = false;
  for (const [id, entry] of Object.entries(processed)) {
    if (['queued', 'bidding'].includes(entry.status) && Date.now() - entry.at > staleMs) {
      delete processed[id];
      changed = true;
    }
  }
  if (changed) {
    await chrome.storage.local.set({ processedProjects: processed });
  }
}

const FILTER_STATUS_KEY = 'filterStatus';
const MAX_FILTER_STATUS = 300;

function broadcastFilterStatus(filterStatus) {
  chrome.runtime.sendMessage({ type: 'FILTER_STATUS_UPDATED', filterStatus }).catch(() => {});
}

export async function getFilterStatus() {
  const result = await chrome.storage.local.get([FILTER_STATUS_KEY]);
  return result[FILTER_STATUS_KEY] || [];
}

export async function addFilterStatusEntry(entry) {
  const list = await getFilterStatus();
  const record = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    ...entry
  };
  list.unshift(record);
  if (list.length > MAX_FILTER_STATUS) list.length = MAX_FILTER_STATUS;
  await chrome.storage.local.set({ [FILTER_STATUS_KEY]: list });
  broadcastFilterStatus(list);
  return record;
}

export async function clearFilterStatus() {
  await chrome.storage.local.set({ [FILTER_STATUS_KEY]: [] });
  broadcastFilterStatus([]);
}

export async function deleteFilterStatusEntry(entryId) {
  const list = await getFilterStatus();
  const filtered = list.filter((entry) => entry.id !== entryId);
  await chrome.storage.local.set({ [FILTER_STATUS_KEY]: filtered });
  broadcastFilterStatus(filtered);
  return filtered;
}

const ARCHIVE_KEY = 'projectArchive';
const MAX_ARCHIVE_ENTRIES = 5000;

export async function getProjectArchive() {
  const result = await chrome.storage.local.get([ARCHIVE_KEY]);
  return result[ARCHIVE_KEY] || {};
}

export async function saveProjectArchiveEntry(projectId, entry) {
  const archive = await getProjectArchive();
  archive[projectId] = {
    ...archive[projectId],
    ...entry,
    projectId,
    updatedAt: Date.now()
  };

  const keys = Object.keys(archive);
  if (keys.length > MAX_ARCHIVE_ENTRIES) {
    const sorted = keys.sort((a, b) => (archive[a].updatedAt || 0) - (archive[b].updatedAt || 0));
    sorted.slice(0, keys.length - MAX_ARCHIVE_ENTRIES).forEach((k) => delete archive[k]);
  }

  await chrome.storage.local.set({ [ARCHIVE_KEY]: archive });
  return archive[projectId];
}

export async function isProjectArchived(projectId) {
  const archive = await getProjectArchive();
  return !!archive[projectId];
}

export async function getArchivedProjectIds() {
  return Object.keys(await getProjectArchive());
}

/**
 * 設定・入札履歴の永続化レイヤー
 * 開始/停止/保管/削除/変更の明示的指令があるまで常に現状を保管
 */

export const DEFAULT_SETTINGS = {
  isRunning: false,
  maxBidCount: 50,
  bidWindowMinSec: 3,
  bidWindowMaxSec: 10,
  pollIntervalMs: 2000,
  defaultBidAmount: 500,
  defaultDeliveryDays: 7,
  defaultHourlyRate: 25,
  profileName: 'General',
  fullName: '',
  fullAddress: '',
  signatureStrokes: [],
  portfolioLinks: [],
  portfolioLinksText: '',
  claudeApiKey: '',
  openaiApiKey: '',
  preferredAiProvider: 'claude',
  proposalStyle: 'professional',
  autoSignDocuments: true,
  skipNdaProjects: false,
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
  languages: ['en'],
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
  activeBids: [],
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

export async function recordBidAttempt(result) {
  const stats = await getStats();
  const today = new Date().toDateString();
  if (stats.todayDate !== today) {
    stats.todayBids = 0;
    stats.todayDate = today;
  }
  stats.totalBids++;
  stats.todayBids++;
  stats.lastBidAt = new Date().toISOString();
  if (result.success) stats.successfulBids++;
  else if (result.skipped) stats.skippedBids++;
  else stats.failedBids++;
  await saveStats(stats);
  await addBidLog(result);
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

/**
 * ダッシュボード UI
 * 開始/停止/保管/削除/変更 - リアルタイム永続化
 */

import {
  parsePortfolioLinksText,
  getPortfolioTextFromSettings
} from './portfolio-ui.js';

let currentSettings = {};
let currentStats = {};
let currentFilterStatus = [];
let autoSaveTimer = null;
let isDirty = false;

const FILTER_STATUS_LABELS = {
  system: 'SYSTEM',
  scan: 'SCAN',
  detected: 'DETECT',
  passed: 'PASS',
  queued: 'QUEUE',
  deferred: 'WAIT',
  bidding: 'BID',
  skipped: 'SKIP',
  success: 'OK',
  failed: 'FAIL',
  seeded: 'SEED',
  archived: 'ARCHIVE'
};

let renderedFilterIds = new Set();

const $ = (id) => document.getElementById(id);

function sendMessage(type, data = {}) {
  return chrome.runtime.sendMessage({ type, ...data });
}

async function loadAll() {
  currentSettings = await sendMessage('GET_SETTINGS');
  currentStats = await sendMessage('GET_STATS');
  currentFilterStatus = await sendMessage('GET_FILTER_STATUS');
  renderSettings();
  renderStats();
  renderFilterStatus(true);
  updateStatusBadge();
}

function renderSettings() {
  const fields = [
    'preferredAiProvider', 'claudeApiKey', 'openaiApiKey', 'proposalStyle',
    'defaultBidAmount', 'defaultDeliveryDays', 'defaultHourlyRate', 'profileName',
    'bidWindowMinSec', 'bidWindowMaxSec', 'maxBidCount',
    'fullName', 'fullAddress', 'minPriceUsd', 'maxBudget'
  ];
  fields.forEach((f) => {
    const el = $(f);
    if (el && currentSettings[f] !== undefined) el.value = currentSettings[f];
  });

  $('autoSignDocuments').checked = currentSettings.autoSignDocuments !== false;
  $('skipNdaProjects').checked = !!currentSettings.skipNdaProjects;
  $('skipExcludedCategories').checked = currentSettings.skipExcludedCategories !== false;
  $('excludedCategoriesInfo').value =
    'マーケティング, 成人コンテンツ, 仮想秘書 (採用・VA・パーソナルアシスタント)';
  $('typeFixed').checked = (currentSettings.projectTypes || ['fixed', 'hourly']).includes('fixed');
  $('typeHourly').checked = (currentSettings.projectTypes || ['fixed', 'hourly']).includes('hourly');

  const excluded = currentSettings.excludedCountries || [];
  $('excludedCountries').value = excluded.join(', ');

  renderPortfolio();
}

function renderPortfolio() {
  const textarea = $('portfolioLinksText');
  if (!textarea) return;
  textarea.value = getPortfolioTextFromSettings(currentSettings);
  updatePortfolioMeta();
}

function updatePortfolioMeta() {
  const meta = $('portfolioMeta');
  if (!meta) return;
  const text = $('portfolioLinksText')?.value || '';
  const count = parsePortfolioLinksText(text).length;
  meta.textContent = `${count} 件のリンクを検出`;
}

function collectSettings() {
  const projectTypes = [];
  if ($('typeFixed').checked) projectTypes.push('fixed');
  if ($('typeHourly').checked) projectTypes.push('hourly');

  const portfolioLinksText = $('portfolioLinksText')?.value || '';
  const portfolioLinks = parsePortfolioLinksText(portfolioLinksText);

  return {
    ...currentSettings,
    preferredAiProvider: $('preferredAiProvider').value,
    claudeApiKey: $('claudeApiKey').value,
    openaiApiKey: $('openaiApiKey').value,
    proposalStyle: $('proposalStyle').value,
    defaultBidAmount: parseFloat($('defaultBidAmount').value) || 500,
    defaultDeliveryDays: parseInt($('defaultDeliveryDays').value, 10) || 7,
    defaultHourlyRate: parseFloat($('defaultHourlyRate').value) || 25,
    profileName: $('profileName').value || 'General',
    bidWindowMinSec: parseInt($('bidWindowMinSec').value, 10) || 3,
    bidWindowMaxSec: parseInt($('bidWindowMaxSec').value, 10) || 10,
    maxBidCount: parseInt($('maxBidCount').value, 10) || 50,
    fullName: $('fullName').value,
    fullAddress: $('fullAddress').value,
    autoSignDocuments: $('autoSignDocuments').checked,
    skipNdaProjects: $('skipNdaProjects').checked,
    skipExcludedCategories: $('skipExcludedCategories').checked,
    minPriceUsd: parseFloat($('minPriceUsd').value) || 100,
    minBudget: parseFloat($('minPriceUsd').value) || 100,
    maxBudget: parseFloat($('maxBudget').value) || 10000,
    excludedCountries: (currentSettings.excludedCountries || []),
    projectTypes,
    portfolioLinksText,
    portfolioLinks
  };
}

function formatCmdTime(iso) {
  if (!iso) return '--:--:--';
  return new Date(iso).toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
}

function buildCmdLine(entry) {
  const tag = FILTER_STATUS_LABELS[entry.status] || (entry.status || 'INFO').toUpperCase();
  const time = formatCmdTime(entry.timestamp);
  const title = entry.title && entry.title !== 'SYSTEM' && entry.title !== 'SCAN'
    ? entry.title
    : '';
  const meta = [
    entry.bidCount != null ? `${entry.bidCount}bids` : '',
    entry.source ? `[${entry.source}]` : '',
    entry.reason || ''
  ].filter(Boolean).join(' ');
  const detail = entry.message || '';
  const titlePart = title ? `<span class="cmd-title">${escHtml(title)}</span> ` : '';
  const metaPart = meta ? `<span class="cmd-detail">${escHtml(meta)}</span>` : '';
  const detailPart = detail ? `<span class="cmd-detail">${title || meta ? '— ' : ''}${escHtml(detail)}</span>` : '';
  return `<span class="cmd-time">[${time}]</span> <span class="cmd-tag">[${escHtml(tag)}]</span>${titlePart}${metaPart}${detailPart}`;
}

function appendCmdEntry(body, entry) {
  const line = document.createElement('div');
  line.className = `cmd-line cmd-${escAttr(entry.status || entry.level || 'info')}`;
  line.dataset.entryId = entry.id || '';
  line.innerHTML = buildCmdLine(entry);
  body.appendChild(line);
}

function renderFilterStatus(forceRebuild = false) {
  const body = $('filterStatusList');
  if (!body) return;

  if (forceRebuild) {
    body.innerHTML = '';
    renderedFilterIds.clear();
  }

  if (!currentFilterStatus.length) {
    body.innerHTML = '<div class="cmd-line cmd-system"><span class="cmd-time">[--:--:--]</span> <span class="cmd-tag">[SYSTEM]</span><span class="cmd-detail">Waiting for bot activity. Click 開始 to start monitoring.</span><span class="cmd-cursor"></span></div>';
    renderedFilterIds.clear();
    return;
  }

  const pending = currentFilterStatus.filter((entry) => !renderedFilterIds.has(entry.id));
  for (const entry of pending.reverse()) {
    appendCmdEntry(body, entry);
    renderedFilterIds.add(entry.id);
  }

  let cursor = body.querySelector('.cmd-cursor-line');
  if (!cursor) {
    cursor = document.createElement('div');
    cursor.className = 'cmd-line cmd-system cmd-cursor-line';
    body.appendChild(cursor);
  }
  cursor.innerHTML = '<span class="cmd-cursor"></span>';
  body.scrollTop = body.scrollHeight;
}

function escAttr(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

function renderStats() {
  $('statTotalBids').textContent = currentStats.totalBids || 0;
  $('statTodayBids').textContent = currentStats.todayBids || 0;
  $('statSuccess').textContent = currentStats.successfulBids || 0;
  $('statFailed').textContent = currentStats.failedBids || 0;
  $('statSkipped').textContent = currentStats.skippedBids || 0;
  $('statLastBid').textContent = currentStats.lastBidAt
    ? new Date(currentStats.lastBidAt).toLocaleTimeString('ja-JP')
    : '-';

  const logList = $('logList');
  logList.innerHTML = '';
  (currentStats.recentLogs || []).forEach((log) => {
    const div = document.createElement('div');
    div.className = `log-item ${log.level || 'info'}`;
    div.innerHTML = `<span class="log-time">${formatTime(log.time)}</span> ${escHtml(log.message)}`;
    logList.appendChild(div);
  });

  const historyList = $('historyList');
  historyList.innerHTML = '';
  (currentStats.bidHistory || []).slice(0, 50).forEach((h) => {
    const div = document.createElement('div');
    div.className = 'history-item';
    const statusClass = h.success ? 'success' : h.skipped ? 'warn' : 'error';
    div.innerHTML = `
      <span class="history-time">${formatTime(h.timestamp)}</span>
      <div class="history-title">${escHtml(h.title || h.projectId || '-')}</div>
      <div class="history-status ${statusClass}">${escHtml(h.message || h.status || '')}</div>
    `;
    historyList.appendChild(div);
  });
}

function formatTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function escHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function updateStatusBadge() {
  const badge = $('statusBadge');
  if (currentSettings.isRunning) {
    badge.textContent = '稼働中';
    badge.className = 'status-badge running';
  } else {
    badge.textContent = '停止中';
    badge.className = 'status-badge stopped';
  }
}

function showSaveStatus(msg, isError = false) {
  const el = $('saveStatus');
  el.textContent = msg;
  el.style.color = isError ? 'var(--danger)' : 'var(--success)';
  setTimeout(() => { el.textContent = ''; }, 3000);
}

async function saveSettings(manual = false) {
  const settings = collectSettings();
  currentSettings = await sendMessage('SAVE_SETTINGS', { settings });
  isDirty = false;
  const msg = manual ? '設定を保管しました' : '自動保存しました';
  showSaveStatus(msg);
  updateStatusBadge();
}

function onSettingsChange() {
  isDirty = true;
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => saveSettings(false), 1500);
}

function setupTabs() {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
      tab.classList.add('active');
      $(`tab-${tab.dataset.tab}`).classList.add('active');
    });
  });
}

function setupEventListeners() {
  $('btnStart').addEventListener('click', async () => {
    if (isDirty) await saveSettings(true);
    await sendMessage('START_BOT');
    currentSettings.isRunning = true;
    updateStatusBadge();
    showSaveStatus('自動入札を開始しました');
  });

  $('btnStop').addEventListener('click', async () => {
    await sendMessage('STOP_BOT');
    currentSettings.isRunning = false;
    updateStatusBadge();
    showSaveStatus('自動入札を停止しました');
  });

  $('btnSave').addEventListener('click', () => saveSettings(true));
  $('btnChange').addEventListener('click', async () => {
    await saveSettings(true);
    showSaveStatus('変更を適用・保管しました');
  });

  $('btnDelete').addEventListener('click', async () => {
    if (!confirm('設定を初期値にリセットしますか？')) return;
    await sendMessage('DELETE_SETTINGS', { target: 'settings' });
    await loadAll();
    showSaveStatus('設定を削除（リセット）しました');
  });

  $('btnClearLogs').addEventListener('click', async () => {
    if (!confirm('ログと履歴をクリアしますか？')) return;
    await sendMessage('DELETE_SETTINGS', { target: 'stats' });
    await loadAll();
    showSaveStatus('ログをクリアしました');
  });

  $('btnClearFilterStatus').addEventListener('click', async () => {
    if (!confirm('フィルタリングコンソールをクリアしますか？')) return;
    await sendMessage('CLEAR_FILTER_STATUS');
    currentFilterStatus = [];
    renderFilterStatus(true);
    showSaveStatus('フィルタリングコンソールをクリアしました');
  });

  $('portfolioLinksText')?.addEventListener('input', () => {
    updatePortfolioMeta();
    onSettingsChange();
  });

  const watchFields = document.querySelectorAll(
    'input, select, textarea, #autoSignDocuments, #skipNdaProjects, #typeFixed, #typeHourly'
  );
  watchFields.forEach((el) => {
    el.addEventListener('input', onSettingsChange);
    el.addEventListener('change', onSettingsChange);
  });
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'SETTINGS_UPDATED') {
    currentSettings = msg.settings;
    updateStatusBadge();
  }
  if (msg.type === 'STATS_UPDATED') {
    currentStats = msg.stats;
    renderStats();
  }
  if (msg.type === 'FILTER_STATUS_UPDATED') {
    currentFilterStatus = msg.filterStatus || [];
    renderFilterStatus(false);
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.filterStatus) {
    currentFilterStatus = changes.filterStatus.newValue || [];
    renderFilterStatus(false);
  }
  if (changes.stats) {
    currentStats = { ...currentStats, ...changes.stats.newValue };
    renderStats();
  }
  if (changes.settings) {
    currentSettings = { ...currentSettings, ...changes.settings.newValue };
    updateStatusBadge();
  }
});

document.addEventListener('DOMContentLoaded', async () => {
  setupTabs();
  setupEventListeners();
  await loadAll();
});

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
    'proposalPrompt', 'proposalMinLength', 'proposalMaxLength',
    'defaultBidAmount', 'defaultDeliveryDays', 'defaultHourlyRate', 'profileName',
    'bidWindowMinSec', 'bidWindowMaxSec', 'bidExecutionGraceSec', 'maxBidCount',
    'freelancerOAuthToken',
    'fullName', 'fullAddress', 'minPriceUsd', 'maxBudget', 'languages'
  ];
  fields.forEach((f) => {
    const el = $(f);
    if (el && currentSettings[f] !== undefined) el.value = currentSettings[f];
  });

  $('autoSignDocuments').checked = currentSettings.autoSignDocuments !== false;
  $('skipNdaProjects').checked = !!currentSettings.skipNdaProjects;
  $('skipExcludedCategories').checked = currentSettings.skipExcludedCategories !== false;
  $('slowNetworkMode').checked = currentSettings.slowNetworkMode !== false;
  $('preferApiBidding').checked = currentSettings.preferApiBidding !== false;
  if ($('apiOnlyBidding')) {
    $('apiOnlyBidding').checked = currentSettings.apiOnlyBidding !== false;
  }
  $('skipUnknownCountry').checked = currentSettings.skipUnknownCountry !== false;
  $('excludedCategoriesInfo').value =
    'マーケティング, 成人コンテンツ, 仮想秘書 (採用・VA・パーソナルアシスタント)';
  $('typeFixed').checked = (currentSettings.projectTypes || ['fixed', 'hourly']).includes('fixed');
  $('typeHourly').checked = (currentSettings.projectTypes || ['fixed', 'hourly']).includes('hourly');

  const excluded = currentSettings.excludedCountries || [];
  $('excludedCountries').value = excluded.join(', ');
  if ($('languages')) {
    $('languages').value = (currentSettings.languages || ['en', 'es', 'pt', 'zh']).join(', ');
  }

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

function parseListField(text) {
  if (!text?.trim()) return [];
  return text
    .split(/[,;\n]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function parseExcludedCountries(text) {
  return parseListField(text);
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
    proposalPrompt: $('proposalPrompt')?.value || '',
    proposalMinLength: parseInt($('proposalMinLength')?.value, 10) || 1000,
    proposalMaxLength: parseInt($('proposalMaxLength')?.value, 10) || 1400,
    requireAiProposal: true,
    defaultBidAmount: parseFloat($('defaultBidAmount').value) || 500,
    defaultDeliveryDays: parseInt($('defaultDeliveryDays').value, 10) || 7,
    defaultHourlyRate: parseFloat($('defaultHourlyRate').value) || 25,
    profileName: $('profileName').value || 'General',
    bidWindowMinSec: parseInt($('bidWindowMinSec').value, 10) || 3,
    bidWindowMaxSec: parseInt($('bidWindowMaxSec').value, 10) || 300,
    bidExecutionGraceSec: parseInt($('bidExecutionGraceSec').value, 10) || 180,
    maxBidCount: parseInt($('maxBidCount').value, 10) || 50,
    slowNetworkMode: $('slowNetworkMode').checked,
    preferApiBidding: $('preferApiBidding').checked,
    apiOnlyBidding: $('apiOnlyBidding')?.checked !== false,
    skipUnknownCountry: $('skipUnknownCountry').checked,
    freelancerOAuthToken: $('freelancerOAuthToken').value,
    fullName: $('fullName').value,
    fullAddress: $('fullAddress').value,
    autoSignDocuments: $('autoSignDocuments').checked,
    skipNdaProjects: $('skipNdaProjects').checked,
    skipExcludedCategories: $('skipExcludedCategories').checked,
    minPriceUsd: parseFloat($('minPriceUsd').value) || 100,
    minBudget: parseFloat($('minPriceUsd').value) || 100,
    maxBudget: parseFloat($('maxBudget').value) || 10000,
    excludedCountries: parseExcludedCountries($('excludedCountries').value),
    languages: parseListField($('languages')?.value || ''),
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
    body.innerHTML = '<div class="cmd-line cmd-system"><span class="cmd-time">[--:--:--]</span> <span class="cmd-tag">[SYSTEM]</span><span class="cmd-detail">Octo Browser プロファイルで 開始 を押してください。Storages で Extensions / Local Storage / Service workers を有効にしてください。</span><span class="cmd-cursor"></span></div>';
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

  renderBidRecords();
}

function renderBidRecords() {
  const logList = $('logList');
  if (!logList) return;
  logList.innerHTML = '';

  const records = (currentStats.bidRecords || []).filter((r) => r.proposal?.trim());
  if (!records.length) {
    logList.innerHTML = '<div class="log-item info">入札を試行したプロジェクトはまだありません。</div>';
    return;
  }

  records.slice(0, 100).forEach((record) => {
    const div = document.createElement('div');
    div.className = 'bid-record-item';
    div.dataset.recordId = record.id || '';
    const status = record.status || 'attempted';
    const statusLabel =
      status === 'success' ? '成功' : status === 'failed' ? '失敗' : status === 'in_progress' ? '処理中' : '試行';
    div.innerHTML = `
      <div class="bid-record-title">${escHtml(record.title || record.projectId || 'プロジェクト')}</div>
      <div class="bid-record-meta">
        <span class="bid-record-time">${formatTime(record.timestamp)}</span>
        <span class="bid-record-status ${escAttr(status)}">${escHtml(statusLabel)}</span>
        <span>${record.proposal.length}文字</span>
      </div>
    `;
    div.addEventListener('click', () => openProposalModal(record));
    logList.appendChild(div);
  });
}

function openProposalModal(record) {
  const modal = $('proposalModal');
  if (!modal) return;
  $('modalTitle').textContent = record.title || '入札文';
  $('modalMeta').textContent = [
    formatTime(record.timestamp),
    record.status === 'success' ? '入札成功' : record.status === 'failed' ? '入札失敗' : '入札試行',
    `${(record.proposal || '').length}文字`
  ].filter(Boolean).join(' · ');
  $('modalProposal').textContent = record.proposal || '';
  const link = $('modalLink');
  if (record.url) {
    link.href = record.url;
    link.classList.remove('hidden');
  } else {
    link.href = '#';
    link.classList.add('hidden');
  }
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
}

function closeProposalModal() {
  const modal = $('proposalModal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
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
    if (!confirm('入札ログをクリアしますか？')) return;
    await sendMessage('DELETE_SETTINGS', { target: 'stats' });
    await loadAll();
    showSaveStatus('入札ログをクリアしました');
  });

  $('modalClose')?.addEventListener('click', closeProposalModal);
  $('proposalModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'proposalModal') closeProposalModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeProposalModal();
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
    'input, select, textarea, #autoSignDocuments, #skipNdaProjects, #slowNetworkMode, #preferApiBidding, #apiOnlyBidding, #skipUnknownCountry, #typeFixed, #typeHourly'
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

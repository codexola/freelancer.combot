/**
 * ダッシュボード UI
 * 開始/停止/保管/削除/変更 - リアルタイム永続化
 */

let currentSettings = {};
let currentStats = {};
let autoSaveTimer = null;
let isDirty = false;

const $ = (id) => document.getElementById(id);

function sendMessage(type, data = {}) {
  return chrome.runtime.sendMessage({ type, ...data });
}

async function loadAll() {
  currentSettings = await sendMessage('GET_SETTINGS');
  currentStats = await sendMessage('GET_STATS');
  renderSettings();
  renderStats();
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
  $('typeFixed').checked = (currentSettings.projectTypes || ['fixed', 'hourly']).includes('fixed');
  $('typeHourly').checked = (currentSettings.projectTypes || ['fixed', 'hourly']).includes('hourly');

  const excluded = currentSettings.excludedCountries || [];
  $('excludedCountries').value = excluded.join(', ');

  renderPortfolio();
}

function renderPortfolio() {
  const list = $('portfolioList');
  list.innerHTML = '';
  (currentSettings.portfolioLinks || []).forEach((item, i) => {
    const div = document.createElement('div');
    div.className = 'portfolio-item';
    div.innerHTML = `
      <input type="text" data-field="title" data-idx="${i}" value="${esc(item.title || '')}" placeholder="タイトル">
      <input type="url" data-field="url" data-idx="${i}" value="${esc(item.url || '')}" placeholder="https://...">
      <input type="text" data-field="description" data-idx="${i}" value="${esc(item.description || '')}" placeholder="説明">
      <input type="text" data-field="tags" data-idx="${i}" value="${esc((item.tags || []).join(', '))}" placeholder="タグ (カンマ区切り: react, seo, wordpress)">
      <button class="remove-btn" data-remove="${i}">削除</button>
    `;
    list.appendChild(div);
  });

  list.querySelectorAll('input').forEach((input) => {
    input.addEventListener('input', onSettingsChange);
  });
  list.querySelectorAll('.remove-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentSettings.portfolioLinks.splice(parseInt(btn.dataset.remove), 1);
      onSettingsChange();
      renderPortfolio();
    });
  });
}

function esc(str) {
  return str.replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function collectSettings() {
  const projectTypes = [];
  if ($('typeFixed').checked) projectTypes.push('fixed');
  if ($('typeHourly').checked) projectTypes.push('hourly');

  const portfolioLinks = [];
  document.querySelectorAll('.portfolio-item').forEach((item) => {
    const title = item.querySelector('[data-field="title"]')?.value || '';
    const url = item.querySelector('[data-field="url"]')?.value || '';
    const description = item.querySelector('[data-field="description"]')?.value || '';
    const tags = (item.querySelector('[data-field="tags"]')?.value || '').split(',').map((t) => t.trim()).filter(Boolean);
    if (url) portfolioLinks.push({ title, url, description, tags });
  });

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
    minPriceUsd: parseFloat($('minPriceUsd').value) || 100,
    minBudget: parseFloat($('minPriceUsd').value) || 100,
    maxBudget: parseFloat($('maxBudget').value) || 10000,
    excludedCountries: (currentSettings.excludedCountries || []),
    projectTypes,
    portfolioLinks
  };
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

  $('btnAddPortfolio').addEventListener('click', () => {
    if (!currentSettings.portfolioLinks) currentSettings.portfolioLinks = [];
    currentSettings.portfolioLinks.push({ title: '', url: '', description: '', tags: [] });
    renderPortfolio();
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
});

document.addEventListener('DOMContentLoaded', async () => {
  setupTabs();
  setupEventListeners();
  await loadAll();
  setInterval(async () => {
    currentStats = await sendMessage('GET_STATS');
    renderStats();
  }, 5000);
});

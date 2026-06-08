/**
 * バックグラウンドオーケストレーション
 * プロジェクト検出 → フィルタ → 入札実行のフロー管理
 */

import {
  getSettings,
  saveSettings,
  getStats,
  recordBidAttempt,
  markProjectProcessed,
  getProcessedProjects,
  isProjectInFlight,
  clearStaleQueuedProjects,
  addBidLog,
  addFilterStatusEntry,
  getFilterStatus,
  clearFilterStatus,
  deleteFilterStatusEntry,
  deleteSettings,
  deleteStats,
  isProjectArchived,
  saveProjectArchiveEntry,
  getArchivedProjectIds
} from '../lib/storage.js';
import { generateProposal, analyzeProblem } from '../lib/api-clients.js';
import { solveProblem } from '../lib/problem-solver.js';
import {
  evaluateProjectFilters,
  evaluateAgeWindow,
  evaluateExecutionDeadline,
  detectProjectLanguage,
  analyzeProjectRequirements
} from '../lib/filters.js';
import {
  finalizeProposal,
  getPortfolioLinks,
  selectRelevantLinks,
  MAX_PROPOSAL_LENGTH
} from '../lib/portfolio.js';
import {
  normalizeDetailsUrl,
  compareProjectsByNewest
} from '../lib/project-url.js';

const PROJECTS_URL = 'https://www.freelancer.com/search/projects?projectSort=latest';
const PROJECTS_URL_ALT = 'https://www.freelancer.com/search/projects';
// Octo Browser profiles start slower than desktop Chrome — use longer readiness timeouts.
const OCTO_TAB_LOAD_MS = 30000;
const OCTO_CONTENT_SCRIPT_MS = 20000;
let monitorTabId = null;
const bidQueue = [];
let isProcessingBid = false;
const pendingYoungProjects = new Map();
let pendingRetryTimer = null;
let lastScanLog = { at: 0, signature: '' };
const MONITOR_SCRIPT_FILES = [
  'lib/project-url-content.js',
  'lib/freelancer-api-content.js',
  'lib/freelancer-session-content.js',
  'content/projects-monitor.js'
];
const BID_SCRIPT_FILES = ['content/document-signer.js', 'content/bid-handler.js'];
let bidWorkerTabId = null;

async function injectMonitorScripts(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: MONITOR_SCRIPT_FILES
  });
}

async function ensureBidContentScript(tabId, timeout) {
  let ready = await waitForContentScript(tabId, timeout);
  if (ready) return true;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: BID_SCRIPT_FILES });
  } catch {
    return false;
  }
  return waitForContentScript(tabId, timeout);
}

async function ensureContentScript(tabId) {
  let ready = await waitForContentScript(tabId, 12000);
  if (ready) return true;

  await addFilterStatusEntry({
    status: 'system',
    level: 'warn',
    title: 'SYSTEM',
    message: 'Monitor script not responding — injecting...'
  });

  try {
    await injectMonitorScripts(tabId);
  } catch (err) {
    await addFilterStatusEntry({
      status: 'failed',
      level: 'error',
      title: 'SYSTEM',
      message: `Script injection failed: ${err.message}`
    });
    return false;
  }

  ready = await waitForContentScript(tabId, OCTO_CONTENT_SCRIPT_MS);
  if (!ready) {
    await addFilterStatusEntry({
      status: 'failed',
      level: 'error',
      title: 'SYSTEM',
      message:
        'Monitor script failed to start. In Octo profile settings enable Storages: Extensions, Local Storage, Service workers — then reload the extension.'
    });
  }
  return ready;
}

async function startMonitoringOnTab(tabId) {
  const ready = await ensureContentScript(tabId);
  if (!ready) return false;

  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: 'START_MONITORING' });
    if (!res?.ok) {
      await addFilterStatusEntry({
        status: 'failed',
        level: 'error',
        title: 'SYSTEM',
        message: 'START_MONITORING returned unexpected response'
      });
      return false;
    }
    await addFilterStatusEntry({
      status: 'system',
      level: 'info',
      title: 'SYSTEM',
      message: 'Monitor active — scanning projects'
    });
    await chrome.tabs.sendMessage(tabId, { type: 'SCAN_PROJECTS' }).catch(() => {});
    return true;
  } catch (err) {
    await addFilterStatusEntry({
      status: 'failed',
      level: 'error',
      title: 'SYSTEM',
      message: `START_MONITORING failed: ${err.message}`
    });
    return false;
  }
}

async function ensureMonitorTab() {
  const tabs = await chrome.tabs.query({ url: 'https://www.freelancer.com/search/projects*' });
  if (tabs.length > 0) {
    monitorTabId = tabs[0].id;
    const tab = await chrome.tabs.get(monitorTabId);
    const onSearchPage =
      tab.url?.includes('freelancer.com/search/projects') &&
      (tab.url?.includes('projectSort=latest') || tab.url === PROJECTS_URL_ALT || tab.url === `${PROJECTS_URL_ALT}/`);
    if (!onSearchPage) {
      await chrome.tabs.update(monitorTabId, { url: PROJECTS_URL });
      await waitForTabLoad(monitorTabId);
    }
    await ensureContentScript(monitorTabId);
    return monitorTabId;
  }
  const tab = await chrome.tabs.create({ url: PROJECTS_URL, active: false });
  monitorTabId = tab.id;
  await waitForTabLoad(tab.id);
  await ensureContentScript(tab.id);
  return tab.id;
}

function waitForTabLoad(tabId, timeout = OCTO_TAB_LOAD_MS) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(), timeout);
    const listener = (id, info) => {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function syncFreelancerSession(tabId) {
  const res = await chrome.tabs.sendMessage(tabId, { type: 'GET_FREELANCER_SESSION' }).catch(() => null);
  if (!res?.session) return null;

  const { userId, viewedNumericIds, searchFilters } = res.session;
  const settingsPatch = {};

  if (userId) {
    settingsPatch.freelancerUserId = Number(userId);
  }
  if (searchFilters?.projectLanguages?.length) {
    settingsPatch.languages = searchFilters.projectLanguages;
  }
  if (searchFilters?.projectTypes?.length) {
    settingsPatch.projectTypes = searchFilters.projectTypes;
  }

  if (Object.keys(settingsPatch).length) {
    await saveSettings(settingsPatch);
  }

  let seeded = 0;
  for (const numericId of viewedNumericIds || []) {
    await saveProjectArchiveEntry(String(numericId), {
      title: `viewed-${numericId}`,
      status: 'viewed_freelancer',
      numericProjectId: Number(numericId),
      source: 'freelancer_localStorage'
    });
    await markProjectProcessed(String(numericId), 'viewed_freelancer');
    seeded++;
  }

  if (userId || seeded) {
    await addFilterStatusEntry({
      status: 'system',
      level: 'info',
      title: 'SESSION',
      message: `Freelancer session: user ${userId || '?'} | viewed ${seeded} projects | langs ${(searchFilters?.projectLanguages || []).join(',') || '-'}`
    });
  }

  return res.session;
}

async function startBot() {
  await saveSettings({ isRunning: true });
  await addFilterStatusEntry({
    status: 'system',
    level: 'info',
    message: `Bot started (Octo profile) — monitoring ${PROJECTS_URL}`,
    title: 'SYSTEM'
  });
  const tabId = await ensureMonitorTab();
  await syncFreelancerSession(tabId);
  await startMonitoringOnTab(tabId);
  await addBidLog({ level: 'info', message: '自動入札を開始しました', status: 'started' });
  chrome.alarms.create('poll_projects', { periodInMinutes: 1 });
}

async function stopBot() {
  await saveSettings({ isRunning: false });
  chrome.alarms.clear('poll_projects');
  if (monitorTabId) {
    chrome.tabs.sendMessage(monitorTabId, { type: 'STOP_MONITORING' }).catch(() => {});
  }
  await addBidLog({ level: 'info', message: '自動入札を停止しました', status: 'stopped' });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function recordFilterStatus(project, status, details = {}) {
  const levelMap = {
    system: 'info',
    scan: 'info',
    detected: 'info',
    passed: 'info',
    queued: 'info',
    deferred: 'info',
    bidding: 'info',
    skipped: 'warn',
    success: 'success',
    failed: 'error'
  };
  await addFilterStatusEntry({
    projectId: project.projectId,
    title: project.title || project.projectId,
    url: project.url,
    bidCount: project.bidCount,
    status,
    reason: details.reason || '',
    message: details.message || details.reason || status,
    level: details.level || levelMap[status] || 'info',
    source: project.source || 'monitor'
  });
}

async function waitForContentScript(tabId, timeout = OCTO_CONTENT_SCRIPT_MS) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const res = await chrome.tabs.sendMessage(tabId, { type: 'PING' }).catch(() => null);
    if (res?.ok) return true;
    await sleep(400);
  }
  return false;
}

function normalizeProject(project) {
  const url = normalizeDetailsUrl(project.url || '');
  return {
    ...project,
    url: url || project.url,
    isNewDetection: project.isNewDetection !== false
  };
}

async function enrichProjectViaMonitor(project) {
  if (!monitorTabId) return project;
  const res = await chrome.tabs.sendMessage(monitorTabId, { type: 'ENRICH_PROJECT', project }).catch(() => null);
  return res?.project ? { ...project, ...res.project } : project;
}

async function tryApiBidViaMonitor(project, bidData, settings) {
  if (!monitorTabId || settings.preferApiBidding === false) {
    return { success: false, error: 'api_disabled' };
  }
  return chrome.tabs.sendMessage(monitorTabId, {
    type: 'API_PLACE_BID',
    project,
    bidData,
    settings
  }).catch(() => ({ success: false, error: 'api_message_failed' }));
}

async function skipProject(project, reason, message, settings) {
  await markProjectProcessed(project.projectId, reason);
  await archiveProjectResult(project, reason, { reason, message });
  await recordFilterStatus(project, 'skipped', { reason, message, level: 'warn' });
  await recordBidAttempt({
    success: false,
    skipped: true,
    projectId: project.projectId,
    title: project.title,
    message: message || reason,
    level: 'warn'
  });
}

async function filterProject(project, settings) {
  const processed = await getProcessedProjects();
  const existing = processed[project.projectId];
  if (existing && !['queued', 'bidding', 'deferred'].includes(existing.status)) {
    return { pass: false, reason: 'already_processed' };
  }
  if (await isProjectInFlight(project.projectId)) {
    return { pass: false, reason: 'already_queued' };
  }

  if (project.bidCount != null && project.bidCount >= settings.maxBidCount) {
    return { pass: false, reason: `bid_count_${project.bidCount}` };
  }

  const ageResult = evaluateAgeWindow(project, settings);
  if (!ageResult.pass) {
    return {
      pass: false,
      reason: ageResult.reason,
      message: ageResult.message,
      defer: ageResult.defer,
      retryInMs: ageResult.retryInMs
    };
  }

  if (settings.skipNdaProjects && project.isNda) {
    return { pass: false, reason: 'nda_project' };
  }

  const requirementAnalysis = analyzeProjectRequirements(project);
  const filterResult = evaluateProjectFilters(project, settings);
  if (!filterResult.pass) {
    return {
      pass: false,
      reason: filterResult.reason,
      message: filterResult.message,
      skipped: true,
      requirementAnalysis: filterResult.requirementAnalysis || requirementAnalysis
    };
  }

  return { pass: true, requirementAnalysis: filterResult.requirementAnalysis || requirementAnalysis };
}

function scheduleYoungProjectRetry(project, settings, retryInMs) {
  const retryAt = Date.now() + retryInMs;
  pendingYoungProjects.set(project.projectId, { project, settings, retryAt });
  schedulePendingRetries();
}

function schedulePendingRetries() {
  if (pendingRetryTimer || pendingYoungProjects.size === 0) return;

  const nextRetryAt = Math.min(...Array.from(pendingYoungProjects.values()).map((v) => v.retryAt));
  const delay = Math.max(200, nextRetryAt - Date.now());

  pendingRetryTimer = setTimeout(async () => {
    pendingRetryTimer = null;
    const now = Date.now();
    const ready = [];

    for (const [projectId, item] of pendingYoungProjects) {
      if (now >= item.retryAt) {
        pendingYoungProjects.delete(projectId);
        ready.push(item);
      }
    }

    for (const item of ready) {
      await markProjectProcessed(item.project.projectId, 'deferred');
      await processProjectThroughPipeline(item.project, item.settings, { isNew: false });
    }

    await processBidQueue();
    schedulePendingRetries();
  }, delay);
}

async function enqueueProject(project, settings) {
  if (await isProjectInFlight(project.projectId)) return false;

  const graceSec = settings.bidExecutionGraceSec ?? 180;
  const enriched = {
    ...project,
    bidDeadlineAt: Date.now() + graceSec * 1000,
    eligibleUntil: Date.now() + graceSec * 1000
  };

  await markProjectProcessed(project.projectId, 'queued');
  bidQueue.push({ project: enriched, settings });
  bidQueue.sort((a, b) => compareProjectsByNewest(a.project, b.project));
  await recordFilterStatus(project, 'queued', {
    message: `入札キューに追加 (${project.bidCount ?? '?'} bids) — ${project.url}`
  });
  await saveProjectArchiveEntry(project.projectId, {
    title: project.title,
    url: project.url,
    status: 'queued',
    bidCount: project.bidCount
  });
  await addBidLog({
    level: 'info',
    message: `新規プロジェクト検出: ${project.title} (${project.bidCount ?? '?'} bids)`,
    projectId: project.projectId
  });
  return true;
}

async function archiveProjectResult(project, status, details = {}) {
  await saveProjectArchiveEntry(project.projectId, {
    title: project.title,
    url: project.url,
    status,
    bidCount: project.bidCount,
    reason: details.reason || '',
    message: details.message || status,
    source: project.source || 'monitor'
  });
}

async function processProjectThroughPipeline(project, settings, { isNew = true } = {}) {
  const normalized = normalizeProject({ ...project, isNewDetection: isNew });
  const reqPreview = analyzeProjectRequirements(normalized);

  if (isNew) {
    await recordFilterStatus(normalized, 'detected', {
      message: `新規検出 [${normalized.source || 'monitor'}] ${normalized.budget || 'budget?'} / ${normalized.bidCount ?? '?'} bids — ${reqPreview.summary}`
    });
  }

  let candidate = normalized;
  const needsEnrichment =
    !candidate.clientCountry ||
    !candidate.description ||
    !candidate.numericProjectId ||
    settings.skipUnknownCountry !== false;
  if (needsEnrichment) {
    candidate = await enrichProjectViaMonitor(candidate);
  }

  const { pass, reason, message, defer, retryInMs, requirementAnalysis } = await filterProject(
    candidate,
    settings
  );
  const reqMsg = requirementAnalysis?.summary || reqPreview.summary;
  let archiveStatus = reason || 'skipped';

  if (pass) {
    archiveStatus = 'passed';
    await recordFilterStatus(candidate, 'passed', {
      message: `フィルター通過 — ${reqMsg}${candidate.clientCountry ? ` / ${candidate.clientCountry}` : ''}`
    });
    await archiveProjectResult(candidate, archiveStatus, { message: reqMsg });
    await enqueueProject(candidate, settings);
  } else if (defer && retryInMs) {
    archiveStatus = 'deferred';
    await markProjectProcessed(candidate.projectId, 'deferred');
    await recordFilterStatus(candidate, 'deferred', { reason, message: `${message} — ${reqMsg}` });
    await archiveProjectResult(candidate, archiveStatus, { reason, message });
    scheduleYoungProjectRetry(candidate, settings, retryInMs);
  } else {
    const quiet = reason === 'already_processed' || reason === 'already_queued';
    if (!quiet || isNew) {
      await recordFilterStatus(normalized, 'skipped', {
        reason,
        message: message || reason || 'filtered out',
        level: quiet ? 'info' : 'warn'
      });
    }
    await archiveProjectResult(normalized, archiveStatus, { reason, message: message || reason });
    if (!quiet) {
      await markProjectProcessed(normalized.projectId, reason);
    }
  }

  return { pass, reason };
}

async function handleDetectedProjects(projects, { seedBaseline = false } = {}) {
  const settings = await getSettings();
  if (!settings.isRunning) return { ok: false, reason: 'not_running' };

  await clearStaleQueuedProjects();

  const sorted = [...projects]
    .map((p) => normalizeProject(p))
    .sort(compareProjectsByNewest);

  if (seedBaseline) {
    for (const project of sorted) {
      await saveProjectArchiveEntry(project.projectId, {
        title: project.title,
        url: project.url,
        status: 'seeded',
        bidCount: project.bidCount,
        source: project.source || 'monitor'
      });
      await markProjectProcessed(project.projectId, 'seeded');
    }
    await addFilterStatusEntry({
      status: 'scan',
      level: 'info',
      title: 'ARCHIVE',
      message: `Baseline seeded: ${sorted.length} projects archived`
    });
    return { ok: true, seeded: sorted.length };
  }

  let queued = 0;
  for (const project of sorted) {
    const archived =
      (await isProjectArchived(project.projectId)) ||
      (project.numericProjectId != null &&
        (await isProjectArchived(String(project.numericProjectId))));
    if (archived) continue;

    const result = await processProjectThroughPipeline(project, settings, { isNew: true });
    if (result.pass) queued++;
  }

  void processBidQueue();
  return { ok: true, queued: bidQueue.length, processed: sorted.length };
}

async function processBidQueue() {
  if (isProcessingBid || bidQueue.length === 0) return;
  isProcessingBid = true;

  while (bidQueue.length > 0) {
    const item = bidQueue.shift();
    await executeBidFlow(item.project, item.settings);
  }

  isProcessingBid = false;
}

async function ensureBidWorkerTab(bidUrl) {
  const loadTimeout = settingsSlowMs();
  if (bidWorkerTabId) {
    try {
      const tab = await chrome.tabs.get(bidWorkerTabId);
      if (tab?.id) {
        await chrome.tabs.update(bidWorkerTabId, { url: bidUrl, active: false });
        await waitForTabLoad(bidWorkerTabId, loadTimeout);
        return bidWorkerTabId;
      }
    } catch {
      bidWorkerTabId = null;
    }
  }
  const tab = await chrome.tabs.create({ url: bidUrl, active: false });
  bidWorkerTabId = tab.id;
  await waitForTabLoad(tab.id, loadTimeout);
  return tab.id;
}

function settingsSlowMs() {
  return 45000;
}

async function executeBidFlow(project, settings) {
  const startTime = Date.now();
  let tabId = null;
  const slowMode = settings.slowNetworkMode !== false;

  try {
    const deadlineCheck = evaluateExecutionDeadline(project, settings);
    if (!deadlineCheck.pass) {
      await skipProject(project, deadlineCheck.reason, deadlineCheck.message, settings);
      return;
    }

    await markProjectProcessed(project.projectId, 'bidding');
    await recordFilterStatus(project, 'bidding', { message: '入札処理中（API優先）' });

    let projectData = await enrichProjectViaMonitor(project);
    const preFilter = evaluateProjectFilters(projectData, settings);
    if (!preFilter.pass) {
      await skipProject(
        project,
        preFilter.reason,
        preFilter.message || preFilter.reason,
        settings
      );
      return;
    }

    if (projectData.bidCount != null && projectData.bidCount >= settings.maxBidCount) {
      await skipProject(
        project,
        'skipped_bid_count',
        `入札者数 ${projectData.bidCount} >= ${settings.maxBidCount}`,
        settings
      );
      return;
    }

    let proposal = '';
    try {
      proposal = await generateProposal(settings, projectData);
      await addBidLog({
        level: 'info',
        message: `AI入札文生成完了 (${proposal.length}文字)`,
        projectId: project.projectId
      });
    } catch (apiErr) {
      if (settings.requireAiProposal !== false) {
        await skipProject(project, 'proposal_generation_failed', `AI入札文生成失敗: ${apiErr.message}`, settings);
        return;
      }
      proposal = buildFallbackProposal(projectData, settings);
      await addBidLog({
        level: 'warn',
        message: `AI入札文生成失敗、フォールバック使用: ${apiErr.message}`,
        projectId: project.projectId
      });
    }

    const bidData = {
      proposal,
      bidAmount: settings.defaultBidAmount,
      hourlyRate: settings.defaultHourlyRate,
      deliveryDays: settings.defaultDeliveryDays,
      bidType: projectData.bidType
    };

    let result = null;
    if (settings.preferApiBidding !== false) {
      result = await tryApiBidViaMonitor(projectData, bidData, settings);
    } else {
      result = { success: false, error: 'api_disabled' };
    }

    if (!result?.success) {
      const bidUrl = normalizeDetailsUrl(projectData.url || project.url);
      tabId = await ensureBidWorkerTab(bidUrl);

      const scriptTimeout = slowMode ? 50000 : OCTO_CONTENT_SCRIPT_MS;
      const scriptReady = await ensureBidContentScript(tabId, scriptTimeout);
      if (!scriptReady) {
        await recordFilterStatus(project, 'failed', {
          reason: 'content_script_timeout',
          message: 'ページ読込が遅いため入札フォームに接続できませんでした'
        });
        await recordBidAttempt({
          success: false,
          projectId: project.projectId,
          title: project.title,
          message: 'content script通信失敗（タイムアウト）',
          level: 'error'
        });
        await markProjectProcessed(project.projectId, 'failed');
        return;
      }

      const pageDataRes = await chrome.tabs.sendMessage(tabId, { type: 'GET_PROJECT_DATA' }).catch(() => null);
      projectData = { ...projectData, ...(pageDataRes || {}) };

      const pageFilter = evaluateProjectFilters(projectData, settings);
      if (!pageFilter.pass) {
        await skipProject(
          project,
          pageFilter.reason,
          pageFilter.message || pageFilter.reason,
          settings
        );
        return;
      }

      result = await chrome.tabs.sendMessage(tabId, {
        type: 'EXECUTE_BID',
        bidData,
        settings
      }).catch(() => ({ success: false, error: 'content script通信失敗' }));

      if (!result?.success && (result?.needsDocumentSign || result?.error?.includes('署名'))) {
        if (settings.autoSignDocuments !== false) {
          result = await handleDocumentSigning(tabId, settings, result, bidData);
        } else {
          result = { success: false, skipped: true, error: '書類署名が必要（自動署名オフ）' };
        }
      }

      if (!result?.success && slowMode) {
        const solveResult = await attemptProblemSolve(tabId, project, result, settings);
        if (solveResult?.resolved) {
          result = await chrome.tabs.sendMessage(tabId, {
            type: 'EXECUTE_BID',
            bidData,
            settings
          }).catch(() => result);
        }
      }
    }

    const elapsed = Date.now() - startTime;
    const finalStatus = result?.success ? 'bid_placed' : result?.skipped ? 'skipped' : 'failed';
    await markProjectProcessed(project.projectId, finalStatus);
    await archiveProjectResult(project, finalStatus, {
      reason: result?.reason || result?.error,
      message: result?.message || result?.error || result?.reason || '完了'
    });
    await recordFilterStatus(project, result?.success ? 'success' : result?.skipped ? 'skipped' : 'failed', {
      reason: result?.reason || result?.error,
      message: result?.message || result?.error || result?.reason || '完了'
    });
    await recordBidAttempt({
      success: !!result?.success,
      skipped: !!result?.skipped,
      projectId: project.projectId,
      title: project.title,
      url: project.url,
      bidCount: project.bidCount,
      elapsedMs: elapsed,
      message: result?.message || result?.error || result?.reason || '完了',
      level: result?.success ? 'success' : result?.skipped ? 'warn' : 'error'
    });

    if (result?.success) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: '入札成功',
        message: project.title
      });
    }
  } catch (err) {
    await recordFilterStatus(project, 'failed', {
      reason: 'error',
      message: err.message
    });
    await recordBidAttempt({
      success: false,
      projectId: project.projectId,
      title: project.title,
      message: err.message,
      level: 'error'
    });
    await markProjectProcessed(project.projectId, 'error');
  } finally {
    if (monitorTabId) {
      chrome.tabs.sendMessage(monitorTabId, { type: 'SCAN_PROJECTS' }).catch(() => {});
    }
    void processBidQueue();
  }
}

async function handleDocumentSigning(tabId, settings, prevResult, bidData) {
  const signResult = await chrome.tabs.sendMessage(tabId, {
    type: 'SIGN_DOCUMENT',
    settings
  }).catch(() => ({ success: false }));

  if (signResult?.success) {
    await sleep(1500);
    const retryBid = await chrome.tabs.sendMessage(tabId, {
      type: 'EXECUTE_BID',
      bidData,
      settings
    }).catch(() => ({ success: false, error: '署名後の入札再試行失敗' }));
    if (retryBid?.success) {
      return { success: true, message: '書類署名後入札完了' };
    }
    return retryBid;
  }

  const solveResult = await attemptProblemSolve(
    tabId,
    {},
    { error: '書類署名が必要', ...prevResult },
    settings
  );
  if (solveResult?.resolved) {
    const retry = await chrome.tabs.sendMessage(tabId, { type: 'SIGN_DOCUMENT', settings });
    if (retry?.success) {
      await sleep(1500);
      return chrome.tabs.sendMessage(tabId, {
        type: 'EXECUTE_BID',
        bidData,
        settings
      }).catch(() => prevResult);
    }
  }
  return prevResult;
}

async function attemptProblemSolve(tabId, project, result, settings) {
  try {
    const context = `プロジェクト: ${project.title || 'unknown'}
エラー: ${result?.error || result?.reason || 'unknown'}
入札者数: ${project.bidCount}
ページURL: ${project.url || ''}`;

    const solveResult = await solveProblem(tabId, context, settings, analyzeProblem);
    await addBidLog({
      level: solveResult.success ? 'info' : 'error',
      message: `AI問題分析: ${solveResult.analysis?.problem || solveResult.error}`,
      projectId: project.projectId,
      hasScreenshot: !!solveResult.screenshot
    });
    return { resolved: solveResult.success, analysis: solveResult.analysis };
  } catch (err) {
    return { resolved: false, error: err.message };
  }
}

function buildFallbackProposal(project, settings) {
  const lang = detectProjectLanguage(project);
  const links = selectRelevantLinks(project, getPortfolioLinks(settings), 2, 3);
  const linkBlock = links.length
    ? `\n\nRelevant past work:\n${links.map((l) => l.url).join('\n')}`
    : '';
  const templates = {
    English: `Hi, I'm very interested in your project "${project.title}".

I have extensive experience with ${(project.skills || []).slice(0, 5).join(', ')} and can deliver high-quality results within your budget and timeline.

I'd love to discuss your requirements in more detail. Looking forward to working with you!

Best regards`,
    Spanish: `Hola, estoy muy interesado en su proyecto "${project.title}".

Tengo amplia experiencia en ${(project.skills || []).slice(0, 5).join(', ')} y puedo entregar resultados de alta calidad dentro de su presupuesto y plazo.

Me encantaría discutir sus requisitos con más detalle. ¡Espero trabajar con usted!

Saludos cordiales`,
    French: `Bonjour, je suis très intéressé par votre projet "${project.title}".

J'ai une vaste expérience en ${(project.skills || []).slice(0, 5).join(', ')} et je peux livrer des résultats de haute qualité dans votre budget et délais.

J'aimerais discuter de vos exigences plus en détail. Au plaisir de travailler avec vous!

Cordialement`
  };
  const baseText = templates[lang] || templates.English;
  const result = finalizeProposal(`${baseText}${linkBlock}`, project, settings, links);
  return result.text || result;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case 'START_BOT':
        await startBot();
        sendResponse({ ok: true });
        break;
      case 'STOP_BOT':
        await stopBot();
        sendResponse({ ok: true });
        break;
      case 'SAVE_SETTINGS':
        sendResponse(await saveSettings(msg.settings));
        break;
      case 'GET_SETTINGS':
        sendResponse(await getSettings());
        break;
      case 'GET_STATS':
        sendResponse(await getStats());
        break;
      case 'DELETE_SETTINGS':
        if (msg.target === 'stats') await deleteStats();
        else await deleteSettings();
        sendResponse({ ok: true });
        break;
      case 'NEW_PROJECTS_DETECTED': {
        sendResponse(
          await handleDetectedProjects(msg.projects || [], { seedBaseline: !!msg.seedBaseline })
        );
        break;
      }
      case 'GET_ARCHIVE_IDS': {
        sendResponse({ ids: await getArchivedProjectIds() });
        break;
      }
      case 'MONITOR_SCAN_RESULT': {
        const signature = `${msg.domCount}|${msg.apiCount}|${msg.seeded}|${msg.newCount}`;
        const now = Date.now();
        const shouldLog =
          msg.seeded ||
          (msg.newCount ?? 0) > 0 ||
          signature !== lastScanLog.signature ||
          now - lastScanLog.at > 15000;
        if (shouldLog) {
          const parts = [
            `DOM:${msg.domCount ?? 0}`,
            `API:${msg.apiCount ?? 0}`,
            msg.seeded ? 'seeded baseline' : `new:${msg.newCount ?? 0}`
          ];
          await addFilterStatusEntry({
            status: 'scan',
            level: 'info',
            title: 'SCAN',
            message: parts.join(' | ')
          });
          lastScanLog = { at: now, signature };
        }
        sendResponse({ ok: true });
        break;
      }
      case 'GET_FILTER_STATUS':
        sendResponse(await getFilterStatus());
        break;
      case 'CLEAR_FILTER_STATUS':
        await clearFilterStatus();
        sendResponse({ ok: true });
        break;
      case 'DELETE_FILTER_STATUS_ENTRY':
        sendResponse({ ok: true, filterStatus: await deleteFilterStatusEntry(msg.entryId) });
        break;
      case 'MONITOR_ERROR': {
        await addFilterStatusEntry({
          status: 'failed',
          level: 'error',
          title: 'MONITOR',
          message: msg.message || 'Monitor scan error'
        });
        sendResponse({ ok: true });
        break;
      }
      case 'CONTENT_SCRIPT_READY':
        if (msg.page === 'projects-monitor') {
          const s = await getSettings();
          if (s.isRunning) {
            const tabId = monitorTabId || sender.tab?.id;
            if (tabId) {
              monitorTabId = tabId;
              await startMonitoringOnTab(tabId).catch(() => {});
            }
          }
        }
        sendResponse({ ok: true });
        break;
      default:
        sendResponse({ error: 'unknown_message' });
    }
  })();
  return true;
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'poll_projects') {
    const settings = await getSettings();
    if (!settings.isRunning) return;
    const tabId = await ensureMonitorTab();
    await chrome.tabs.sendMessage(tabId, { type: 'SCAN_PROJECTS' }).catch(() => {});
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  const settings = await getSettings();
  if (!settings.lastUpdated) {
    await saveSettings({});
  }
});

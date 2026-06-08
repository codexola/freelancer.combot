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
  detectProjectLanguage,
  analyzeProjectRequirements
} from '../lib/filters.js';
import { finalizeProposal } from '../lib/portfolio.js';
import {
  normalizeDetailsUrl,
  compareProjectsByNewest
} from '../lib/project-url.js';

const PROJECTS_URL = 'https://www.freelancer.com/search/projects?projectSort=latest';
const PROJECTS_URL_ALT = 'https://www.freelancer.com/search/projects';
let monitorTabId = null;
const bidQueue = [];
let isProcessingBid = false;
const pendingYoungProjects = new Map();
let pendingRetryTimer = null;
let lastScanLog = { at: 0, signature: '' };
const MONITOR_SCRIPT_FILES = ['lib/project-url-content.js', 'content/projects-monitor.js'];

async function injectMonitorScripts(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: MONITOR_SCRIPT_FILES
  });
}

async function ensureContentScript(tabId) {
  let ready = await waitForContentScript(tabId, 6000);
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

  ready = await waitForContentScript(tabId, 12000);
  if (!ready) {
    await addFilterStatusEntry({
      status: 'failed',
      level: 'error',
      title: 'SYSTEM',
      message: 'Monitor script failed to start after injection'
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

function waitForTabLoad(tabId, timeout = 15000) {
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

async function startBot() {
  await saveSettings({ isRunning: true });
  await addFilterStatusEntry({
    status: 'system',
    level: 'info',
    message: `Bot started — monitoring ${PROJECTS_URL}`,
    title: 'SYSTEM'
  });
  const tabId = await ensureMonitorTab();
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

async function waitForContentScript(tabId, timeout = 12000) {
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

  await markProjectProcessed(project.projectId, 'queued');
  bidQueue.push({ project, settings });
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

  const { pass, reason, message, defer, retryInMs, requirementAnalysis } = await filterProject(
    normalized,
    settings
  );
  const reqMsg = requirementAnalysis?.summary || reqPreview.summary;
  let archiveStatus = reason || 'skipped';

  if (pass) {
    archiveStatus = 'passed';
    await recordFilterStatus(normalized, 'passed', { message: `フィルター通過 — ${reqMsg}` });
    await archiveProjectResult(normalized, archiveStatus, { message: reqMsg });
    await enqueueProject(normalized, settings);
  } else if (defer && retryInMs) {
    archiveStatus = 'deferred';
    await markProjectProcessed(normalized.projectId, 'deferred');
    await recordFilterStatus(normalized, 'deferred', { reason, message: `${message} — ${reqMsg}` });
    await archiveProjectResult(normalized, archiveStatus, { reason, message });
    scheduleYoungProjectRetry(normalized, settings, retryInMs);
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
    const archived = await isProjectArchived(project.projectId);
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

async function executeBidFlow(project, settings) {
  const startTime = Date.now();
  let tab = null;

  try {
    await markProjectProcessed(project.projectId, 'bidding');
    await recordFilterStatus(project, 'bidding', { message: '入札処理中' });
    const bidUrl = normalizeDetailsUrl(project.url);
    tab = await chrome.tabs.create({ url: bidUrl, active: false });
    await waitForTabLoad(tab.id);

    const scriptReady = await waitForContentScript(tab.id);
    if (!scriptReady) {
      await recordFilterStatus(project, 'failed', {
        reason: 'content_script_timeout',
        message: 'content script通信失敗（タイムアウト）'
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

    const bidCountRes = await chrome.tabs.sendMessage(tab.id, { type: 'GET_BID_COUNT' }).catch(() => null);
    if (bidCountRes?.bidCount != null && bidCountRes.bidCount >= settings.maxBidCount) {
      await markProjectProcessed(project.projectId, 'skipped_bid_count');
      await recordFilterStatus(project, 'skipped', {
        reason: 'skipped_bid_count',
        message: `入札者数 ${bidCountRes.bidCount} >= ${settings.maxBidCount}`
      });
      await recordBidAttempt({
        success: false,
        skipped: true,
        projectId: project.projectId,
        title: project.title,
        message: `入札者数 ${bidCountRes.bidCount} >= ${settings.maxBidCount}`,
        level: 'warn'
      });
      return;
    }

    const projectDataRes = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PROJECT_DATA' }).catch(() => null);
    const projectData = { ...project, ...(projectDataRes || {}) };

    const pageFilter = evaluateProjectFilters(projectData, settings);
    if (!pageFilter.pass) {
      await markProjectProcessed(project.projectId, pageFilter.reason);
      await recordFilterStatus(project, 'skipped', {
        reason: pageFilter.reason,
        message: pageFilter.message || pageFilter.reason
      });
      await recordBidAttempt({
        success: false,
        skipped: true,
        projectId: project.projectId,
        title: project.title,
        message: pageFilter.message || pageFilter.reason,
        level: 'warn'
      });
      return;
    }

    let proposal = '';
    try {
      proposal = await generateProposal(settings, projectData);
    } catch (apiErr) {
      proposal = buildFallbackProposal(projectData, settings);
      await addBidLog({
        level: 'warn',
        message: `API入札文生成失敗、フォールバック使用: ${apiErr.message}`,
        projectId: project.projectId
      });
    }

    const bidData = {
      proposal,
      bidAmount: settings.defaultBidAmount,
      hourlyRate: settings.defaultHourlyRate,
      deliveryDays: settings.defaultDeliveryDays
    };

    let result = await chrome.tabs.sendMessage(tab.id, {
      type: 'EXECUTE_BID',
      bidData,
      settings
    }).catch(() => ({ success: false, error: 'content script通信失敗' }));

    if (!result?.success && (result?.needsDocumentSign || result?.error?.includes('署名'))) {
      if (settings.autoSignDocuments !== false) {
        result = await handleDocumentSigning(tab.id, settings, result, bidData);
      } else {
        result = { success: false, skipped: true, error: '書類署名が必要（自動署名オフ）' };
      }
    }

    if (!result?.success) {
      const solveResult = await attemptProblemSolve(tab.id, project, result, settings);
      if (solveResult?.resolved) {
        result = await chrome.tabs.sendMessage(tab.id, {
          type: 'EXECUTE_BID',
          bidData,
          settings
        }).catch(() => result);
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
    if (tab?.id) {
      await sleep(2000);
      chrome.tabs.remove(tab.id).catch(() => {});
    }
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
  return finalizeProposal(baseText, project, settings);
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

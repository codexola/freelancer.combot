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
  addBidLog
} from '../lib/storage.js';
import { generateProposal, analyzeProblem } from '../lib/api-clients.js';
import { solveProblem } from '../lib/problem-solver.js';
import { evaluateProjectFilters, detectProjectLanguage } from '../lib/filters.js';
import { finalizeProposal } from '../lib/portfolio.js';

const PROJECTS_URL = 'https://www.freelancer.com/search/projects';
let monitorTabId = null;
const bidQueue = [];
let isProcessingBid = false;

async function ensureMonitorTab() {
  const tabs = await chrome.tabs.query({ url: 'https://www.freelancer.com/search/projects*' });
  if (tabs.length > 0) {
    monitorTabId = tabs[0].id;
    return monitorTabId;
  }
  const tab = await chrome.tabs.create({ url: PROJECTS_URL, active: false });
  monitorTabId = tab.id;
  await waitForTabLoad(tab.id);
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
  const settings = await getSettings();
  await saveSettings({ isRunning: true });
  const tabId = await ensureMonitorTab();
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'START_MONITORING' });
  } catch {
    await sleep(2000);
    await chrome.tabs.sendMessage(tabId, { type: 'START_MONITORING' }).catch(() => {});
  }
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

async function filterProject(project, settings) {
  const processed = await getProcessedProjects();
  if (processed[project.projectId]) return { pass: false, reason: 'already_processed' };

  if (project.bidCount >= settings.maxBidCount) {
    return { pass: false, reason: `bid_count_${project.bidCount}` };
  }

  const maxAge = settings.bidWindowMaxSec || 10;
  if (project.secondsAgo > maxAge && project.secondsAgo !== Infinity) {
    return { pass: false, reason: `too_old_${project.secondsAgo}s` };
  }

  if (settings.skipNdaProjects && project.isNda) {
    return { pass: false, reason: 'nda_project' };
  }

  const filterResult = evaluateProjectFilters(project, settings);
  if (!filterResult.pass) {
    return {
      pass: false,
      reason: filterResult.reason,
      message: filterResult.message,
      skipped: true
    };
  }

  return { pass: true };
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
    tab = await chrome.tabs.create({ url: project.url, active: false });
    await waitForTabLoad(tab.id);
    await sleep(500);

    const bidCountRes = await chrome.tabs.sendMessage(tab.id, { type: 'GET_BID_COUNT' }).catch(() => null);
    if (bidCountRes && bidCountRes.bidCount >= settings.maxBidCount) {
      await markProjectProcessed(project.projectId, 'skipped_bid_count');
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
      result = await handleDocumentSigning(tab.id, settings, result);
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
    await markProjectProcessed(project.projectId, result?.success ? 'bid_placed' : 'failed');
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
  }
}

async function handleDocumentSigning(tabId, settings, prevResult) {
  const signResult = await chrome.tabs.sendMessage(tabId, {
    type: 'SIGN_DOCUMENT',
    settings
  }).catch(() => ({ success: false }));

  if (signResult?.success) {
    await sleep(1000);
    return { success: true, message: '書類署名後入札完了' };
  }

  const solveResult = await attemptProblemSolve(
    tabId,
    {},
    { error: '書類署名が必要', ...prevResult },
    settings
  );
  if (solveResult?.resolved) {
    const retry = await chrome.tabs.sendMessage(tabId, { type: 'SIGN_DOCUMENT', settings });
    return retry?.success ? { success: true } : prevResult;
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

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
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
        const { deleteSettings, deleteStats } = await import('../lib/storage.js');
        if (msg.target === 'stats') await deleteStats();
        else await deleteSettings();
        sendResponse({ ok: true });
        break;
      case 'NEW_PROJECTS_DETECTED': {
        const settings = await getSettings();
        if (!settings.isRunning) {
          sendResponse({ ok: false, reason: 'not_running' });
          break;
        }
        for (const project of msg.projects) {
          const { pass, reason, message } = await filterProject(project, settings);
          if (pass) {
            bidQueue.push({ project, settings });
            await addBidLog({
              level: 'info',
              message: `新規プロジェクト検出: ${project.title} (${project.bidCount} bids)`,
              projectId: project.projectId
            });
          } else if (reason !== 'already_processed') {
            await markProjectProcessed(project.projectId, reason);
            if (reason?.startsWith('price_below') || reason?.startsWith('excluded_country')) {
              await addBidLog({
                level: 'warn',
                message: `スキップ: ${project.title} - ${message || reason}`,
                projectId: project.projectId
              });
            }
          }
        }
        processBidQueue();
        sendResponse({ ok: true, queued: bidQueue.length });
        break;
      }
      case 'CONTENT_SCRIPT_READY':
        if (msg.page === 'projects-monitor') {
          const s = await getSettings();
          if (s.isRunning && monitorTabId) {
            chrome.tabs.sendMessage(monitorTabId, { type: 'START_MONITORING' }).catch(() => {});
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
    chrome.tabs.sendMessage(tabId, { type: 'SCAN_PROJECTS' }).catch(() => {});
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  const settings = await getSettings();
  if (!settings.lastUpdated) {
    await saveSettings({});
  }
});

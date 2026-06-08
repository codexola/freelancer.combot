/**
 * 問題発生時のスクリーンショット取得とAI分析・自動解決
 */

export async function captureScreenshot(tabId) {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
    return dataUrl.replace(/^data:image\/png;base64,/, '');
  } catch (err) {
    console.error('Screenshot failed:', err);
    return null;
  }
}

export async function executeActions(tabId, actions, settings) {
  const results = [];
  for (const action of actions) {
    try {
      const result = await chrome.scripting.executeScript({
        target: { tabId },
        func: executeActionInPage,
        args: [action, settings]
      });
      results.push({ action, success: true, result: result[0]?.result });
      if (action.type === 'wait') {
        await sleep(action.ms || 1000);
      } else {
        await sleep(500);
      }
    } catch (err) {
      results.push({ action, success: false, error: err.message });
    }
  }
  return results;
}

function executeActionInPage(action, settings) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function run() {
    switch (action.type) {
      case 'click': {
        const el = document.querySelector(action.selector);
        if (!el) return { error: `Element not found: ${action.selector}` };
        el.click();
        return { clicked: action.selector };
      }
      case 'fill': {
        const el = document.querySelector(action.selector);
        if (!el) return { error: `Element not found: ${action.selector}` };
        el.focus();
        el.value = action.value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { filled: action.selector };
      }
      case 'wait':
        await sleep(action.ms || 1000);
        return { waited: action.ms };
      case 'drawSignature': {
        const canvas = document.querySelector('canvas');
        if (!canvas) return { error: 'Canvas not found' };
        const ctx = canvas.getContext('2d');
        const strokes = settings.signatureStrokes?.length
          ? settings.signatureStrokes
          : generateDefaultSignature(canvas.width, canvas.height);
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        for (const stroke of strokes) {
          ctx.beginPath();
          stroke.forEach((point, i) => {
            if (i === 0) ctx.moveTo(point.x, point.y);
            else ctx.lineTo(point.x, point.y);
          });
          ctx.stroke();
        }
        return { drawn: true };
      }
      default:
        return { error: `Unknown action: ${action.type}` };
    }
  }

  function generateDefaultSignature(w, h) {
    const baseY = h * 0.7;
    return [
      [
        { x: w * 0.15, y: baseY },
        { x: w * 0.25, y: baseY - 20 },
        { x: w * 0.35, y: baseY },
        { x: w * 0.45, y: baseY + 10 }
      ],
      [
        { x: w * 0.5, y: baseY - 15 },
        { x: w * 0.6, y: baseY },
        { x: w * 0.7, y: baseY - 10 },
        { x: w * 0.85, y: baseY }
      ]
    ];
  }

  return run();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function solveProblem(tabId, context, settings, analyzeFn) {
  const screenshot = await captureScreenshot(tabId);
  if (!screenshot) {
    return { success: false, error: 'スクリーンショット取得失敗' };
  }

  const analysis = await analyzeFn(settings, screenshot, context);
  if (!analysis.canAutoResolve || !analysis.actions?.length) {
    return {
      success: false,
      analysis,
      screenshot,
      error: analysis.problem || '自動解決不可'
    };
  }

  const results = await executeActions(tabId, analysis.actions, settings);
  const allSuccess = results.every((r) => r.success);
  return { success: allSuccess, analysis, results, screenshot };
}

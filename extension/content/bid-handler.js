/**
 * プロジェクトページでの入札処理
 * f6.png (hourly), f7.png (fixed price) に対応
 */

(function () {
  'use strict';

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function setInputValue(el, value) {
    if (!el) return false;
    el.focus();
    const nativeSetter = Object.getOwnPropertyDescriptor(
      el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      'value'
    )?.set;
    if (nativeSetter) nativeSetter.call(el, String(value));
    else el.value = String(value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function findBidForm() {
    return (
      document.querySelector('[class*="PlaceBid"], [class*="place-bid"], form[class*="bid"]') ||
      document.querySelector('form') ||
      document.body
    );
  }

  function getBidCount() {
    const text = document.body.innerText;
    const patterns = [
      /(\d+)\s*bids?\s*(?:on|placed|so far)?/i,
      /bids?\s*[:\s]*(\d+)/i,
      /(\d+)\s*bidders?/i
    ];
    for (const p of patterns) {
      const m = text.match(p);
      if (m) return parseInt(m[1], 10);
    }
    const bidEl = document.querySelector('[class*="bid-count"], [class*="BidCount"], [data-bid-count]');
    if (bidEl) return parseInt(bidEl.textContent, 10) || 999;
    return 0;
  }

  function extractClientCountry() {
    const aboutSection =
      document.querySelector('[class*="AboutClient"], [class*="about-client"], [class*="client-info"], [class*="ClientInfo"]') ||
      document.body;
    const text = aboutSection.textContent || '';
    const locationEl = aboutSection.querySelector(
      '[class*="location"], [class*="Location"], [class*="country"], [class*="Country"], fl-flag'
    );
    const locationText = (locationEl?.textContent || locationEl?.getAttribute('title') || '').trim();

    const patterns = [
      /(?:member since|from|located in|based in|country[:\s]+)\s*([A-Za-z][A-Za-z\s]{2,40})/i,
      /([A-Za-z][A-Za-z\s]{2,40}),\s*(?:verified|identity)/i
    ];
    for (const p of patterns) {
      const m = text.match(p);
      if (m) return m[1].trim();
    }
    return locationText;
  }

  function extractProjectLanguage() {
    const langEl = document.querySelector('[class*="language"], [class*="Language"]');
    const langText = langEl?.textContent?.trim() || '';
    const postedMatch = document.body.innerText.match(/posted in\s+(\w+)/i);
    if (postedMatch) return postedMatch[1];
    if (langText) return langText;
    return '';
  }

  function getProjectData() {
    const title =
      document.querySelector('h1, [class*="project-title"], [class*="ProjectTitle"]')?.textContent?.trim() || '';
    const description =
      document.querySelector('[class*="description"], [class*="Description"], [class*="project-description"]')
        ?.textContent?.trim() ||
      document.querySelector('main p')?.textContent?.trim() ||
      '';
    const budget =
      document.querySelector('[class*="budget"], [class*="Budget"]')?.textContent?.trim() || '';
    const skillEls = document.querySelectorAll('[class*="skill"], fl-tag, [class*="Skill"]');
    const skills = Array.from(skillEls).map((el) => el.textContent.trim()).filter(Boolean);

    const isHourly = /per hour|hourly|\/hr|\/hour/i.test(document.body.innerText + budget);
    return {
      title,
      description,
      budget,
      skills,
      bidType: isHourly ? 'hourly' : 'fixed',
      bidCount: getBidCount(),
      clientCountry: extractClientCountry(),
      projectLanguage: extractProjectLanguage(),
      languageText: extractProjectLanguage()
    };
  }

  function findInputByContext(keywords) {
    const inputs = document.querySelectorAll('input, textarea, select');
    for (const input of inputs) {
      const context = [
        input.placeholder,
        input.name,
        input.id,
        input.getAttribute('aria-label'),
        input.closest('label')?.textContent,
        input.closest('[class*="field"], [class*="Field"], .form-group')?.textContent
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (keywords.some((k) => context.includes(k))) return input;
    }
    return null;
  }

  async function fillBidForm(bidData, settings) {
    const form = findBidForm();
    const isHourly = bidData.bidType === 'hourly';

    if (isHourly) {
      const rateInput =
        findInputByContext(['hourly', 'rate', 'per hour', 'amount']) ||
        form.querySelector('input[type="number"], input[inputmode="decimal"]');
      setInputValue(rateInput, bidData.hourlyRate || settings.defaultHourlyRate);
    } else {
      const amountInput =
        findInputByContext(['bid amount', 'amount', 'price', 'your bid']) ||
        form.querySelector('input[type="number"], input[inputmode="decimal"]');
      setInputValue(amountInput, bidData.bidAmount || settings.defaultBidAmount);

      const deliveryInput = findInputByContext(['delivery', 'days', 'time', 'period']);
      if (deliveryInput) {
        setInputValue(deliveryInput, bidData.deliveryDays || settings.defaultDeliveryDays);
      }
    }

    const profileSelect = findInputByContext(['profile', 'select a profile']) ||
      form.querySelector('select, [class*="profile"] select, fl-select');
    if (profileSelect && profileSelect.tagName === 'SELECT') {
      const options = Array.from(profileSelect.options);
      const match = options.find((o) =>
        o.textContent.toLowerCase().includes((settings.profileName || 'general').toLowerCase())
      );
      if (match) profileSelect.value = match.value;
      profileSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }

    const proposalInput =
      findInputByContext(['proposal', 'describe', 'best candidate', 'makes you', 'bid text']) ||
      form.querySelector('textarea');
    if (proposalInput && bidData.proposal) {
      const proposal = String(bidData.proposal).slice(0, 1500);
      setInputValue(proposalInput, proposal);
    }

    await sleep(300);
    return true;
  }

  function findPlaceBidButton() {
    const buttons = document.querySelectorAll('button, fl-button, [role="button"], a[class*="btn"]');
    return Array.from(buttons).find((b) =>
      /place\s*bid|submit\s*bid|bid\s*now/i.test(b.textContent)
    );
  }

  async function clickPlaceBid() {
    const btn = findPlaceBidButton();
    if (!btn) return { success: false, error: 'Place Bidボタンが見つかりません' };
    btn.click();
    await sleep(1500);
    return { success: true };
  }

  async function executeBid(bidData, settings) {
    const projectData = getProjectData();

    if (projectData.bidCount >= (settings.maxBidCount || 50)) {
      return {
        success: false,
        skipped: true,
        reason: `入札者数が上限を超過: ${projectData.bidCount} >= ${settings.maxBidCount}`
      };
    }

    const filled = await fillBidForm({ ...bidData, ...projectData }, settings);
    if (!filled) return { success: false, error: 'フォーム入力失敗' };

    const clickResult = await clickPlaceBid();
    if (!clickResult.success) return clickResult;

    if (window.__fabDocumentSigner?.isDocumentSigningPage?.()) {
      const signResult = await window.__fabDocumentSigner.completeDocumentSigning(settings);
      if (signResult.needed && !signResult.success) {
        return { success: false, error: signResult.error, needsDocumentSign: true };
      }
    }

    await sleep(1000);

    if (window.__fabDocumentSigner?.isDocumentSigningPage?.()) {
      return { success: false, needsDocumentSign: true, error: '書類署名が必要' };
    }

    const successIndicators = /bid placed|successfully|your bid has been/i.test(document.body.innerText);
    const errorIndicators = document.querySelector('[class*="error"], [class*="Error"], .alert-danger');

    return {
      success: successIndicators || !errorIndicators,
      projectData,
      message: successIndicators ? '入札完了' : '入札処理完了（確認推奨）'
    };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'EXECUTE_BID') {
      executeBid(msg.bidData, msg.settings).then(sendResponse);
      return true;
    }
    if (msg.type === 'GET_PROJECT_DATA') {
      sendResponse(getProjectData());
      return true;
    }
    if (msg.type === 'GET_BID_COUNT') {
      sendResponse({ bidCount: getBidCount() });
      return true;
    }
  });

  window.__fabBidHandler = { executeBid, getProjectData, getBidCount };
})();

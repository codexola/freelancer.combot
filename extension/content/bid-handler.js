/**
 * プロジェクトページでの入札処理
 * f4-f5: IP Agreement → f6 (hourly) / f7 (fixed price)
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

  function getElementLabel(el) {
    return [
      el.textContent,
      el.value,
      el.getAttribute('aria-label'),
      el.getAttribute('title')
    ]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isVisible(el) {
    if (!el) return false;
    if (el.offsetParent !== null) return true;
    const rect = el.getBoundingClientRect?.();
    return rect && rect.width > 0 && rect.height > 0;
  }

  function getClickTargets(el) {
    const seen = new Set();
    const targets = [];
    const add = (node) => {
      if (!node || seen.has(node)) return;
      seen.add(node);
      targets.push(node);
    };

    add(el);
    add(el.closest?.('fl-button'));
    add(el.querySelector?.('button, a, [role="button"]'));
    if (el.shadowRoot) add(el.shadowRoot.querySelector('button, a, [role="button"]'));
    const flParent = el.closest?.('fl-button');
    if (flParent?.shadowRoot) add(flParent.shadowRoot.querySelector('button, a, [role="button"]'));

    return targets;
  }

  function clickElement(el) {
    if (!el) return false;
    try {
      el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    } catch {
      /* ignore */
    }

    const targets = getClickTargets(el);
    let clicked = false;
    for (const target of targets) {
      if (target.disabled || target.getAttribute?.('aria-disabled') === 'true') continue;
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
        target.dispatchEvent(
          new MouseEvent(type, { bubbles: true, cancelable: true, view: window })
        );
      }
      if (typeof target.click === 'function') target.click();
      clicked = true;
    }
    return clicked;
  }

  async function scrollToBidSection() {
    const targets = [findPlaceBidButton(), findOpenBidButton(), findProposalInput(), findBidForm()].filter(
      Boolean
    );
    const target = targets[0];
    if (target?.scrollIntoView) {
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } else {
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    }
    await sleep(700);
  }

  function normalizePageUrl() {
    let path = window.location.pathname.replace(/\.html/gi, '');
    if (!/\/details\/?$/i.test(path)) {
      path = path.replace(/\/?$/, '/details');
      if (path !== window.location.pathname) {
        window.location.replace(`${window.location.origin}${path}`);
        return true;
      }
    }
    return false;
  }

  function findBidForm() {
    const section = document.querySelector(
      '[class*="PlaceBid"], [class*="place-bid"], [class*="BidForm"], [class*="bid-form"]'
    );
    if (section) return section;
    const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, fl-heading, [class*="heading"]'));
    const bidHeading = headings.find((h) => /place a bid on this project/i.test(h.textContent || ''));
    if (bidHeading) {
      return bidHeading.closest('section, form, [class*="card"], [class*="Card"], main') || bidHeading.parentElement;
    }
    return document.querySelector('form') || document.body;
  }

  function findProposalInput() {
    const textareas = Array.from(document.querySelectorAll('textarea')).filter(isVisible);
    for (const ta of textareas) {
      const ctx = [
        ta.placeholder,
        ta.name,
        ta.id,
        ta.getAttribute('aria-label'),
        ta.closest('label')?.textContent,
        ta.closest('[class*="field"], [class*="Field"]')?.textContent
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (/proposal|candidate|best candidate|describe your|makes you|bid text|write my bid/.test(ctx)) {
        return ta;
      }
    }
    const form = findBidForm();
    const inForm = Array.from(form.querySelectorAll('textarea')).filter(isVisible);
    if (inForm.length === 1) return inForm[0];
    if (inForm.length > 1) {
      inForm.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);
      return inForm[0];
    }
    if (textareas.length) {
      textareas.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);
      return textareas[0];
    }
    return null;
  }

  function hasBidFormVisible() {
    if (findProposalInput()) return true;
    if (findPlaceBidButton()) return true;
    const form = findBidForm();
    if (findInputByContext(['bid amount', 'amount', 'hourly', 'delivered in', 'delivery'], form)) {
      return true;
    }
    return /place a bid on this project|your bid amount|write.*proposal|delivery.*days|what makes you the best/i.test(
      document.body.innerText || ''
    );
  }

  function findOpenBidButton() {
    const buttons = document.querySelectorAll(
      'button, fl-button, a, [role="button"], [class*="Button"], [class*="btn"]'
    );
    return Array.from(buttons).find((b) => {
      if (!isVisible(b)) return false;
      const text = getElementLabel(b);
      if (/^place bid$/i.test(text) || /^submit bid$/i.test(text)) return false;
      return /place a bid on this project|bid on this project|place bid on this|start bidding|write a bid|submit your bid/i.test(
        text
      );
    });
  }

  async function prepareBidPage(settings, maxMs) {
    const timeout = maxMs || (settings.slowNetworkMode !== false ? 50000 : 20000);
    const start = Date.now();

    while (Date.now() - start < timeout) {
      await scrollToBidSection();

      if (window.__fabDocumentSigner?.isDocumentSigningPage?.()) {
        const signResult = await window.__fabDocumentSigner.completeDocumentSigning(settings);
        if (signResult.needed && !signResult.success) {
          return { ready: false, error: signResult.error || '書類署名が必要', needsDocumentSign: true };
        }
        await sleep(2000);
        continue;
      }

      const proposalInput = findProposalInput();
      const placeBidBtn = findPlaceBidButton();
      if (proposalInput || placeBidBtn) {
        return { ready: true };
      }

      const openBtn = findOpenBidButton();
      if (openBtn) {
        clickElement(openBtn);
        await sleep(2200);
        continue;
      }

      if (hasBidFormVisible()) {
        await sleep(1200);
        if (findProposalInput() || findPlaceBidButton()) return { ready: true };
      }

      await sleep(900);
    }

    return { ready: false, error: '入札フォームを開けませんでした' };
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
    if (bidEl) {
      const count = parseInt(bidEl.textContent, 10);
      return Number.isFinite(count) ? count : null;
    }
    return null;
  }

  function extractClientCountry() {
    const aboutSection =
      document.querySelector(
        '[class*="AboutClient"], [class*="about-client"], [class*="client-info"], [class*="ClientInfo"]'
      ) || document.body;
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
    const postedMatch = document.body.innerText.match(/posted in\s+(\w+)/i);
    if (postedMatch) return postedMatch[1];
    const langEl = document.querySelector('[class*="language"], [class*="Language"]');
    return langEl?.textContent?.trim() || '';
  }

  function getProjectData() {
    const title =
      document.querySelector('h1, [class*="project-title"], [class*="ProjectTitle"]')?.textContent?.trim() ||
      '';
    const description =
      document.querySelector(
        '[class*="description"], [class*="Description"], [class*="project-description"]'
      )?.textContent?.trim() ||
      document.querySelector('main p')?.textContent?.trim() ||
      '';
    const budget =
      document.querySelector('[class*="budget"], [class*="Budget"]')?.textContent?.trim() || '';
    const skillEls = document.querySelectorAll('[class*="skill"], fl-tag, [class*="Skill"]');
    const skills = Array.from(skillEls).map((el) => el.textContent.trim()).filter(Boolean);

    const pageText = document.body.innerText + budget;
    const isHourly = /per hour|hourly|\/hr|\/hour|eur\/hour|usd\/hour/i.test(pageText);
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

  function fillYourNameFields(settings, root) {
    const name = settings?.fullName?.trim();
    if (!name) return;

    const fields = (root || document).querySelectorAll(
      'input[type="text"], input:not([type]), textarea, [contenteditable="true"]'
    );
    for (const field of fields) {
      const ctx = [
        field.placeholder,
        field.name,
        field.id,
        field.getAttribute('aria-label'),
        field.getAttribute('data-placeholder'),
        field.closest('label')?.textContent,
        field.closest('[class*="field"], [class*="Field"]')?.textContent
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!/your name|full name|freelancer.*name|contractor.*name/.test(ctx)) continue;
      if (/username|filename|project name|company name/.test(ctx)) continue;

      const current = (field.value || field.textContent || '').trim();
      if (current && current !== 'Your Name' && current.length > 2 && current !== name) continue;

      if (field.isContentEditable) {
        field.textContent = name;
        field.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        setInputValue(field, name);
      }
    }
  }

  async function selectProfile(settings, form) {
    const wanted = (settings.profileName || 'General').toLowerCase();
    const profileSelect =
      findInputByContext(['profile', 'select a profile'], form) ||
      form.querySelector('select, [class*="profile"] select');

    if (profileSelect?.tagName === 'SELECT') {
      const options = Array.from(profileSelect.options);
      const match =
        options.find((o) => o.textContent.toLowerCase().includes(wanted)) || options[0];
      if (match) {
        profileSelect.value = match.value;
        profileSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return;
    }

    const flSelect = form.querySelector(
      'fl-select, [class*="profile"] fl-select, [class*="ProfileSelect"], [class*="profile-select"]'
    );
    if (!flSelect) return;

    clickElement(flSelect);
    await sleep(700);
    const options = document.querySelectorAll(
      'fl-option, [role="option"], [role="listbox"] *, [class*="option"], [class*="Option"], li, button'
    );
    const match = Array.from(options).find((o) => {
      const text = (o.textContent || '').trim().toLowerCase();
      return text && (text.includes(wanted) || wanted.includes(text));
    });
    if (match) clickElement(match);
  }

  function findInputByContext(keywords, root) {
    const inputs = (root || document).querySelectorAll('input, textarea, select');
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
    const missing = [];

    if (isHourly) {
      const rateInput =
        findInputByContext(['hourly', 'rate', 'per hour', '/ hour', 'amount'], form) ||
        Array.from(form.querySelectorAll('input[type="number"], input[inputmode="decimal"]')).find(
          (el) => !findInputByContext(['delivery', 'days'], el.parentElement)
        );
      if (!rateInput) missing.push('hourly rate');
      else setInputValue(rateInput, bidData.hourlyRate || settings.defaultHourlyRate);
    } else {
      const amountInput =
        findInputByContext(['bid amount', 'amount', 'price', 'your bid', 'this bid'], form) ||
        form.querySelector('input[type="number"], input[inputmode="decimal"]');
      if (!amountInput) missing.push('bid amount');
      else setInputValue(amountInput, bidData.bidAmount || settings.defaultBidAmount);

      const deliveryInput = findInputByContext(
        ['delivered in', 'delivery', 'days', 'time', 'period'],
        form
      );
      if (deliveryInput) {
        setInputValue(deliveryInput, bidData.deliveryDays || settings.defaultDeliveryDays);
      }
    }

    await selectProfile(settings, form);
    fillYourNameFields(settings, form);

    const proposalInput = findProposalInput();
    if (!proposalInput || !bidData.proposal) missing.push('proposal');
    else setInputValue(proposalInput, String(bidData.proposal).slice(0, 1500));

    if (missing.length) {
      return { ok: false, error: `フォーム入力失敗: ${missing.join(', ')} が見つかりません` };
    }

    await sleep(400);
    return { ok: true };
  }

  function isPlaceBidLabel(text) {
    if (!text) return false;
    if (/place a bid on this project|bid on this project|start bidding|write a bid/i.test(text)) {
      return false;
    }
    return /\bplace\s+bid\b/i.test(text) || /\bsubmit\s+bid\b/i.test(text);
  }

  function findPlaceBidButton() {
    const buttons = document.querySelectorAll(
      'fl-button, button, [role="button"], a, input[type="submit"], [class*="Button"], [class*="btn"], [class*="primary"]'
    );
    const matches = Array.from(buttons).filter((b) => isPlaceBidLabel(getElementLabel(b)));
    if (!matches.length) return null;
    matches.sort((a, b) => {
      const ay = a.getBoundingClientRect?.().top || 0;
      const by = b.getBoundingClientRect?.().top || 0;
      return by - ay;
    });
    return matches.find(isVisible) || matches[0];
  }

  function detectBidSuccess() {
    const bodyText = document.body.innerText || '';
    return /bid placed|successfully placed|your bid has been submitted|bid submitted|you have already bid|bid was placed|入札が完了/i.test(
      bodyText
    );
  }

  function detectBidError() {
    const errorEl = document.querySelector(
      '[class*="error"], [class*="Error"], .alert-danger, [role="alert"], fl-alert'
    );
    const errorText = errorEl?.textContent?.trim() || '';
    if (errorText && /error|invalid|required|failed|unable|cannot/i.test(errorText)) {
      return errorText;
    }
    return '';
  }

  async function waitForBidConfirmation(timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (detectBidSuccess()) {
        return { success: true, message: '入札完了' };
      }
      const errorText = detectBidError();
      if (errorText) {
        return { success: false, error: errorText, retry: false };
      }
      await sleep(1000);
    }
    return { success: false, error: '入札確認タイムアウト', retry: true };
  }

  async function clickPlaceBidOnce(settings) {
    const slow = settings?.slowNetworkMode !== false;
    const clickDelay = slow ? 3500 : 2500;

    await scrollToBidSection();
    let btn = findPlaceBidButton();
    if (!btn) {
      await sleep(1500);
      await scrollToBidSection();
      btn = findPlaceBidButton();
    }
    if (!btn) return { success: false, error: 'Place Bidボタンが見つかりません' };

    clickElement(btn);
    await sleep(clickDelay);
    return { success: true };
  }

  async function clickPlaceBidAndConfirm(settings) {
    const slow = settings?.slowNetworkMode !== false;
    const maxAttempts = slow ? 8 : 5;
    const confirmTimeout = slow ? 30000 : 18000;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const clickResult = await clickPlaceBidOnce(settings);
      if (!clickResult.success) return clickResult;

      const outcome = await waitForBidConfirmation(confirmTimeout);
      if (outcome.success) return outcome;
      if (!outcome.retry) return outcome;

      if (!findPlaceBidButton()) break;
      await sleep(1200);
    }

    if (detectBidSuccess()) {
      return { success: true, message: '入札完了' };
    }

    const stillVisible = !!findPlaceBidButton();
    return {
      success: false,
      error: stillVisible
        ? 'Place Bidボタンをクリックしても入札が完了しませんでした'
        : '入札結果を確認できませんでした'
    };
  }

  async function executeBid(bidData, settings) {
    if (normalizePageUrl()) {
      await sleep(3000);
    }

    const pageReady = await prepareBidPage(settings);
    if (!pageReady.ready) {
      return {
        success: false,
        error: pageReady.error,
        needsDocumentSign: pageReady.needsDocumentSign
      };
    }

    const projectData = getProjectData();

    if (projectData.bidCount != null && projectData.bidCount >= (settings.maxBidCount || 50)) {
      return {
        success: false,
        skipped: true,
        reason: `入札者数が上限を超過: ${projectData.bidCount} >= ${settings.maxBidCount}`
      };
    }

    const fillResult = await fillBidForm({ ...bidData, ...projectData }, settings);
    if (!fillResult.ok) return { success: false, error: fillResult.error };

    const slow = settings?.slowNetworkMode !== false;
    const maxRounds = slow ? 4 : 3;

    for (let round = 0; round < maxRounds; round++) {
      const clickResult = await clickPlaceBidOnce(settings);
      if (!clickResult.success) return { ...clickResult, projectData };

      await sleep(1200);
      fillYourNameFields(settings, document);

      if (window.__fabDocumentSigner?.isDocumentSigningPage?.()) {
        const signResult = await window.__fabDocumentSigner.completeDocumentSigning(settings);
        if (signResult.needed && !signResult.success) {
          return { success: false, error: signResult.error, needsDocumentSign: true, projectData };
        }
        continue;
      }

      const confirmResult = await waitForBidConfirmation(slow ? 30000 : 18000);
      if (confirmResult.success) {
        return { success: true, projectData, message: '入札完了' };
      }
      if (!confirmResult.retry) {
        return { ...confirmResult, projectData };
      }

      if (!findPlaceBidButton()) break;
    }

    const finalConfirm = await clickPlaceBidAndConfirm(settings);
    if (finalConfirm.success) {
      return { success: true, projectData, message: '入札完了' };
    }

    const errorText = detectBidError() || finalConfirm.error;
    return {
      success: false,
      projectData,
      message: errorText || '入札結果を確認できませんでした',
      error: errorText || '入札結果を確認できませんでした'
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
    if (msg.type === 'PING') {
      sendResponse({ ok: true });
      return true;
    }
  });

  window.__fabBidHandler = { executeBid, getProjectData, getBidCount };
})();

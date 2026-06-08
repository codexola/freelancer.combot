/**
 * プロジェクトページでの入札処理
 * f4-f5: IP Agreement → f6 (hourly) / f7 (fixed price)
 */

(function () {
  'use strict';

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function queryDeep(selector, root = document) {
    const out = [];
    const seen = new Set();
    const walk = (node) => {
      if (!node || seen.has(node)) return;
      try {
        if (node.querySelectorAll) {
          for (const el of node.querySelectorAll(selector)) {
            if (!seen.has(el)) {
              seen.add(el);
              out.push(el);
            }
          }
          for (const child of node.querySelectorAll('*')) {
            if (child.shadowRoot) walk(child.shadowRoot);
          }
        }
      } catch {
        /* ignore */
      }
    };
    walk(root);
    return out;
  }

  function resolveFocusableInput(el) {
    if (!el) return null;
    const tag = el.tagName;
    if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return el;
    if (el.isContentEditable) return el;

    const inner = el.querySelector?.('textarea, input, select, [contenteditable="true"]');
    if (inner) return resolveFocusableInput(inner);

    if (el.shadowRoot) {
      const shadowInner = el.shadowRoot.querySelector(
        'textarea, input, select, [contenteditable="true"]'
      );
      if (shadowInner) return shadowInner;
    }
    return el;
  }

  function setInputValue(el, value) {
    const target = resolveFocusableInput(el);
    if (!target) return false;
    const text = String(value);

    target.focus?.();
    if (target.isContentEditable) {
      target.textContent = text;
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    const proto =
      target.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (nativeSetter) nativeSetter.call(target, text);
    else target.value = text;

    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
    target.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
  }

  function readInputValue(el) {
    const target = resolveFocusableInput(el);
    if (!target) return '';
    if (target.isContentEditable) return (target.textContent || '').trim();
    return (target.value || '').trim();
  }

  function getElementLabel(el) {
    const parts = [
      el.textContent,
      el.value,
      el.getAttribute('aria-label'),
      el.getAttribute('title'),
      el.getAttribute('data-label')
    ];
    if (el.shadowRoot) {
      const inner = el.shadowRoot.querySelector('button, span, slot, a');
      if (inner) {
        parts.push(inner.textContent, inner.getAttribute?.('aria-label'));
      }
    }
    return parts
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isElementDisabled(el) {
    if (!el) return true;
    const nodes = [el, el.querySelector?.('button'), el.shadowRoot?.querySelector('button')].filter(
      Boolean
    );
    return nodes.some(
      (node) =>
        node.disabled ||
        node.getAttribute?.('aria-disabled') === 'true' ||
        node.classList?.contains('disabled')
    );
  }

  function dispatchMouseClick(target, clientX, clientY) {
    const opts = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX,
      clientY,
      button: 0
    };
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      target.dispatchEvent(new MouseEvent(type, opts));
    }
    if (typeof target.click === 'function') target.click();
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

    const host = el.closest?.('fl-button') || (el.tagName === 'FL-BUTTON' ? el : null) || el;
    add(host);
    add(el);

    const walk = (node) => {
      if (!node) return;
      add(node);
      if (node.shadowRoot) {
        for (const child of node.shadowRoot.querySelectorAll('button, a, [role="button"], span')) {
          add(child);
        }
      }
      for (const child of node.querySelectorAll?.('button, a, [role="button"]') || []) {
        add(child);
      }
    };
    walk(host);

    return targets;
  }

  function clickElement(el) {
    if (!el) return false;
    try {
      el.scrollIntoView({ block: 'end', inline: 'nearest', behavior: 'instant' });
    } catch {
      /* ignore */
    }

    const rect = el.getBoundingClientRect();
    const x = rect.left + Math.max(rect.width / 2, 8);
    const y = rect.top + Math.max(rect.height / 2, 8);
    const atPoint = document.elementFromPoint(x, y);

    const targets = getClickTargets(atPoint || el);
    let clicked = false;
    for (const target of targets) {
      if (isElementDisabled(target)) continue;
      dispatchMouseClick(target, x, y);
      clicked = true;
    }

    if (!clicked && atPoint) {
      dispatchMouseClick(atPoint, x, y);
      clicked = true;
    }
    return clicked;
  }

  async function scrollToPlaceBidButton() {
    const btn = findPlaceBidButton();
    if (btn) {
      btn.scrollIntoView({ block: 'end', inline: 'nearest', behavior: 'instant' });
      await sleep(400);
      window.scrollBy(0, 160);
    } else {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
    }
    await sleep(800);
  }

  async function scrollToBidSection() {
    const openBtn = findOpenBidButton();
    const proposal = findProposalInput();
    const placeBid = findPlaceBidButton();
    const target = openBtn || proposal || placeBid || findBidForm();
    if (target?.scrollIntoView) {
      target.scrollIntoView({ block: 'center', behavior: 'instant' });
    } else {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
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
    const form = findBidForm();
    const labelNodes = queryDeep('label, fl-label, h3, h4, span, div', form);
    const proposalLabel = labelNodes.find((node) =>
      /describe your proposal|what makes you the best|minimum 100 characters/i.test(
        node.textContent || ''
      )
    );
    if (proposalLabel) {
      const container =
        proposalLabel.closest(
          'fl-textarea, fl-text-field, [class*="proposal"], [class*="Proposal"], [class*="field"], section, div'
        ) || proposalLabel.parentElement;
      const near = container?.querySelector?.('textarea, [contenteditable="true"], fl-textarea');
      if (near) {
        const resolved = resolveFocusableInput(near);
        if (resolved && isVisible(resolved)) return resolved;
      }
    }

    const deepFields = queryDeep('textarea, fl-textarea, [contenteditable="true"]', form);
    for (const field of deepFields) {
      const resolved = resolveFocusableInput(field);
      if (!resolved || !isVisible(resolved)) continue;
      const ctx = [
        resolved.placeholder,
        resolved.getAttribute('aria-label'),
        field.getAttribute?.('aria-label'),
        field.closest?.('[class*="field"], [class*="Field"]')?.textContent
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (/proposal|candidate|best candidate|describe your|makes you|write my bid/.test(ctx)) {
        return resolved;
      }
    }

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
    const inForm = Array.from(form.querySelectorAll('textarea, [contenteditable="true"]')).filter(
      isVisible
    );
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

  function isPreferredFreelancerRequired() {
    const text = (document.body.innerText || '').replace(/\s+/g, ' ');
    if (
      /you must be a preferred freelancer/i.test(text) ||
      /must be a preferred freelancer(?:\s+to|\s+in order)/i.test(text) ||
      /only (?:for )?preferred freelancers?(?:\s+can|\s+may|\s+are)/i.test(text) ||
      /preferred freelancer(?:s)?\s+(?:only|required|membership)/i.test(text)
    ) {
      return true;
    }

    const nodes = queryDeep(
      'fl-alert, fl-banner, [role="alert"], [class*="alert"], [class*="Alert"], [class*="notice"], [class*="restriction"]',
      document.body
    );
    return nodes.some((node) =>
      /preferred freelancer/i.test(node.textContent || '')
    );
  }

  function preferredFreelancerSkipResult(projectData = null) {
    return {
      success: false,
      skipped: true,
      reason: 'preferred_freelancer_required',
      error: 'You must be a Preferred Freelancer',
      message: 'Preferred Freelancer必須のため入札不可',
      closeTab: true,
      projectData
    };
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
      if (isPreferredFreelancerRequired()) {
        return {
          ready: false,
          preferredFreelancerRequired: true,
          error: 'Preferred Freelancer必須のため入札不可'
        };
      }

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
      languageText: extractProjectLanguage(),
      preferredFreelancerRequired: isPreferredFreelancerRequired()
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
    const inputs = queryDeep('input, textarea, select, fl-input, fl-text-field', root || document);
    for (const input of inputs) {
      const resolved = resolveFocusableInput(input) || input;
      const context = [
        resolved.placeholder,
        resolved.name,
        resolved.id,
        resolved.getAttribute('aria-label'),
        input.getAttribute('aria-label'),
        input.closest('label')?.textContent,
        input.closest('[class*="field"], [class*="Field"], .form-group')?.textContent
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (keywords.some((k) => context.includes(k))) return resolved;
    }
    return null;
  }

  async function commitFormValues(form) {
    const fields = queryDeep('input, textarea, select, [contenteditable="true"]', form);
    for (const field of fields) {
      const target = resolveFocusableInput(field) || field;
      target.dispatchEvent?.(new Event('blur', { bubbles: true }));
    }
    document.activeElement?.blur?.();
    await sleep(600);
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

    const proposalText = String(bidData.proposal || '').trim();
    if (!proposalText) missing.push('proposal');
    else if (proposalText.length < 100) {
      return { ok: false, error: `提案文が短すぎます (${proposalText.length}/100文字)` };
    }

    const proposalInput = findProposalInput();
    if (!proposalInput) missing.push('proposal');
    else {
      setInputValue(proposalInput, proposalText.slice(0, 1500));
      await sleep(500);
      const written = readInputValue(proposalInput);
      if (written.length < 80) {
        setInputValue(proposalInput, proposalText.slice(0, 1500));
        await sleep(500);
      }
      if (readInputValue(proposalInput).length < 80) {
        return { ok: false, error: '提案文をフォームに入力できませんでした' };
      }
    }

    if (missing.length) {
      return { ok: false, error: `フォーム入力失敗: ${missing.join(', ')} が見つかりません` };
    }

    await commitFormValues(form);
    await scrollToPlaceBidButton();
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
    const form = findBidForm();
    const scopes = [form, document.body];
    const candidates = [];

    for (const scope of scopes) {
      const buttons = queryDeep('fl-button, button, [role="button"], a, input[type="submit"]', scope);
      for (const b of buttons) {
        const label = getElementLabel(b);
        if (!isPlaceBidLabel(label)) continue;
        const rect = b.getBoundingClientRect?.();
        if (!rect || rect.width < 40 || rect.height < 20) continue;
        candidates.push({ el: b, top: rect.top, area: rect.width * rect.height });
      }
    }

    if (!candidates.length) return null;
    candidates.sort((a, b) => b.top - a.top || b.area - a.area);
    return candidates.find((c) => isVisible(c.el))?.el || candidates[0].el;
  }

  async function waitForPlaceBidButton(settings) {
    const slow = settings?.slowNetworkMode !== false;
    const timeout = slow ? 20000 : 12000;
    const start = Date.now();

    while (Date.now() - start < timeout) {
      await scrollToPlaceBidButton();
      const btn = findPlaceBidButton();
      if (btn && !isElementDisabled(btn)) return btn;
      await sleep(700);
    }

    return findPlaceBidButton();
  }

  function detectBidSuccess() {
    const bodyText = document.body.innerText || '';
    return /bid placed|successfully placed|your bid has been submitted|bid submitted|you have already bid|bid was placed|入札が完了/i.test(
      bodyText
    );
  }

  function detectBidError() {
    if (isPreferredFreelancerRequired()) {
      return 'You must be a Preferred Freelancer';
    }

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
    const clickDelay = slow ? 4000 : 3000;

    const btn = await waitForPlaceBidButton(settings);
    if (!btn) return { success: false, error: 'Place Bidボタンが見つかりません' };
    if (isElementDisabled(btn)) {
      return { success: false, error: 'Place Bidボタンが無効です（提案文や金額を確認してください）' };
    }

    await scrollToPlaceBidButton();
    const host = btn.closest?.('fl-button') || btn;
    clickElement(host);

    await sleep(400);
    if (!isElementDisabled(btn)) {
      clickElement(host);
    }

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

    if (isPreferredFreelancerRequired()) {
      return preferredFreelancerSkipResult(getProjectData());
    }

    const pageReady = await prepareBidPage(settings);
    if (!pageReady.ready) {
      if (pageReady.preferredFreelancerRequired || isPreferredFreelancerRequired()) {
        return preferredFreelancerSkipResult(getProjectData());
      }
      return {
        success: false,
        error: pageReady.error,
        needsDocumentSign: pageReady.needsDocumentSign
      };
    }

    const projectData = getProjectData();

    if (projectData.preferredFreelancerRequired) {
      return preferredFreelancerSkipResult(projectData);
    }

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

    if (isPreferredFreelancerRequired()) {
      return preferredFreelancerSkipResult(projectData);
    }

    const errorText = detectBidError() || finalConfirm.error;
    if (/preferred freelancer/i.test(errorText || '')) {
      return preferredFreelancerSkipResult(projectData);
    }

    return {
      success: false,
      projectData,
      message: errorText || '入札結果を確認できませんでした',
      error: errorText || '入札結果を確認できませんでした',
      closeTab: true
    };
  }

  async function executeAiActions(actions, settings) {
    const results = [];
    for (const action of actions || []) {
      try {
        if (action.type === 'wait') {
          await sleep(action.ms || 1000);
          results.push({ action, success: true });
          continue;
        }

        if (action.type === 'scrollToPlaceBid') {
          await scrollToPlaceBidButton();
          results.push({ action, success: true });
          continue;
        }

        const hint = `${action.description || ''} ${action.selector || ''}`.toLowerCase();

        if (action.type === 'click') {
          let el = action.selector ? document.querySelector(action.selector) : null;
          if (!el && /place\s*bid/.test(hint)) el = findPlaceBidButton();
          if (!el && /submit document|sign/.test(hint)) {
            el = Array.from(document.querySelectorAll('fl-button, button, [role="button"]')).find((b) =>
              /submit document|sign/i.test(getElementLabel(b))
            );
          }
          if (!el) {
            results.push({ action, success: false, error: `要素が見つかりません: ${action.selector || hint}` });
            continue;
          }
          clickElement(el);
          results.push({ action, success: true });
          continue;
        }

        if (action.type === 'fill') {
          let el = action.selector ? document.querySelector(action.selector) : null;
          if (!el && /proposal|describe your/.test(hint)) el = findProposalInput();
          if (!el && /hourly|rate|per hour/.test(hint)) {
            el = findInputByContext(['hourly', 'rate', 'per hour'], findBidForm());
          }
          if (!el && /amount|bid amount|delivery|days/.test(hint)) {
            el = findInputByContext(['bid amount', 'amount', 'delivery', 'days'], findBidForm());
          }
          if (!el && /name/.test(hint)) {
            fillYourNameFields(settings, document);
            results.push({ action, success: true, result: 'filled name fields' });
            continue;
          }
          if (!el || action.value == null) {
            results.push({ action, success: false, error: `入力欄が見つかりません: ${action.selector || hint}` });
            continue;
          }
          setInputValue(el, action.value);
          results.push({ action, success: true });
          continue;
        }

        if (action.type === 'drawSignature') {
          if (window.__fabDocumentSigner?.completeDocumentSigning) {
            const signResult = await window.__fabDocumentSigner.completeDocumentSigning(settings);
            results.push({ action, success: !!(signResult?.success || !signResult?.needed) });
          } else {
            results.push({ action, success: false, error: 'document signer unavailable' });
          }
          continue;
        }

        results.push({ action, success: false, error: `未知のアクション: ${action.type}` });
      } catch (err) {
        results.push({ action, success: false, error: err.message });
      }
    }

    return {
      results,
      allSuccess: results.length > 0 && results.every((r) => r.success)
    };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'EXECUTE_BID') {
      executeBid(msg.bidData, msg.settings).then(sendResponse);
      return true;
    }
    if (msg.type === 'EXECUTE_AI_ACTIONS') {
      executeAiActions(msg.actions, msg.settings).then(sendResponse);
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

  window.__fabBidHandler = { executeBid, executeAiActions, getProjectData, getBidCount };
})();

/**
 * IP Agreement / NDA / 契約書署名の自動処理
 * f1-f5.png の手順に対応
 */

(function () {
  'use strict';

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function findClickableContaining(text) {
    const lower = text.toLowerCase();
    const nodes = document.querySelectorAll(
      'button, a, [role="button"], fl-button, .Button, [class*="btn"], [class*="Button"]'
    );
    return Array.from(nodes).find((el) => {
      const label = (el.textContent || el.getAttribute('aria-label') || '').trim().toLowerCase();
      return label.includes(lower) && !el.disabled && el.offsetParent !== null;
    });
  }

  function isDocumentSigningPage() {
    const bodyText = document.body.innerText || '';
    return (
      /please sign the intellectual property|intellectual property transfer agreement/i.test(bodyText) ||
      /complete these steps/i.test(bodyText) ||
      /add signature|submit document/i.test(bodyText) ||
      !!document.querySelector('[class*="document-editor"], [class*="DocumentEditor"], [class*="sign-document"]')
    );
  }

  function isSignatureModalOpen() {
    return (
      !!document.querySelector('canvas, [class*="signature-pad"], [class*="SignaturePad"]') &&
      /add your signature|draw your signature|use your mouse to draw/i.test(document.body.innerText)
    );
  }

  function isStepComplete(stepLabel) {
    const body = document.body.innerText || '';
    if (stepLabel === 'signature' && /full name/i.test(body)) {
      const sigBtn = findClickableContaining('Add Signature');
      if (!sigBtn) return true;
    }
    const rows = document.querySelectorAll(
      'li, [class*="step"], [class*="Step"], [class*="checklist"], div, fl-list-item'
    );
    for (const row of rows) {
      const text = (row.textContent || '').toLowerCase();
      if (!text.includes(stepLabel)) continue;
      if (
        row.querySelector(
          '[class*="check"], [class*="Check"], fl-icon[name="check"], svg[class*="check"], .icon-check'
        )
      ) {
        return true;
      }
    }
    return false;
  }

  function drawSignatureOnCanvas(canvas, strokes) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width || canvas.offsetWidth || 400;
    const h = canvas.height || canvas.offsetHeight || 150;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;

    ctx.strokeStyle = '#1a1a2e';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const defaultStrokes = strokes?.length
      ? strokes
      : [
          [
            { x: w * 0.1, y: h * 0.65 },
            { x: w * 0.2, y: h * 0.45 },
            { x: w * 0.3, y: h * 0.7 },
            { x: w * 0.4, y: h * 0.5 }
          ],
          [
            { x: w * 0.45, y: h * 0.6 },
            { x: w * 0.55, y: h * 0.4 },
            { x: w * 0.65, y: h * 0.65 }
          ],
          [
            { x: w * 0.7, y: h * 0.55 },
            { x: w * 0.8, y: h * 0.45 },
            { x: w * 0.9, y: h * 0.6 }
          ]
        ];

    for (const stroke of defaultStrokes) {
      ctx.beginPath();
      stroke.forEach((pt, i) => {
        if (i === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      });
      ctx.stroke();
    }

    canvas.dispatchEvent(new Event('input', { bubbles: true }));
    canvas.dispatchEvent(new Event('change', { bubbles: true }));
    canvas.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  }

  function setInputValue(el, value) {
    if (!el) return;
    el.focus();
    const nativeSetter = Object.getOwnPropertyDescriptor(
      el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      'value'
    )?.set;
    if (nativeSetter) nativeSetter.call(el, String(value));
    else el.value = String(value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function handleAddSignature(settings) {
    if (isStepComplete('signature') && !findClickableContaining('Add Signature')) {
      return true;
    }

    const addBtn =
      findClickableContaining('+ Add Signature') || findClickableContaining('Add Signature');
    if (addBtn) {
      addBtn.click();
      await sleep(1200);
    }

    if (isSignatureModalOpen()) {
      const canvas = document.querySelector(
        'canvas, [class*="signature-pad"] canvas, [class*="Signature"] canvas'
      );
      if (canvas) {
        drawSignatureOnCanvas(canvas, settings?.signatureStrokes);
        await sleep(500);
        const modal = canvas.closest('[class*="modal"], [class*="Modal"], [role="dialog"]') || document.body;
        const confirmBtns = modal.querySelectorAll('button, fl-button, [role="button"]');
        const confirmBtn = Array.from(confirmBtns).find((b) =>
          /add signature/i.test(b.textContent || '')
        );
        if (confirmBtn) {
          confirmBtn.click();
          await sleep(1000);
        }
      }
    }
    return true;
  }

  async function handleAddFullName(settings) {
    if (isStepComplete('full name')) return true;

    const addNameBtn =
      findClickableContaining('+ Add Full Name') || findClickableContaining('Add Full Name');
    if (addNameBtn) {
      addNameBtn.click();
      await sleep(800);
    }

    const inputs = document.querySelectorAll('input[type="text"], input:not([type]), textarea');
    for (const input of inputs) {
      const ctx = [
        input.placeholder,
        input.name,
        input.id,
        input.getAttribute('aria-label'),
        input.closest('label')?.textContent,
        input.closest('[class*="field"], [class*="Field"]')?.textContent
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!/name/.test(ctx) || /username|filename/.test(ctx)) continue;
      if (!input.value && settings?.fullName) {
        setInputValue(input, settings.fullName);
        await sleep(400);
        const saveBtn =
          findClickableContaining('Save') ||
          findClickableContaining('Confirm') ||
          findClickableContaining('Add');
        if (saveBtn) saveBtn.click();
        await sleep(800);
      }
      return true;
    }
    return true;
  }

  async function handleAddFullAddress(settings) {
    if (isStepComplete('full address') || isStepComplete('address')) return true;

    const addAddrBtn =
      findClickableContaining('+ Add Full Address') || findClickableContaining('Add Full Address');
    if (addAddrBtn) {
      addAddrBtn.click();
      await sleep(800);
    }

    const inputs = document.querySelectorAll('input[type="text"], textarea');
    for (const input of inputs) {
      const ctx = [
        input.placeholder,
        input.getAttribute('aria-label'),
        input.closest('label')?.textContent
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!/address/.test(ctx)) continue;
      if (!input.value && settings?.fullAddress) {
        setInputValue(input, settings.fullAddress);
        await sleep(400);
        const saveBtn = findClickableContaining('Save') || findClickableContaining('Confirm');
        if (saveBtn) saveBtn.click();
        await sleep(800);
      }
      return true;
    }
    return true;
  }

  async function submitDocument() {
    await sleep(600);
    const submitBtn = findClickableContaining('Submit Document');
    if (!submitBtn) return false;
    if (submitBtn.disabled || submitBtn.getAttribute('aria-disabled') === 'true') return false;
    submitBtn.click();
    await sleep(2000);
    return true;
  }

  function getPendingItems() {
    const pending = [];
    if (!isStepComplete('signature') && findClickableContaining('Add Signature')) {
      pending.push('signature');
    }
    if (!isStepComplete('full name') && findClickableContaining('Add Full Name')) {
      pending.push('fullName');
    }
    if (!isStepComplete('address') && findClickableContaining('Add Full Address')) {
      pending.push('fullAddress');
    }
    return pending;
  }

  async function completeDocumentSigning(settings) {
    if (!isDocumentSigningPage()) return { needed: false };

    const maxAttempts = 8;
    for (let i = 0; i < maxAttempts; i++) {
      const pending = getPendingItems();

      if (pending.includes('signature')) await handleAddSignature(settings);
      if (pending.includes('fullName')) await handleAddFullName(settings);
      if (pending.includes('fullAddress')) await handleAddFullAddress(settings);

      await sleep(1000);

      if (await submitDocument()) {
        await sleep(2000);
        if (!isDocumentSigningPage()) {
          return { needed: true, success: true, message: '書類署名完了' };
        }
      }

      if (!getPendingItems().length) {
        const submitBtn = findClickableContaining('Submit Document');
        if (submitBtn && !submitBtn.disabled) {
          submitBtn.click();
          await sleep(2000);
          return { needed: true, success: true, message: '書類署名完了' };
        }
      }
    }

    return { needed: true, success: false, error: '書類署名の完了に失敗' };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'SIGN_DOCUMENT') {
      completeDocumentSigning(msg.settings).then(sendResponse);
      return true;
    }
    if (msg.type === 'CHECK_DOCUMENT_PAGE') {
      sendResponse({ isDocumentPage: isDocumentSigningPage() });
      return true;
    }
  });

  window.__fabDocumentSigner = { completeDocumentSigning, isDocumentSigningPage };
})();

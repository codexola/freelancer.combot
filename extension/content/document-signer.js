/**
 * IP Agreement / NDA / 契約書署名の自動処理
 * f1-f5.png の手順に対応
 */

(function () {
  'use strict';

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function findByText(text, tag = '*') {
    const elements = document.querySelectorAll(tag);
    return Array.from(elements).find((el) =>
      el.textContent?.trim().toLowerCase().includes(text.toLowerCase()) &&
      (el.tagName === 'BUTTON' || el.tagName === 'A' || el.getAttribute('role') === 'button' || el.classList.toString().includes('btn'))
    );
  }

  function findButtonContaining(text) {
    const buttons = document.querySelectorAll('button, a, [role="button"], fl-button, .Button');
    return Array.from(buttons).find((b) => b.textContent?.includes(text));
  }

  function isDocumentSigningPage() {
    const bodyText = document.body.innerText;
    return (
      /add signature|submit document|intellectual property|ip transfer|complete these steps/i.test(bodyText) ||
      document.querySelector('[class*="sign"], [class*="Sign"], [class*="document-editor"]')
    );
  }

  function isSignatureModalOpen() {
    return (
      document.querySelector('canvas') &&
      /add your signature|draw your signature/i.test(document.body.innerText)
    );
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

    const defaultStrokes = strokes?.length ? strokes : [
      [{ x: w * 0.1, y: h * 0.65 }, { x: w * 0.2, y: h * 0.45 }, { x: w * 0.3, y: h * 0.7 }, { x: w * 0.4, y: h * 0.5 }],
      [{ x: w * 0.45, y: h * 0.6 }, { x: w * 0.55, y: h * 0.4 }, { x: w * 0.65, y: h * 0.65 }],
      [{ x: w * 0.7, y: h * 0.55 }, { x: w * 0.8, y: h * 0.45 }, { x: w * 0.9, y: h * 0.6 }]
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
  }

  async function handleAddSignature(settings) {
    const addBtn = findButtonContaining('Add Signature') || findButtonContaining('+ Add Signature');
    if (addBtn) {
      addBtn.click();
      await sleep(800);
    }

    if (isSignatureModalOpen()) {
      const canvas = document.querySelector('canvas');
      if (canvas) {
        drawSignatureOnCanvas(canvas, settings?.signatureStrokes);
        await sleep(300);
        const confirmBtn = findButtonContaining('Add Signature') ||
          document.querySelector('button[class*="primary"], button[type="submit"]');
        if (confirmBtn && confirmBtn !== addBtn) {
          confirmBtn.click();
          await sleep(500);
        }
      }
    }
    return true;
  }

  async function handleAddFullName(settings) {
    const addNameBtn = findButtonContaining('Add Full Name') || findButtonContaining('+ Add Full Name');
    if (addNameBtn) {
      addNameBtn.click();
      await sleep(500);
    }

    const nameInputs = document.querySelectorAll('input[type="text"], input:not([type]), textarea');
    for (const input of nameInputs) {
      const placeholder = (input.placeholder || '').toLowerCase();
      const label = (input.closest('label')?.textContent || input.getAttribute('aria-label') || '').toLowerCase();
      if (placeholder.includes('name') || label.includes('full name') || label.includes('name')) {
        if (!input.value && settings?.fullName) {
          input.focus();
          input.value = settings.fullName;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          await sleep(300);
          const saveBtn = findButtonContaining('Save') || findButtonContaining('Add') || findButtonContaining('Confirm');
          if (saveBtn) saveBtn.click();
          await sleep(500);
        }
        return true;
      }
    }

    const nameField = document.querySelector('[class*="full-name"], [data-field="fullName"]');
    if (nameField && settings?.fullName) {
      const input = nameField.querySelector('input') || nameField;
      if (input.tagName === 'INPUT') {
        input.value = settings.fullName;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
    return true;
  }

  async function handleAddFullAddress(settings) {
    const addAddrBtn = findButtonContaining('Add Full Address') || findButtonContaining('+ Add Full Address');
    if (addAddrBtn) {
      addAddrBtn.click();
      await sleep(500);
    }

    const addrInputs = document.querySelectorAll('input[type="text"], textarea');
    for (const input of addrInputs) {
      const placeholder = (input.placeholder || '').toLowerCase();
      const label = (input.closest('label')?.textContent || input.getAttribute('aria-label') || '').toLowerCase();
      if (placeholder.includes('address') || label.includes('address')) {
        if (!input.value && settings?.fullAddress) {
          input.focus();
          input.value = settings.fullAddress;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          await sleep(300);
          const saveBtn = findButtonContaining('Save') || findButtonContaining('Add') || findButtonContaining('Confirm');
          if (saveBtn) saveBtn.click();
          await sleep(500);
        }
        return true;
      }
    }
    return true;
  }

  async function submitDocument() {
    await sleep(500);
    const submitBtn = findButtonContaining('Submit Document');
    if (submitBtn && !submitBtn.disabled && !submitBtn.classList.contains('disabled')) {
      submitBtn.click();
      await sleep(1000);
      return true;
    }
    return false;
  }

  function getPendingItems() {
    const pending = [];
    const bodyText = document.body.innerText;
    if (/\+?\s*add signature/i.test(bodyText) && !document.querySelector('[class*="signature-complete"], .checkmark')) {
      const sigDone = document.querySelector('[class*="signature"] .check, fl-icon[name="check"]');
      if (!sigDone) pending.push('signature');
    }
    if (/\+?\s*add full name/i.test(bodyText)) pending.push('fullName');
    if (/\+?\s*add full address/i.test(bodyText)) pending.push('fullAddress');
    return pending;
  }

  async function completeDocumentSigning(settings) {
    if (!isDocumentSigningPage()) return { needed: false };

    const maxAttempts = 5;
    for (let i = 0; i < maxAttempts; i++) {
      const pending = getPendingItems();
      if (pending.includes('signature') || findButtonContaining('Add Signature')) {
        await handleAddSignature(settings);
      }
      if (pending.includes('fullName') || findButtonContaining('Add Full Name')) {
        await handleAddFullName(settings);
      }
      if (pending.includes('fullAddress') || findButtonContaining('Add Full Address')) {
        await handleAddFullAddress(settings);
      }
      await sleep(800);

      const submitted = await submitDocument();
      if (submitted) return { needed: true, success: true };

      const submitBtn = findButtonContaining('Submit Document');
      if (submitBtn && !submitBtn.disabled) {
        submitBtn.click();
        return { needed: true, success: true };
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

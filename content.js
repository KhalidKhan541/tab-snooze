(() => {
  'use strict';

  const SNOOZE_OVERLAY_ID = 'tabsnooze-overlay';

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'SAVE_STATE') {
      const state = captureState();
      sendResponse(state);
      return true;
    }

    if (msg.type === 'RESTORE_STATE') {
      restoreState(msg.state);
      sendResponse({ success: true });
      return true;
    }

    if (msg.type === 'SHOW_SNOOZED_OVERLAY') {
      showSnoozedOverlay(msg.restoreTime);
      sendResponse({ success: true });
      return true;
    }

    if (msg.type === 'HIDE_SNOOZED_OVERLAY') {
      hideSnoozedOverlay();
      sendResponse({ success: true });
      return true;
    }
  });

  function captureState() {
    const formData = {};
    const formElements = document.querySelectorAll('input, textarea, select');

    formElements.forEach(el => {
      const key = el.name || el.id || el.getAttribute('data-field');
      if (!key) return;
      if (el.type === 'submit' || el.type === 'button' || el.type === 'hidden') return;

      if (el.type === 'checkbox' || el.type === 'radio') {
        formData[key] = el.checked;
      } else if (el.tagName === 'SELECT') {
        const selectedOptions = Array.from(el.selectedOptions).map(o => o.value);
        formData[key] = el.multiple ? selectedOptions : el.value;
      } else {
        formData[key] = el.value;
      }
    });

    const scrollX = window.scrollX || window.pageXOffset || 0;
    const scrollY = window.scrollY || window.pageYOffset || 0;
    const scrollTop = document.documentElement.scrollTop || document.body.scrollTop || 0;
    const scrollLeft = document.documentElement.scrollLeft || document.body.scrollLeft || 0;

    const state = {
      scrollX,
      scrollY,
      scrollTop,
      scrollLeft,
      formData,
      documentHeight: document.documentElement.scrollHeight,
      documentWidth: document.documentElement.scrollWidth,
      title: document.title,
      url: location.href,
      timestamp: Date.now(),
    };

    try {
      sessionStorage.setItem('tabsnooze_state', JSON.stringify(state));
    } catch {}

    return state;
  }

  function restoreState(state) {
    if (!state) return;

    if (state.formData && Object.keys(state.formData).length > 0) {
      requestAnimationFrame(() => {
        Object.entries(state.formData).forEach(([key, value]) => {
          const el = document.querySelector(
            `[name="${CSS.escape(key)}"], [id="${CSS.escape(key)}"], [data-field="${CSS.escape(key)}"]`
          );
          if (!el) return;

          if (el.type === 'checkbox' || el.type === 'radio') {
            el.checked = !!value;
          } else if (el.tagName === 'SELECT' && Array.isArray(value)) {
            Array.from(el.options).forEach(opt => {
              opt.selected = value.includes(opt.value);
            });
          } else if (el.tagName === 'SELECT') {
            el.value = value;
          } else {
            el.value = value;
          }

          el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
          el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
          el.dispatchEvent(new Event('blur', { bubbles: true, cancelable: true }));
        });
      });
    }

    const x = state.scrollX || state.scrollLeft || 0;
    const y = state.scrollY || state.scrollTop || 0;

    if (x > 0 || y > 0) {
      let attempts = 0;
      const maxAttempts = 10;

      const scrollAttempt = () => {
        window.scrollTo(x, y);
        attempts++;

        if ((Math.abs(window.scrollX - x) > 2 || Math.abs(window.scrollY - y) > 2) && attempts < maxAttempts) {
          requestAnimationFrame(scrollAttempt);
        }
      };

      if (document.readyState === 'complete') {
        requestAnimationFrame(scrollAttempt);
      } else {
        window.addEventListener('load', () => requestAnimationFrame(scrollAttempt), { once: true });
      }
    }

    try {
      sessionStorage.removeItem('tabsnooze_state');
    } catch {}
  }

  function showSnoozedOverlay(restoreTime) {
    hideSnoozedOverlay();

    const overlay = document.createElement('div');
    overlay.id = SNOOZE_OVERLAY_ID;
    overlay.innerHTML = `
      <div style="
        position: fixed; inset: 0; z-index: 2147483647;
        background: rgba(26, 26, 46, 0.92);
        display: flex; align-items: center; justify-content: center;
        font-family: 'Segoe UI', system-ui, sans-serif;
        cursor: default; user-select: none;
      ">
        <div style="text-align: center; color: #E8E8E8;">
          <div style="font-size: 64px; margin-bottom: 16px;">💤</div>
          <h2 style="font-size: 24px; font-weight: 600; margin-bottom: 8px; color: #FFFFFF;">
            Tab Snoozed
          </h2>
          <p style="font-size: 14px; color: #9A9AB0; margin-bottom: 4px;">
            This tab has been frozen to save memory
          </p>
          <p id="tabsnooze-restore-time" style="font-size: 16px; color: #A29BFE; font-weight: 600;">
            ${restoreTime ? formatRestoreTime(restoreTime) : ''}
          </p>
        </div>
      </div>
    `;

    document.documentElement.appendChild(overlay);
  }

  function hideSnoozedOverlay() {
    const existing = document.getElementById(SNOOZE_OVERLAY_ID);
    if (existing) existing.remove();
  }

  function formatRestoreTime(timestamp) {
    const diff = timestamp - Date.now();
    if (diff <= 0) return 'Restoring soon...';

    const hours = Math.floor(diff / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);

    if (hours > 0) return `Restores in ${hours}h ${minutes}m`;
    return `Restores in ${minutes}m`;
  }

  // Restore state from sessionStorage on page load
  try {
    const saved = sessionStorage.getItem('tabsnooze_state');
    if (saved) {
      const state = JSON.parse(saved);
      if (state && (Date.now() - state.timestamp) < 300000) {
        restoreState(state);
      } else {
        sessionStorage.removeItem('tabsnooze_state');
      }
    }
  } catch {}

  // Capture state before unload
  window.addEventListener('beforeunload', () => {
    try {
      const state = captureState();
      sessionStorage.setItem('tabsnooze_state', JSON.stringify(state));
    } catch {}
  });

  // Page lifecycle events
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      chrome.runtime.sendMessage({ type: 'TAB_VISIBLE', tabId: null }).catch(() => {});
    }
  });
})();

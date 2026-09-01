document.addEventListener('DOMContentLoaded', async () => {
  initTabs();
  initQuickActions();
  initBulkActions();
  initSettings();
  initWhitelist();
  await loadCurrentTab();
  await loadSnoozedTabs();
  await loadStats();
  startCountdowns();
});

function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    });
  });
}

function initQuickActions() {
  document.querySelectorAll('[data-snooze]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const duration = btn.dataset.snooze;
      const tab = await sendMsg({ type: 'GET_CURRENT_TAB' });
      if (!tab?.id) return showToast('No active tab', true);

      const result = await sendMsg({ type: 'SNOOZE_TAB', tabId: tab.id, duration: parseDuration(duration) });
      if (result?.success) {
        showToast('Tab snoozed!');
        await loadSnoozedTabs();
        await loadCurrentTab();
      } else {
        showToast(result?.error || 'Failed to snooze', true);
      }
    });
  });
}

function initBulkActions() {
  document.getElementById('snoozeAllInactive').addEventListener('click', async () => {
    const result = await sendMsg({ type: 'SNOOZE_ALL_INACTIVE' });
    if (result?.success) {
      showToast(`Snoozed ${result.count} tabs`);
      await loadSnoozedTabs();
    }
  });

  document.getElementById('snoozeExceptCurrent').addEventListener('click', async () => {
    const result = await sendMsg({ type: 'SNOOZE_EXCEPT_CURRENT' });
    if (result?.success) {
      showToast(`Snoozed ${result.count} tabs`);
      await loadSnoozedTabs();
    }
  });

  document.getElementById('restoreAllBtn').addEventListener('click', async () => {
    const result = await sendMsg({ type: 'RESTORE_ALL' });
    if (result?.success) {
      showToast(`Restored ${result.count} tabs`);
      await loadSnoozedTabs();
    }
  });
}

async function loadCurrentTab() {
  const tab = await sendMsg({ type: 'GET_CURRENT_TAB' });
  const card = document.getElementById('currentTabCard');
  const title = document.getElementById('currentTabTitle');
  const url = document.getElementById('currentTabUrl');
  const favicon = document.getElementById('currentTabFavicon');

  if (tab) {
    title.textContent = tab.title || 'Untitled';
    url.textContent = tab.url || '';
    if (tab.favIconUrl) {
      favicon.src = tab.favIconUrl;
      favicon.style.display = 'block';
    } else {
      favicon.style.display = 'none';
    }
  } else {
    title.textContent = 'No tab selected';
    url.textContent = '';
    favicon.style.display = 'none';
  }
}

async function loadSnoozedTabs() {
  const tabs = await sendMsg({ type: 'GET_SNOOZED_TABS' }) || [];
  const snoozedCount = document.getElementById('snoozedCount');
  snoozedCount.textContent = tabs.length;

  renderSnoozedList('recentSnoozed', tabs.slice(-5).reverse());
  renderSnoozedList('snoozedList', tabs.slice().reverse());
}

function renderSnoozedList(containerId, tabs) {
  const container = document.getElementById(containerId);
  if (!tabs || tabs.length === 0) {
    container.innerHTML = '<p class="empty-state">No snoozed tabs</p>';
    return;
  }

  container.innerHTML = tabs.map(tab => {
    const remaining = tab.restoreTime - Date.now();
    const timerText = formatRemaining(remaining);
    const faviconHtml = tab.favicon
      ? `<img class="favicon" src="${escapeHtml(tab.favicon)}" alt="">`
      : `<div class="favicon" style="background:var(--bg-input);border-radius:3px;width:20px;height:20px;"></div>`;

    return `
      <div class="snoozed-item" data-tab-id="${tab.id}">
        ${faviconHtml}
        <div class="snoozed-item-info">
          <div class="snoozed-item-title">${escapeHtml(tab.title || 'Untitled')}</div>
          <div class="snoozed-item-url">${escapeHtml(truncateUrl(tab.url || ''))}</div>
        </div>
        <div class="snoozed-item-timer" data-restore="${tab.restoreTime}">${timerText}</div>
        <div class="snoozed-item-actions">
          <button class="restore-btn" data-action="restore" data-tab-id="${tab.id}" title="Restore">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
          </button>
          <button class="close-btn" data-action="close" data-tab-id="${tab.id}" title="Close permanently">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const tabId = parseInt(btn.dataset.tabId, 10);
      const action = btn.dataset.action;

      if (action === 'restore') {
        const result = await sendMsg({ type: 'RESTORE_TAB', tabId });
        if (result?.success) {
          showToast('Tab restored');
          await loadSnoozedTabs();
        } else {
          showToast(result?.error || 'Failed to restore', true);
        }
      } else if (action === 'close') {
        const result = await sendMsg({ type: 'CLOSE_TAB', tabId });
        if (result?.success) {
          showToast('Tab closed');
          await loadSnoozedTabs();
        }
      }
    });
  });
}

function startCountdowns() {
  setInterval(async () => {
    const timers = document.querySelectorAll('.snoozed-item-timer');
    timers.forEach(el => {
      const restoreTime = parseInt(el.dataset.restore, 10);
      const remaining = restoreTime - Date.now();
      el.textContent = formatRemaining(remaining);

      if (remaining <= 0) {
        loadSnoozedTabs();
      }
    });
  }, 10000);
}

function initSettings() {
  const autoToggle = document.getElementById('autoSnoozeToggle');
  const timeoutSelect = document.getElementById('inactivityTimeout');
  const customRow = document.getElementById('customTimeoutRow');
  const customInput = document.getElementById('customTimeout');
  const skipAudio = document.getElementById('skipAudio');
  const skipPinned = document.getElementById('skipPinned');
  const skipFormData = document.getElementById('skipFormData');
  const workHoursEnabled = document.getElementById('workHoursEnabled');
  const workHoursRow = document.getElementById('workHoursRow');
  const workStart = document.getElementById('workStart');
  const workEnd = document.getElementById('workEnd');

  chrome.storage.local.get([
    'autoSnoozeEnabled', 'inactivityTimeout', 'customTimeout',
    'skipAudio', 'skipPinned', 'skipFormData',
    'workHoursEnabled', 'workStart', 'workEnd',
  ], (data) => {
    autoToggle.checked = data.autoSnoozeEnabled !== false;
    timeoutSelect.value = data.inactivityTimeout || 15;
    customInput.value = data.customTimeout || 20;
    skipAudio.checked = data.skipAudio !== false;
    skipPinned.checked = data.skipPinned !== false;
    skipFormData.checked = data.skipFormData !== false;
    workHoursEnabled.checked = !!data.workHoursEnabled;
    workStart.value = data.workStart || '09:00';
    workEnd.value = data.workEnd || '17:00';

    customRow.classList.toggle('hidden', timeoutSelect.value !== 'custom');
    workHoursRow.classList.toggle('hidden', !workHoursEnabled.checked);
  });

  autoToggle.addEventListener('change', () => {
    chrome.storage.local.set({ autoSnoozeEnabled: autoToggle.checked });
  });

  timeoutSelect.addEventListener('change', () => {
    chrome.storage.local.set({ inactivityTimeout: timeoutSelect.value });
    customRow.classList.toggle('hidden', timeoutSelect.value !== 'custom');
  });

  customInput.addEventListener('change', () => {
    chrome.storage.local.set({ customTimeout: parseInt(customInput.value, 10) || 15 });
  });

  skipAudio.addEventListener('change', () => {
    chrome.storage.local.set({ skipAudio: skipAudio.checked });
  });

  skipPinned.addEventListener('change', () => {
    chrome.storage.local.set({ skipPinned: skipPinned.checked });
  });

  skipFormData.addEventListener('change', () => {
    chrome.storage.local.set({ skipFormData: skipFormData.checked });
  });

  workHoursEnabled.addEventListener('change', () => {
    chrome.storage.local.set({ workHoursEnabled: workHoursEnabled.checked });
    workHoursRow.classList.toggle('hidden', !workHoursEnabled.checked);
  });

  workStart.addEventListener('change', () => {
    chrome.storage.local.set({ workStart: workStart.value });
  });

  workEnd.addEventListener('change', () => {
    chrome.storage.local.set({ workEnd: workEnd.value });
  });

  document.getElementById('resetStats').addEventListener('click', async () => {
    await sendMsg({ type: 'RESET_STATS' });
    await loadStats();
    showToast('Statistics reset');
  });
}

async function initWhitelist() {
  await renderWhitelist();

  document.getElementById('addWhitelistBtn').addEventListener('click', async () => {
    const input = document.getElementById('whitelistInput');
    const domain = input.value.trim();
    if (!domain) return;

    const added = await Whitelist.addDomain(domain);
    if (added) {
      input.value = '';
      await renderWhitelist();
      showToast(`Added ${domain}`);
    } else {
      showToast('Already in whitelist or invalid', true);
    }
  });

  document.getElementById('whitelistInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      document.getElementById('addWhitelistBtn').click();
    }
  });

  document.querySelectorAll('#whitelistPresets .chip').forEach(chip => {
    chip.addEventListener('click', async () => {
      const domain = chip.dataset.domain;
      const list = await Whitelist.getWhitelist();
      if (list.includes(domain)) {
        await Whitelist.removeDomain(domain);
        chip.classList.remove('active');
        showToast(`Removed ${domain}`);
      } else {
        await Whitelist.addDomain(domain);
        chip.classList.add('active');
        showToast(`Added ${domain}`);
      }
      await renderWhitelist();
    });
  });

  document.getElementById('exportWhitelist').addEventListener('click', async () => {
    const json = await Whitelist.exportWhitelist();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tabsnooze-whitelist.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Whitelist exported');
  });

  document.getElementById('importWhitelist').addEventListener('click', () => {
    document.getElementById('importWhitelistFile').click();
  });

  document.getElementById('importWhitelistFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const text = await file.text();
    const success = await Whitelist.importWhitelist(text);
    if (success) {
      await renderWhitelist();
      showToast('Whitelist imported');
    } else {
      showToast('Invalid whitelist file', true);
    }
    e.target.value = '';
  });
}

async function renderWhitelist() {
  const list = await Whitelist.getWhitelist();
  const container = document.getElementById('whitelistItems');
  const presets = Whitelist.getPresets();

  document.querySelectorAll('#whitelistPresets .chip').forEach(chip => {
    chip.classList.toggle('active', list.includes(chip.dataset.domain));
  });

  container.innerHTML = list.map(domain => `
    <div class="whitelist-item">
      <span>${escapeHtml(domain)}</span>
      <button data-remove="${escapeHtml(domain)}" title="Remove">&times;</button>
    </div>
  `).join('');

  container.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await Whitelist.removeDomain(btn.dataset.remove);
      await renderWhitelist();
      showToast(`Removed ${btn.dataset.remove}`);
    });
  });
}

async function loadStats() {
  const stats = await sendMsg({ type: 'GET_STATS' });
  if (!stats) return;

  document.getElementById('statMemorySaved').textContent = `${stats.memorySaved || 0} MB`;
  document.getElementById('statTabsToday').textContent = stats.todaySnoozed || 0;
  document.getElementById('statTabsAllTime').textContent = stats.totalSnoozed || 0;

  const topSites = document.getElementById('topSites');
  const siteCounts = stats.siteCounts || {};
  const sorted = Object.entries(siteCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  if (sorted.length === 0) {
    topSites.innerHTML = '<p class="empty-state">No data yet</p>';
  } else {
    const maxCount = sorted[0][1];
    topSites.innerHTML = sorted.map(([name, count]) => `
      <div class="top-site-item">
        <div class="top-site-bar" style="width: ${Math.max(10, (count / maxCount) * 100)}px"></div>
        <span class="top-site-name">${escapeHtml(name)}</span>
        <span class="top-site-count">${count}</span>
      </div>
    `).join('');
  }
}

function parseDuration(value) {
  if (value === 'tomorrow' || value === 'nextweek') return value;
  return parseInt(value, 10);
}

function formatRemaining(ms) {
  if (ms <= 0) return 'Restoring...';

  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function truncateUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname + (u.pathname.length > 30 ? u.pathname.slice(0, 30) + '...' : u.pathname);
  } catch {
    return url;
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showToast(message, isError = false) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast${isError ? ' error' : ''}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

function sendMsg(msg) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage(msg, resolve);
  });
}

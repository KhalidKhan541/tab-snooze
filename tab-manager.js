const TabManager = (() => {
  const STORAGE_KEY = 'snoozedTabs';
  const STATS_KEY = 'stats';
  const ACTIVITY_KEY = 'tabActivity';
  const STATE_KEY = 'tabStates';

  const ESTIMATED_MEMORY_MB = 50;

  // Snoozed tab structure: { id, url, title, favicon, snoozeTime, restoreTime, state }

  async function getSnoozedTabs() {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    return data[STORAGE_KEY] || [];
  }

  async function saveSnoozedTabs(tabs) {
    await chrome.storage.local.set({ [STORAGE_KEY]: tabs });
  }

  async function getSnoozedTab(tabId) {
    const tabs = await getSnoozedTabs();
    return tabs.find(t => t.id === tabId) || null;
  }

  async function getSnoozedByAlarmName(alarmName) {
    if (!alarmName.startsWith('snooze_')) return null;
    const tabId = parseInt(alarmName.replace('snooze_', ''), 10);
    const tabs = await getSnoozedTabs();
    return tabs.find(t => t.id === tabId) || null;
  }

  async function snoozeTab(tabId, restoreTimeMs, url, title, favicon) {
    const tabs = await getSnoozedTabs();
    const existing = tabs.findIndex(t => t.id === tabId);
    if (existing >= 0) tabs.splice(existing, 1);

    const snoozeEntry = {
      id: tabId,
      url: url || '',
      title: title || 'Untitled',
      favicon: favicon || '',
      snoozeTime: Date.now(),
      restoreTime: restoreTimeMs,
      state: null,
    };

    tabs.push(snoozeEntry);
    await saveSnoozedTabs(tabs);

    chrome.alarms.create(`snooze_${tabId}`, {
      when: restoreTimeMs,
    });

    await recordStats(tabId, url);
    return snoozeEntry;
  }

  async function restoreTab(tabId) {
    const tabs = await getSnoozedTabs();
    const idx = tabs.findIndex(t => t.id === tabId);
    if (idx < 0) return null;

    const snoozed = tabs[idx];
    tabs.splice(idx, 1);
    await saveSnoozedTabs(tabs);

    chrome.alarms.clear(`snooze_${tabId}`);

    return snoozed;
  }

  async function restoreAllTabs() {
    const tabs = await getSnoozedTabs();
    const results = [];
    for (const tab of tabs) {
      chrome.alarms.clear(`snooze_${tab.id}`);
      results.push(tab);
    }
    await saveSnoozedTabs([]);
    return results;
  }

  async function removeTab(tabId) {
    const tabs = await getSnoozedTabs();
    const idx = tabs.findIndex(t => t.id === tabId);
    if (idx >= 0) {
      tabs.splice(idx, 1);
      await saveSnoozedTabs(tabs);
    }
    chrome.alarms.clear(`snooze_${tabId}`);
  }

  async function discardTab(tabId) {
    try {
      await chrome.tabs.discard(tabId);
      return true;
    } catch (e) {
      console.warn(`Failed to discard tab ${tabId}:`, e.message);
      return false;
    }
  }

  async function captureTabState(tabId) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const formData = {};
          document.querySelectorAll('input, textarea, select').forEach(el => {
            const key = el.name || el.id || el.getAttribute('data-field');
            if (!key) return;
            if (el.type === 'checkbox' || el.type === 'radio') {
              formData[key] = el.checked;
            } else if (el.tagName === 'SELECT') {
              formData[key] = el.value;
            } else {
              formData[key] = el.value;
            }
          });

          return {
            scrollX: window.scrollX,
            scrollY: window.scrollY,
            scrollTop: document.documentElement.scrollTop || document.body.scrollTop,
            scrollLeft: document.documentElement.scrollLeft || document.body.scrollLeft,
            formData,
            documentHeight: document.documentElement.scrollHeight,
            documentWidth: document.documentElement.scrollWidth,
            title: document.title,
            url: location.href,
          };
        },
      });
      return results?.[0]?.result || null;
    } catch (e) {
      console.warn(`Failed to capture state for tab ${tabId}:`, e.message);
      return null;
    }
  }

  async function saveTabState(tabId, state) {
    const data = await chrome.storage.session.get(STATE_KEY);
    const states = data[STATE_KEY] || {};
    states[tabId] = state;
    await chrome.storage.session.set({ [STATE_KEY]: states });
  }

  async function getTabState(tabId) {
    const data = await chrome.storage.session.get(STATE_KEY);
    const states = data[STATE_KEY] || {};
    return states[tabId] || null;
  }

  async function clearTabState(tabId) {
    const data = await chrome.storage.session.get(STATE_KEY);
    const states = data[STATE_KEY] || {};
    delete states[tabId];
    await chrome.storage.session.set({ [STATE_KEY]: states });
  }

  async function restoreTabState(tabId) {
    const state = await getTabState(tabId);
    if (!state) return;

    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: (savedState) => {
          window.scrollTo(savedState.scrollX || 0, savedState.scrollY || 0);

          if (savedState.formData) {
            Object.entries(savedState.formData).forEach(([key, value]) => {
              const el = document.querySelector(`[name="${key}"], [id="${key}"], [data-field="${key}"]`);
              if (!el) return;
              if (el.type === 'checkbox' || el.type === 'radio') {
                el.checked = value;
              } else if (el.tagName === 'SELECT') {
                el.value = value;
              } else {
                el.value = value;
              }
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            });
          }
        },
        args: [state],
      });
      await clearTabState(tabId);
    } catch (e) {
      console.warn(`Failed to restore state for tab ${tabId}:`, e.message);
    }
  }

  async function getActivity() {
    const data = await chrome.storage.session.get(ACTIVITY_KEY);
    return data[ACTIVITY_KEY] || {};
  }

  async function updateActivity(tabId) {
    const activity = await getActivity();
    activity[tabId] = Date.now();
    await chrome.storage.session.set({ [ACTIVITY_KEY]: activity });
  }

  async function removeActivity(tabId) {
    const activity = await getActivity();
    delete activity[tabId];
    await chrome.storage.session.set({ [ACTIVITY_KEY]: activity });
  }

  async function getInactiveTabs(timeoutMinutes) {
    const activity = await getActivity();
    const now = Date.now();
    const threshold = now - (timeoutMinutes * 60 * 1000);

    const tabs = await chrome.tabs.query({});
    return tabs.filter(tab => {
      if (!tab.id || tab.active || tab.pinned) return false;
      if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('chrome-extension://')) return false;
      if (tab.audible) return false;

      const lastActivity = activity[tab.id] || tab.lastAccessed || 0;
      return lastActivity < threshold;
    });
  }

  async function hasFormData(tabId) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const inputs = document.querySelectorAll('input, textarea, select');
          for (const el of inputs) {
            if (el.type === 'submit' || el.type === 'button' || el.type === 'hidden') continue;
            if (el.tagName === 'SELECT' && el.options.length > 1) return true;
            if ((el.type === 'checkbox' || el.type === 'radio') && el.checked) return true;
            if (el.value && el.value.trim().length > 0) return true;
          }
          return false;
        },
      });
      return results?.[0]?.result || false;
    } catch {
      return false;
    }
  }

  async function recordStats(tabId, url) {
    const data = await chrome.storage.local.get(STATS_KEY);
    const stats = data[STATS_KEY] || {
      totalSnoozed: 0,
      todaySnoozed: 0,
      todayDate: new Date().toDateString(),
      memorySaved: 0,
      siteCounts: {},
    };

    const today = new Date().toDateString();
    if (stats.todayDate !== today) {
      stats.todaySnoozed = 0;
      stats.todayDate = today;
    }

    stats.totalSnoozed++;
    stats.todaySnoozed++;
    stats.memorySaved += ESTIMATED_MEMORY_MB;

    if (url) {
      try {
        const hostname = new URL(url).hostname;
        stats.siteCounts[hostname] = (stats.siteCounts[hostname] || 0) + 1;
      } catch {}
    }

    await chrome.storage.local.set({ [STATS_KEY]: stats });
  }

  async function getStats() {
    const data = await chrome.storage.local.get(STATS_KEY);
    const stats = data[STATS_KEY] || {
      totalSnoozed: 0,
      todaySnoozed: 0,
      todayDate: new Date().toDateString(),
      memorySaved: 0,
      siteCounts: {},
    };

    const today = new Date().toDateString();
    if (stats.todayDate !== today) {
      stats.todaySnoozed = 0;
    }

    return stats;
  }

  async function resetStats() {
    await chrome.storage.local.set({
      [STATS_KEY]: {
        totalSnoozed: 0,
        todaySnoozed: 0,
        todayDate: new Date().toDateString(),
        memorySaved: 0,
        siteCounts: {},
      },
    });
  }

  async function getSnoozedCount() {
    const tabs = await getSnoozedTabs();
    return tabs.length;
  }

  async function updateBadge() {
    const count = await getSnoozedCount();
    chrome.action.setBadgeText({
      text: count > 0 ? String(count) : '',
    });
    chrome.action.setBadgeBackgroundColor({ color: '#6C5CE7' });
  }

  return {
    getSnoozedTabs,
    getSnoozedTab,
    getSnoozedByAlarmName,
    snoozeTab,
    restoreTab,
    restoreAllTabs,
    removeTab,
    discardTab,
    captureTabState,
    saveTabState,
    getTabState,
    clearTabState,
    restoreTabState,
    getActivity,
    updateActivity,
    removeActivity,
    getInactiveTabs,
    hasFormData,
    getStats,
    resetStats,
    getSnoozedCount,
    updateBadge,
  };
})();

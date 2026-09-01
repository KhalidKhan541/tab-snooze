importScripts('whitelist.js', 'tab-manager.js');

chrome.runtime.onInstalled.addListener(async () => {
  const defaults = {
    autoSnoozeEnabled: true,
    inactivityTimeout: 15,
    skipAudio: true,
    skipPinned: true,
    skipFormData: true,
    workHoursEnabled: false,
    workStart: '09:00',
    workEnd: '17:00',
  };

  const data = await chrome.storage.local.get(Object.keys(defaults));
  const toSet = {};
  for (const [key, val] of Object.entries(defaults)) {
    if (data[key] === undefined) toSet[key] = val;
  }
  if (Object.keys(toSet).length > 0) {
    await chrome.storage.local.set(toSet);
  }

  await TabManager.updateBadge();
  await restoreSessionTabs();
});

chrome.runtime.onStartup.addListener(async () => {
  await restoreSessionTabs();
  await TabManager.updateBadge();
});

async function restoreSessionTabs() {
  const snoozed = await TabManager.getSnoozedTabs();
  const now = Date.now();

  for (const tab of snoozed) {
    if (tab.restoreTime <= now) {
      try {
        await chrome.tabs.update(tab.id, { autoDiscardable: true });
        await TabManager.restoreTab(tab.id);
        await TabManager.restoreTabState(tab.id);
      } catch (e) {
        console.warn(`Failed to restore tab ${tab.id} on startup:`, e.message);
        await TabManager.removeTab(tab.id);
      }
    }
  }
}

// Single consolidated alarm listener
chrome.alarms.onAlarm.addListener(async (alarm) => {
  // Handle snooze timer alarms
  if (alarm.name.startsWith('snooze_')) {
    const tabId = parseInt(alarm.name.replace('snooze_', ''), 10);
    const snoozed = await TabManager.getSnoozedTab(tabId);

    if (!snoozed) {
      chrome.alarms.clear(alarm.name);
      return;
    }

    try {
      const tab = await chrome.tabs.get(tabId);
      await chrome.tabs.update(tabId, {
        active: true,
        autoDiscardable: true,
      });

      if (tab.windowId) {
        await chrome.windows.update(tab.windowId, { focused: true });
      }

      await TabManager.restoreTab(tabId);
      await TabManager.restoreTabState(tabId);
    } catch (e) {
      console.warn(`Failed to restore tab ${tabId}:`, e.message);
      await TabManager.removeTab(tabId);
    }

    await TabManager.updateBadge();
    return;
  }

  // Handle auto-snooze check
  if (alarm.name === 'autoSnoozeCheck') {
    const settings = await chrome.storage.local.get([
      'autoSnoozeEnabled', 'inactivityTimeout', 'customTimeout',
      'skipAudio', 'skipPinned', 'skipFormData',
    ]);

    if (!settings.autoSnoozeEnabled) return;
    if (await Whitelist.isTimeWhitelisted()) return;

    const timeout = settings.inactivityTimeout === 'custom'
      ? (settings.customTimeout || 15)
      : settings.inactivityTimeout;

    const inactiveTabs = await TabManager.getInactiveTabs(timeout);

    for (const tab of inactiveTabs) {
      if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('chrome-extension://')) continue;
      if (tab.url?.startsWith('about:')) continue;
      if (await Whitelist.isWhitelisted(tab.url)) continue;
      if (settings.skipAudio && tab.audible) continue;
      if (settings.skipPinned && tab.pinned) continue;

      if (settings.skipFormData) {
        const hasForm = await TabManager.hasFormData(tab.id);
        if (hasForm) continue;
      }

      const state = await TabManager.captureTabState(tab.id);
      if (state) {
        await TabManager.saveTabState(tab.id, state);
      }

      const restoreTime = Date.now() + (timeout * 60 * 1000);
      await TabManager.snoozeTab(tab.id, restoreTime, tab.url, tab.title, tab.favIconUrl);

      const discarded = await TabManager.discardTab(tab.id);
      if (!discarded) {
        await TabManager.restoreTab(tab.id);
        await TabManager.removeTab(tab.id);
      }

      await TabManager.updateBadge();
    }
  }
});

// Track tab activity
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  await TabManager.updateActivity(activeInfo.tabId);

  // If user clicks a snoozed tab, restore it immediately
  const snoozed = await TabManager.getSnoozedTab(activeInfo.tabId);
  if (snoozed) {
    try {
      await chrome.tabs.update(activeInfo.tabId, { autoDiscardable: true });
      await TabManager.restoreTab(activeInfo.tabId);
      await TabManager.restoreTabState(activeInfo.tabId);
      await TabManager.updateBadge();
    } catch {}
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' || changeInfo.url) {
    await TabManager.updateActivity(tabId);
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await TabManager.removeActivity(tabId);
  const snoozed = await TabManager.getSnoozedTab(tabId);
  if (snoozed) {
    await TabManager.removeTab(tabId);
    await TabManager.updateBadge();
  }
});

// Auto-check alarm - runs every minute to find inactive tabs
chrome.alarms.create('autoSnoozeCheck', { periodInMinutes: 1 });

// Message handlers from popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'SNOOZE_TAB') {
    handleSnoozeTab(msg.tabId, msg.duration).then(sendResponse);
    return true;
  }

  if (msg.type === 'RESTORE_TAB') {
    handleRestoreTab(msg.tabId).then(sendResponse);
    return true;
  }

  if (msg.type === 'RESTORE_ALL') {
    handleRestoreAll().then(sendResponse);
    return true;
  }

  if (msg.type === 'CLOSE_TAB') {
    handleCloseTab(msg.tabId).then(sendResponse);
    return true;
  }

  if (msg.type === 'SNOOZE_ALL_INACTIVE') {
    handleSnoozeAllInactive().then(sendResponse);
    return true;
  }

  if (msg.type === 'SNOOZE_EXCEPT_CURRENT') {
    handleSnoozeExceptCurrent().then(sendResponse);
    return true;
  }

  if (msg.type === 'GET_CURRENT_TAB') {
    handleGetCurrentTab().then(sendResponse);
    return true;
  }

  if (msg.type === 'GET_SNOOZED_TABS') {
    TabManager.getSnoozedTabs().then(sendResponse);
    return true;
  }

  if (msg.type === 'GET_STATS') {
    TabManager.getStats().then(sendResponse);
    return true;
  }

  if (msg.type === 'RESET_STATS') {
    TabManager.resetStats().then(sendResponse);
    return true;
  }
});

async function handleSnoozeTab(tabId, durationMinutes) {
  try {
    const tab = await chrome.tabs.get(tabId);
    const state = await TabManager.captureTabState(tabId);
    if (state) await TabManager.saveTabState(tabId, state);

    let restoreTime;
    if (durationMinutes === 'tomorrow') {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(9, 0, 0, 0);
      restoreTime = tomorrow.getTime();
    } else if (durationMinutes === 'nextweek') {
      const nextWeek = new Date();
      nextWeek.setDate(nextWeek.getDate() + 7);
      nextWeek.setHours(9, 0, 0, 0);
      restoreTime = nextWeek.getTime();
    } else {
      restoreTime = Date.now() + (durationMinutes * 60 * 1000);
    }

    await TabManager.snoozeTab(tabId, restoreTime, tab.url, tab.title, tab.favIconUrl);

    const discarded = await TabManager.discardTab(tabId);
    if (!discarded) {
      await TabManager.restoreTab(tabId);
      return { success: false, error: 'Could not discard tab' };
    }

    await TabManager.updateBadge();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function handleRestoreTab(tabId) {
  try {
    const snoozed = await TabManager.restoreTab(tabId);
    if (!snoozed) return { success: false, error: 'Tab not found in snoozed list' };

    await chrome.tabs.update(tabId, { active: true, autoDiscardable: true });

    const tab = await chrome.tabs.get(tabId);
    if (tab.windowId) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }

    await TabManager.restoreTabState(tabId);
    await TabManager.updateBadge();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function handleRestoreAll() {
  const restored = await TabManager.restoreAllTabs();
  for (const snoozed of restored) {
    try {
      await chrome.tabs.update(snoozed.id, { active: true, autoDiscardable: true });
      await TabManager.restoreTabState(snoozed.id);
    } catch {}
  }
  await TabManager.updateBadge();
  return { success: true, count: restored.length };
}

async function handleCloseTab(tabId) {
  try {
    await TabManager.removeTab(tabId);
    await chrome.tabs.remove(tabId);
    await TabManager.updateBadge();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function handleSnoozeAllInactive() {
  const settings = await chrome.storage.local.get(['inactivityTimeout', 'customTimeout']);
  const timeout = settings.inactivityTimeout === 'custom'
    ? (settings.customTimeout || 15)
    : settings.inactivityTimeout;

  const inactive = await TabManager.getInactiveTabs(timeout);
  let count = 0;

  for (const tab of inactive) {
    if (await Whitelist.isWhitelisted(tab.url)) continue;

    const state = await TabManager.captureTabState(tab.id);
    if (state) await TabManager.saveTabState(tab.id, state);

    const restoreTime = Date.now() + (timeout * 60 * 1000);
    await TabManager.snoozeTab(tab.id, restoreTime, tab.url, tab.title, tab.favIconUrl);

    const discarded = await TabManager.discardTab(tab.id);
    if (discarded) {
      count++;
    } else {
      await TabManager.restoreTab(tab.id);
    }
  }

  await TabManager.updateBadge();
  return { success: true, count };
}

async function handleSnoozeExceptCurrent() {
  const settings = await chrome.storage.local.get(['inactivityTimeout', 'customTimeout']);
  const timeout = settings.inactivityTimeout === 'custom'
    ? (settings.customTimeout || 15)
    : settings.inactivityTimeout;

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab) return { success: false, error: 'No active tab' };

  const allTabs = await chrome.tabs.query({});
  const toSnooze = allTabs.filter(t =>
    t.id !== activeTab.id &&
    !t.pinned &&
    !t.url?.startsWith('chrome://') &&
    !t.url?.startsWith('chrome-extension://') &&
    !t.url?.startsWith('about:')
  );

  let count = 0;
  for (const tab of toSnooze) {
    if (await Whitelist.isWhitelisted(tab.url)) continue;

    const state = await TabManager.captureTabState(tab.id);
    if (state) await TabManager.saveTabState(tab.id, state);

    const restoreTime = Date.now() + (timeout * 60 * 1000);
    await TabManager.snoozeTab(tab.id, restoreTime, tab.url, tab.title, tab.favIconUrl);

    const discarded = await TabManager.discardTab(tab.id);
    if (discarded) {
      count++;
    } else {
      await TabManager.restoreTab(tab.id);
    }
  }

  await TabManager.updateBadge();
  return { success: true, count };
}

async function handleGetCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab || null;
  } catch {
    return null;
  }
}

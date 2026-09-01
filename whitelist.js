const Whitelist = (() => {
  const PRESETS = {
    'docs.google.com': 'Google Docs',
    'sheets.google.com': 'Google Sheets',
    'slides.google.com': 'Google Slides',
    'drive.google.com': 'Google Drive',
    'spotify.com': 'Spotify',
    'open.spotify.com': 'Spotify Web',
    'youtube.com': 'YouTube',
    'music.youtube.com': 'YouTube Music',
    'meet.google.com': 'Google Meet',
    'zoom.us': 'Zoom',
    'teams.microsoft.com': 'Microsoft Teams',
    'web.whatsapp.com': 'WhatsApp Web',
    'web.telegram.org': 'Telegram Web',
    'discord.com': 'Discord',
    'soundcloud.com': 'SoundCloud',
  };

  const DEFAULT_WHITELIST = [
    'docs.google.com',
    'sheets.google.com',
    'slides.google.com',
    'meet.google.com',
    'spotify.com',
    'youtube.com',
    'music.youtube.com',
  ];

  async function getWhitelist() {
    const data = await chrome.storage.local.get('whitelist');
    return data.whitelist || [...DEFAULT_WHITELIST];
  }

  async function saveWhitelist(list) {
    await chrome.storage.local.set({ whitelist: list });
  }

  async function addDomain(domain) {
    const list = await getWhitelist();
    const normalized = domain.toLowerCase().trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!normalized || list.includes(normalized)) return false;
    list.push(normalized);
    await saveWhitelist(list);
    return true;
  }

  async function removeDomain(domain) {
    let list = await getWhitelist();
    list = list.filter(d => d !== domain);
    await saveWhitelist(list);
  }

  async function isWhitelisted(url) {
    const list = await getWhitelist();
    try {
      const hostname = new URL(url).hostname;
      return list.some(pattern => matchDomain(hostname, pattern));
    } catch {
      return false;
    }
  }

  function matchDomain(hostname, pattern) {
    const h = hostname.toLowerCase();
    const p = pattern.toLowerCase();

    if (p.startsWith('*.')) {
      const base = p.slice(2);
      return h === base || h.endsWith('.' + base);
    }

    return h === p || h.endsWith('.' + p);
  }

  function matchURLPattern(url, pattern) {
    try {
      const urlObj = new URL(url);
      const p = pattern.toLowerCase();

      if (p.includes('/')) {
        const domainPart = p.split('/')[0];
        const pathPart = p.slice(domainPart.length);
        return matchDomain(urlObj.hostname, domainPart) &&
               urlObj.pathname.toLowerCase().startsWith(pathPart);
      }

      return matchDomain(urlObj.hostname, p);
    } catch {
      return false;
    }
  }

  async function isTimeWhitelisted() {
    const data = await chrome.storage.local.get(['workHoursEnabled', 'workStart', 'workEnd']);
    if (!data.workHoursEnabled) return false;

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const [startH, startM] = (data.workStart || '09:00').split(':').map(Number);
    const [endH, endM] = (data.workEnd || '17:00').split(':').map(Number);

    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  }

  function getPresets() {
    return { ...PRESETS };
  }

  async function exportWhitelist() {
    const list = await getWhitelist();
    const data = await chrome.storage.local.get(['workHoursEnabled', 'workStart', 'workEnd']);
    return JSON.stringify({
      domains: list,
      workHours: {
        enabled: data.workHoursEnabled || false,
        start: data.workStart || '09:00',
        end: data.workEnd || '17:00',
      }
    }, null, 2);
  }

  async function importWhitelist(jsonStr) {
    try {
      const data = JSON.parse(jsonStr);
      if (data.domains && Array.isArray(data.domains)) {
        await saveWhitelist(data.domains);
      }
      if (data.workHours) {
        await chrome.storage.local.set({
          workHoursEnabled: data.workHours.enabled || false,
          workStart: data.workHours.start || '09:00',
          workEnd: data.workHours.end || '17:00',
        });
      }
      return true;
    } catch {
      return false;
    }
  }

  async function getSnoozeRules(domain) {
    const data = await chrome.storage.local.get('snoozeRules');
    const rules = data.snoozeRules || {};
    return rules[domain] || null;
  }

  async function setSnoozeRule(domain, rule) {
    const data = await chrome.storage.local.get('snoozeRules');
    const rules = data.snoozeRules || {};
    if (rule) {
      rules[domain] = rule;
    } else {
      delete rules[domain];
    }
    await chrome.storage.local.set({ snoozeRules: rules });
  }

  return {
    getWhitelist,
    addDomain,
    removeDomain,
    isWhitelisted,
    isTimeWhitelisted,
    matchDomain,
    matchURLPattern,
    getPresets,
    exportWhitelist,
    importWhitelist,
    getSnoozeRules,
    setSnoozeRule,
  };
})();

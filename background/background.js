import {
  DEFAULT_SETTINGS,
  DEFAULT_SCHEDULE,
  isBlockingActive,
  isValidDomain,
  normalizeDomain
} from '../lib/utils.js';

const browser = globalThis.browser || globalThis.chrome;

let currentSettings = { ...DEFAULT_SETTINGS };
let currentSchedule = { ...DEFAULT_SCHEDULE };
let currentBlocklist = [];
let blockedCount = 0;
let blockedCountDate = new Date().toDateString();
let updateLock = Promise.resolve();

function normalizeBlocklist(entries) {
  const seen = new Set();
  return (Array.isArray(entries) ? entries : [])
    .map((entry) => {
      const domain = typeof entry === 'string' ? entry : entry?.domain;
      const normalized = normalizeDomain(domain);
      if (!normalized || !isValidDomain(normalized)) return null;

      const category = typeof entry === 'string' ? 'custom' : (entry?.category || 'custom');
      return {
        domain: normalized,
        category,
        addedAt: typeof entry?.addedAt === 'number' ? entry.addedAt : Date.now()
      };
    })
    .filter(Boolean)
    .filter((entry) => {
      const key = normalizeDomain(entry.domain);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

async function loadState() {
  const data = await browser.storage.local.get(['settings', 'schedule', 'blocklist', 'blockedCount', 'blockedCountDate']);
  if (data.settings) currentSettings = { ...DEFAULT_SETTINGS, ...data.settings };
  if (data.schedule) currentSchedule = { ...DEFAULT_SCHEDULE, ...data.schedule };
  if (data.blocklist) currentBlocklist = normalizeBlocklist(data.blocklist);
  if (data.blockedCount !== undefined) blockedCount = data.blockedCount;
  if (data.blockedCountDate) blockedCountDate = data.blockedCountDate;

  const today = new Date().toDateString();
  if (blockedCountDate !== today) {
    blockedCount = 0;
    blockedCountDate = today;
  }
}

async function saveState() {
  currentBlocklist = normalizeBlocklist(currentBlocklist);
  await browser.storage.local.set({
    settings: currentSettings,
    schedule: currentSchedule,
    blocklist: currentBlocklist,
    blockedCount,
    blockedCountDate
  });
}

function isDomainBlocked(hostname, domain) {
  const normalizedHostname = normalizeDomain(hostname);
  const normalizedDomain = normalizeDomain(domain);

  if (!normalizedHostname || !normalizedDomain) return false;
  return normalizedHostname === normalizedDomain || normalizedHostname.endsWith(`.${normalizedDomain}`);
}

function shouldBlockUrl(urlString) {
  if (!urlString || !isBlockingActive(currentSettings, currentSchedule)) return false;

  try {
    const url = new URL(urlString);
    const hostname = url.hostname;
    if (!hostname) return false;

    const allowlistSet = new Set(currentSettings.allowlist.map(d => normalizeDomain(d)));
    if (allowlistSet.has(normalizeDomain(hostname))) return false;

    return currentBlocklist.some((entry) => {
      const category = currentSettings.categories[entry.category];
      if (!category || !category.enabled) return false;
      return isDomainBlocked(hostname, entry.domain);
    });
  } catch (e) {
    return false;
  }
}

async function updateBlockingRules() {
  const p = updateLock.then(async () => {
    const isActive = isBlockingActive(currentSettings, currentSchedule);
    const hasBlockedDomains = currentBlocklist.some((entry) => {
      const category = currentSettings.categories[entry.category];
      if (!category || !category.enabled) return false;
      return !currentSettings.allowlist.some(d => normalizeDomain(d) === normalizeDomain(entry.domain));
    });

    await updateIcon(isActive && hasBlockedDomains);
  });

  updateLock = p.catch(() => {});
  return p;
}

async function updateIcon(active) {
  try {
    await browser.action.setIcon({
      path: {
        16: `icons/icon-16.png`,
        32: `icons/icon-32.png`,
        48: `icons/icon-48.png`,
        128: `icons/icon-128.png`
      }
    });
  } catch (e) {
    // Icon update failed, non-critical
  }

  try {
    await browser.action.setBadgeText({
      text: active ? 'ON' : ''
    });
    await browser.action.setBadgeBackgroundColor({
      color: active ? '#6366f1' : '#9ca3af'
    });
  } catch (e) {
    // Badge update failed, non-critical
  }
}

async function checkPauseExpiry() {
  if (currentSettings.paused && currentSettings.pauseUntil) {
    if (Date.now() >= currentSettings.pauseUntil) {
      currentSettings.paused = false;
      currentSettings.pauseUntil = null;
      await saveState();
      await updateBlockingRules();
    }
  }
}

browser.alarms.create('checkPause', { periodInMinutes: 1 });
browser.alarms.create('checkSchedule', { periodInMinutes: 1 });

browser.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'checkPause') {
    await checkPauseExpiry();
  }
  if (alarm.name === 'checkSchedule') {
    await updateBlockingRules();
  }
});

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch(err => {
    console.error('Message handler error:', err);
    sendResponse({ error: err.message });
  });
  return true;
});

async function handleMessage(message) {
  switch (message.type) {
    case 'getState':
      return {
        settings: currentSettings,
        schedule: currentSchedule,
        blocklist: currentBlocklist,
        blockedCount,
        isActive: isBlockingActive(currentSettings, currentSchedule)
      };

    case 'updateSettings':
      currentSettings = { ...currentSettings, ...message.settings };
      await saveState();
      await updateBlockingRules();
      return { success: true };

    case 'updateSchedule':
      currentSchedule = { ...currentSchedule, ...message.schedule };
      await saveState();
      await updateBlockingRules();
      return { success: true };

    case 'updateBlocklist': {
      currentBlocklist = normalizeBlocklist(message.blocklist);
      await saveState();
      await updateBlockingRules();
      return { success: true };
    }

    case 'addDomain': {
      const domain = normalizeDomain(message.domain);
      const category = message.category || 'custom';
      if (domain && !currentBlocklist.find(e => normalizeDomain(e.domain) === domain)) {
        currentBlocklist.push({ domain, category, addedAt: Date.now() });
        await saveState();
        await updateBlockingRules();
      }
      return { success: true };
    }

    case 'removeDomain': {
      const domain = normalizeDomain(message.domain);
      currentBlocklist = currentBlocklist.filter(e => normalizeDomain(e.domain) !== domain);
      await saveState();
      await updateBlockingRules();
      return { success: true };
    }

    case 'bulkAddDomains': {
      const domains = message.domains.map(d => normalizeDomain(d)).filter(Boolean);
      const category = message.category || 'custom';
      for (const domain of domains) {
        if (!currentBlocklist.find(e => normalizeDomain(e.domain) === domain)) {
          currentBlocklist.push({ domain, category, addedAt: Date.now() });
        }
      }
      await saveState();
      await updateBlockingRules();
      return { success: true };
    }

    case 'bulkRemoveDomains': {
      const domains = new Set((message.domains || []).map(d => normalizeDomain(d)).filter(Boolean));
      currentBlocklist = currentBlocklist.filter(e => !domains.has(normalizeDomain(e.domain)));
      await saveState();
      await updateBlockingRules();
      return { success: true };
    }

    case 'togglePause': {
      if (message.pause) {
        currentSettings.paused = true;
        currentSettings.pauseUntil = message.duration
          ? Date.now() + message.duration * 60 * 1000
          : null;
      } else {
        currentSettings.paused = false;
        currentSettings.pauseUntil = null;
      }
      await saveState();
      await updateBlockingRules();
      return { success: true };
    }

    case 'toggleEnabled':
      currentSettings.enabled = message.enabled;
      await saveState();
      await updateBlockingRules();
      return { success: true };

    case 'toggleCategory': {
      const cat = message.category;
      if (currentSettings.categories[cat]) {
        currentSettings.categories[cat].enabled = message.enabled;
        await saveState();
        await updateBlockingRules();
      }
      return { success: true };
    }

    case 'importBlocklist': {
      const entries = message.entries;
      const category = message.category || 'custom';
      let added = 0;
      for (const entry of entries) {
        const domain = normalizeDomain(entry.domain || entry);
        if (domain && !currentBlocklist.find(e => normalizeDomain(e.domain) === domain)) {
          currentBlocklist.push({
            domain,
            category: entry.category || category,
            addedAt: Date.now()
          });
          added++;
        }
      }
      await saveState();
      await updateBlockingRules();
      return { success: true, added };
    }

    case 'exportBlocklist':
      return { blocklist: currentBlocklist };

    case 'getBlockedCount':
      return { count: blockedCount };

    case 'resetBlockedCount':
      blockedCount = 0;
      blockedCountDate = new Date().toDateString();
      await saveState();
      return { success: true };

    default:
      return { error: 'Unknown message type' };
  }
}

if (browser.webRequest?.onBeforeRequest) {
  browser.webRequest.onBeforeRequest.addListener(
    (details) => {
      if (!details || details.type !== 'main_frame' || !shouldBlockUrl(details.url)) {
        return {};
      }

      const today = new Date().toDateString();
      if (blockedCountDate !== today) {
        blockedCount = 0;
        blockedCountDate = today;
      }
      blockedCount++;
      browser.storage.local.set({ blockedCount, blockedCountDate }).catch(() => {});

      return {
        redirectUrl: browser.runtime.getURL(`blocked/blocked.html?target=${encodeURIComponent(details.url)}`)
      };
    },
    { urls: ['<all_urls>'], types: ['main_frame'] },
    ['blocking']
  );
}

async function init() {
  await loadState();

  if (currentSettings.paused && currentSettings.pauseUntil && Date.now() >= currentSettings.pauseUntil) {
    currentSettings.paused = false;
    currentSettings.pauseUntil = null;
    await saveState();
  }

  await updateBlockingRules();
}

init();

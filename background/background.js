import {
  DEFAULT_SETTINGS,
  DEFAULT_SCHEDULE,
  isBlockingActive,
  normalizeDomain
} from '../lib/utils.js';

const browser = globalThis.browser || globalThis.chrome;

let currentSettings = { ...DEFAULT_SETTINGS };
let currentSchedule = { ...DEFAULT_SCHEDULE };
let currentBlocklist = [];
let blockedCount = 0;
let blockedCountDate = new Date().toDateString();
let updateLock = Promise.resolve();

async function loadState() {
  const data = await browser.storage.local.get(['settings', 'schedule', 'blocklist', 'blockedCount', 'blockedCountDate']);
  if (data.settings) currentSettings = { ...DEFAULT_SETTINGS, ...data.settings };
  if (data.schedule) currentSchedule = { ...DEFAULT_SCHEDULE, ...data.schedule };
  if (data.blocklist) currentBlocklist = data.blocklist;
  if (data.blockedCount) blockedCount = data.blockedCount;
  if (data.blockedCountDate) blockedCountDate = data.blockedCountDate;

  const today = new Date().toDateString();
  if (blockedCountDate !== today) {
    blockedCount = 0;
    blockedCountDate = today;
  }
}

async function saveState() {
  await browser.storage.local.set({
    settings: currentSettings,
    schedule: currentSchedule,
    blocklist: currentBlocklist,
    blockedCount,
    blockedCountDate
  });
}

async function updateBlockingRules() {
  const p = updateLock.then(async () => {
    const isActive = isBlockingActive(currentSettings, currentSchedule);

    let existingRuleIds = [];
    try {
      const existingRules = await browser.declarativeNetRequest.getDynamicRules();
      existingRuleIds = existingRules.map(r => r.id);
    } catch (e) {
      console.error('Error getting rules:', e);
    }

    if (!isActive || currentBlocklist.length === 0) {
      if (existingRuleIds.length > 0) {
        try {
          await browser.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: existingRuleIds
          });
        } catch (e) {
          console.error('Error removing rules:', e);
        }
      }
      await updateIcon(false);
      return;
    }

    const allowlistSet = new Set(currentSettings.allowlist.map(d => normalizeDomain(d)));
    const domainsToBlock = currentBlocklist.filter(entry => {
      const cat = currentSettings.categories[entry.category];
      if (!cat || !cat.enabled) return false;
      return !allowlistSet.has(normalizeDomain(entry.domain));
    });

    if (domainsToBlock.length === 0) {
      if (existingRuleIds.length > 0) {
        try {
          await browser.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: existingRuleIds
          });
        } catch (e) {
          console.error('Error removing rules:', e);
        }
      }
      await updateIcon(false);
      return;
    }

    const addRules = [];
    let ruleId = 1;

    for (const entry of domainsToBlock) {
      const domain = normalizeDomain(entry.domain);
      addRules.push({
        id: ruleId++,
        priority: 1,
        action: { type: 'block' },
        condition: {
          urlFilter: `||${domain}`,
          resourceTypes: ['main_frame', 'sub_frame']
        }
      });

      if (ruleId > 30000) break;
    }

    try {
      await browser.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: existingRuleIds,
        addRules
      });
    } catch (e) {
      console.error('Error updating rules:', e);
    }

    await updateIcon(true);
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

    case 'updateBlocklist':
      currentBlocklist = message.blocklist;
      await saveState();
      await updateBlockingRules();
      return { success: true };

    case 'addDomain': {
      const domain = normalizeDomain(message.domain);
      const category = message.category || 'custom';
      if (!currentBlocklist.find(e => normalizeDomain(e.domain) === domain)) {
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
      const domains = message.domains.map(d => normalizeDomain(d));
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
      const domains = new Set(message.domains.map(d => normalizeDomain(d)));
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

browser.declarativeNetRequest.onRuleMatchedDebug?.addListener(() => {
  const today = new Date().toDateString();
  if (blockedCountDate !== today) {
    blockedCount = 0;
    blockedCountDate = today;
  }
  blockedCount++;
  browser.storage.local.set({ blockedCount, blockedCountDate });
});

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

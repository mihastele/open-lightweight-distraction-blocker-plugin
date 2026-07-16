export const DEFAULT_SETTINGS = {
  enabled: true,
  paused: false,
  pauseUntil: null,
  strictMode: false,
  allowlist: [],
  categories: {
    social: { name: 'Social Media', enabled: true, color: '#ef4444' },
    news: { name: 'News', enabled: false, color: '#f59e0b' },
    entertainment: { name: 'Entertainment', enabled: false, color: '#8b5cf6' },
    shopping: { name: 'Shopping', enabled: false, color: '#10b981' },
    gaming: { name: 'Gaming', enabled: false, color: '#3b82f6' },
    custom: { name: 'Custom', enabled: true, color: '#6b7280' }
  }
};

export const DEFAULT_SCHEDULE = {
  enabled: false,
  days: {
    monday: { enabled: true, start: '09:00', end: '17:00' },
    tuesday: { enabled: true, start: '09:00', end: '17:00' },
    wednesday: { enabled: true, start: '09:00', end: '17:00' },
    thursday: { enabled: true, start: '09:00', end: '17:00' },
    friday: { enabled: true, start: '09:00', end: '17:00' },
    saturday: { enabled: false, start: '09:00', end: '17:00' },
    sunday: { enabled: false, start: '09:00', end: '17:00' }
  }
};

export const PRESET_CATEGORIES = {
  social: [
    'facebook.com', 'twitter.com', 'x.com', 'instagram.com', 'tiktok.com',
    'reddit.com', 'linkedin.com', 'pinterest.com', 'snapchat.com', 'threads.net',
    'mastodon.social', 'tumblr.com', 'quora.com', 'discord.com'
  ],
  news: [
    'cnn.com', 'bbc.com', 'nytimes.com', 'foxnews.com', 'nbcnews.com',
    'theguardian.com', 'washingtonpost.com', 'reuters.com', 'bloomberg.com',
    'wsj.com', 'usatoday.com', 'huffpost.com', 'buzzfeed.com'
  ],
  entertainment: [
    'youtube.com', 'netflix.com', 'hulu.com', 'disneyplus.com', 'twitch.tv',
    'spotify.com', 'vimeo.com', 'dailymotion.com', 'hbomax.com', 'primevideo.com'
  ],
  shopping: [
    'amazon.com', 'ebay.com', 'etsy.com', 'aliexpress.com', 'walmart.com',
    'target.com', 'bestbuy.com', 'shopify.com', 'wish.com'
  ],
  gaming: [
    'steampowered.com', 'epicgames.com', 'twitch.tv', 'ign.com',
    'gamespot.com', 'kotaku.com', 'polygon.com', 'roblox.com'
  ]
};

export function normalizeDomain(domain) {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    .replace(/\.$/, '');
}

export function isValidDomain(domain) {
  const normalized = normalizeDomain(domain);
  if (!normalized || normalized.length === 0) return false;
  if (normalized.length > 253) return false;
  const parts = normalized.split('.');
  if (parts.length < 2) return false;
  const domainRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
  return parts.every(part => domainRegex.test(part) && part.length <= 63);
}

export function parseHostsFile(content) {
  const domains = [];
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 2) {
      const ip = parts[0];
      if (ip === '0.0.0.0' || ip === '127.0.0.1') {
        const domain = parts[1];
        if (domain !== 'localhost' && isValidDomain(domain)) {
          domains.push(normalizeDomain(domain));
        }
      }
    }
  }
  return [...new Set(domains)];
}

export function exportAsHosts(domains) {
  return domains.map(d => `0.0.0.0 ${d}`).join('\n') + '\n';
}

export function isScheduleActive(schedule) {
  if (!schedule.enabled) return true;
  const now = new Date();
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const today = days[now.getDay()];
  const daySchedule = schedule.days[today];
  if (!daySchedule || !daySchedule.enabled) return false;

  const [startH, startM] = daySchedule.start.split(':').map(Number);
  const [endH, endM] = daySchedule.end.split(':').map(Number);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  if (startMinutes <= endMinutes) {
    return nowMinutes >= startMinutes && nowMinutes <= endMinutes;
  }
  return nowMinutes >= startMinutes || nowMinutes <= endMinutes;
}

export function isBlockingActive(settings, schedule) {
  if (!settings.enabled) return false;
  if (settings.paused) {
    if (settings.pauseUntil) {
      if (Date.now() >= settings.pauseUntil) {
        return true;
      }
      return false;
    }
    return false;
  }
  return isScheduleActive(schedule);
}

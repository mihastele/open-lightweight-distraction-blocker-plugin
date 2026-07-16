import { normalizeDomain, isValidDomain, DEFAULT_SETTINGS, DEFAULT_SCHEDULE } from '../lib/utils.js';

const browser = globalThis.browser || globalThis.chrome;

let settings = { ...DEFAULT_SETTINGS };

function sendMessage(message) {
  return new Promise((resolve) => {
    browser.runtime.sendMessage(message, (response) => {
      if (browser.runtime.lastError) {
        console.error('sendMessage error:', browser.runtime.lastError.message);
        resolve({ error: browser.runtime.lastError.message });
      } else {
        resolve(response || {});
      }
    });
  });
}

function showToast(message, duration = 3000) {
  const toast = document.getElementById('toast');
  document.getElementById('toastMessage').textContent = message;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), duration);
}

async function loadSettings() {
  const response = await sendMessage({ type: 'getState' });
  if (response.settings) settings = { ...DEFAULT_SETTINGS, ...response.settings };
}

function renderAllowlist() {
  const container = document.getElementById('allowlistContainer');
  container.innerHTML = '';

  for (const domain of settings.allowlist) {
    const item = document.createElement('div');
    item.className = 'allowlist-item';

    const span = document.createElement('span');
    span.textContent = domain;
    item.appendChild(span);

    const btn = document.createElement('button');
    btn.dataset.domain = domain;
    btn.title = 'Remove';
    btn.textContent = '\u00d7';
    item.appendChild(btn);

    container.appendChild(item);
  }

  container.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', async () => {
      const domain = btn.dataset.domain;
      settings.allowlist = settings.allowlist.filter(d => d !== domain);
      await sendMessage({ type: 'updateSettings', settings });
      renderAllowlist();
      showToast(`Removed ${domain} from allowlist`);
    });
  });
}

function renderCategories() {
  const grid = document.getElementById('categoriesGrid');
  grid.innerHTML = '';

  for (const [key, cat] of Object.entries(settings.categories)) {
    const card = document.createElement('div');
    card.className = 'category-card';
    card.innerHTML = `
      <div class="category-card-info">
        <span class="category-card-dot" style="background: ${cat.color}"></span>
        <span class="category-card-name">${cat.name}</span>
      </div>
      <label class="switch">
        <input type="checkbox" data-category="${key}" ${cat.enabled ? 'checked' : ''}>
        <span class="slider"></span>
      </label>
    `;
    grid.appendChild(card);
  }

  grid.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', async (e) => {
      const category = e.target.dataset.category;
      const enabled = e.target.checked;
      settings.categories[category].enabled = enabled;
      await sendMessage({ type: 'toggleCategory', category, enabled });
      showToast(`${settings.categories[category].name} ${enabled ? 'enabled' : 'disabled'}`);
    });
  });
}

async function init() {
  await loadSettings();

  document.getElementById('strictMode').checked = settings.strictMode || false;

  document.getElementById('strictMode').addEventListener('change', async (e) => {
    settings.strictMode = e.target.checked;
    await sendMessage({ type: 'updateSettings', settings });
    showToast(`Strict mode ${settings.strictMode ? 'enabled' : 'disabled'}`);
  });

  document.getElementById('addAllowlistBtn').addEventListener('click', async () => {
    const input = document.getElementById('allowlistInput');
    const domain = normalizeDomain(input.value);
    if (!isValidDomain(domain)) {
      showToast('Invalid domain');
      return;
    }
    if (settings.allowlist.includes(domain)) {
      showToast('Domain already in allowlist');
      return;
    }
    settings.allowlist.push(domain);
    await sendMessage({ type: 'updateSettings', settings });
    input.value = '';
    renderAllowlist();
    showToast(`Added ${domain} to allowlist`);
  });

  document.getElementById('allowlistInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('addAllowlistBtn').click();
  });

  document.getElementById('exportAllBtn').addEventListener('click', async () => {
    const response = await sendMessage({ type: 'getState' });
    const data = {
      settings: response.settings,
      schedule: response.schedule,
      blocklist: response.blocklist,
      exportedAt: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `focusguard-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Data exported');
  });

  document.getElementById('importAllBtn').addEventListener('click', () => {
    document.getElementById('importFileInput').click();
  });

  document.getElementById('importFileInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const data = JSON.parse(ev.target.result);

        if (data.settings) {
          const mergedSettings = { ...DEFAULT_SETTINGS, ...data.settings };
          settings = mergedSettings;
          await sendMessage({ type: 'updateSettings', settings: mergedSettings });
        }
        if (data.schedule) {
          await sendMessage({ type: 'updateSchedule', schedule: data.schedule });
        }
        if (data.blocklist) {
          await sendMessage({ type: 'updateBlocklist', blocklist: data.blocklist });
        }

        await loadSettings();
        renderAllowlist();
        renderCategories();
        document.getElementById('strictMode').checked = settings.strictMode || false;
        showToast('Data imported successfully');
      } catch (err) {
        showToast('Invalid backup file');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  document.getElementById('resetBtn').addEventListener('click', async () => {
    if (!confirm('Are you sure you want to reset all settings? This cannot be undone.')) return;

    await browser.storage.local.clear();
    settings = { ...DEFAULT_SETTINGS };
    await sendMessage({ type: 'updateSettings', settings });
    await sendMessage({ type: 'updateBlocklist', blocklist: [] });
    await sendMessage({ type: 'updateSchedule', schedule: { ...DEFAULT_SCHEDULE, enabled: false } });

    renderAllowlist();
    renderCategories();
    document.getElementById('strictMode').checked = false;
    showToast('All settings reset');
  });

  renderAllowlist();
  renderCategories();
}

init();

import {
  normalizeDomain,
  isValidDomain,
  parseHostsFile,
  exportAsHosts,
  PRESET_CATEGORIES,
  DEFAULT_SETTINGS,
  DEFAULT_SCHEDULE
} from '../lib/utils.js';

const browser = globalThis.browser || globalThis.chrome;

let state = {
  settings: { ...DEFAULT_SETTINGS },
  schedule: { ...DEFAULT_SCHEDULE },
  blocklist: [],
  blockedCount: 0,
  isActive: false
};

let bulkMode = false;
let selectedDomains = new Set();

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

async function loadState() {
  const response = await sendMessage({ type: 'getState' });
  if (response.settings) state.settings = response.settings;
  if (response.schedule) state.schedule = response.schedule;
  if (response.blocklist) {
    state.blocklist = response.blocklist.map(entry => ({
      ...entry,
      domain: normalizeDomain(entry.domain || ''),
      category: entry.category || 'custom'
    })).filter(entry => entry.domain);
  }
  if (response.blockedCount !== undefined) state.blockedCount = response.blockedCount;
  if (response.isActive !== undefined) state.isActive = response.isActive;
}

function showToast(message, duration = 3000) {
  const toast = document.getElementById('toast');
  const toastMessage = document.getElementById('toastMessage');
  toastMessage.textContent = message;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), duration);
}

function showModal(title, bodyHTML, footerHTML = '') {
  const modal = document.getElementById('modal');
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = bodyHTML;
  document.getElementById('modalFooter').innerHTML = footerHTML;
  modal.classList.remove('hidden');
}

function hideModal() {
  document.getElementById('modal').classList.add('hidden');
}

function updateStatus() {
  const dot = document.getElementById('statusDot');
  const text = document.getElementById('statusText');
  const count = document.getElementById('blockedCount');

  count.textContent = state.blockedCount;

  if (state.settings.paused) {
    dot.className = 'status-dot paused';
    text.textContent = 'Paused';
  } else if (state.isActive) {
    dot.className = 'status-dot';
    text.textContent = 'Blocking Active';
  } else {
    dot.className = 'status-dot inactive';
    text.textContent = state.settings.enabled ? 'Outside Schedule' : 'Disabled';
  }
}

function updateDashboard() {
  const toggle = document.getElementById('mainToggle');
  const title = document.getElementById('toggleTitle');
  const desc = document.getElementById('toggleDesc');

  toggle.checked = state.settings.enabled;

  if (state.settings.paused) {
    title.textContent = 'Blocking Paused';
    desc.textContent = 'All blocking is temporarily disabled';
  } else if (state.isActive) {
    title.textContent = 'Blocking Active';
    desc.textContent = 'Distracting sites are being blocked';
  } else {
    title.textContent = state.settings.enabled ? 'Outside Schedule' : 'Blocking Disabled';
    desc.textContent = state.settings.enabled
      ? 'Blocking will resume during scheduled hours'
      : 'Enable to start blocking distracting sites';
  }

  updatePauseTimer();
  renderCategories();
}

function updatePauseTimer() {
  const timerEl = document.getElementById('pauseTimer');
  const timeLeftEl = document.getElementById('pauseTimeLeft');
  const pauseBtn = document.getElementById('pauseResumeBtn');

  if (state.settings.paused && state.settings.pauseUntil) {
    const remaining = state.settings.pauseUntil - Date.now();
    if (remaining > 0) {
      const mins = Math.ceil(remaining / 60000);
      timeLeftEl.textContent = `Resuming in ${mins} minute${mins !== 1 ? 's' : ''}`;
      timerEl.classList.remove('hidden');
      pauseBtn.textContent = 'Resume';
      pauseBtn.classList.add('active');
    } else {
      timerEl.classList.add('hidden');
      pauseBtn.textContent = 'Pause';
      pauseBtn.classList.remove('active');
    }
  } else {
    timerEl.classList.add('hidden');
    pauseBtn.textContent = 'Pause';
    pauseBtn.classList.remove('active');
  }
}

function renderCategories() {
  const container = document.getElementById('categoriesList');
  container.innerHTML = '';

  for (const [key, cat] of Object.entries(state.settings.categories)) {
    const count = state.blocklist.filter(e => e.category === key).length;
    const item = document.createElement('div');
    item.className = 'category-item';
    item.innerHTML = `
      <div class="category-info">
        <span class="category-dot" style="background: ${cat.color}"></span>
        <span class="category-name">${cat.name}</span>
        <span class="category-count">${count}</span>
      </div>
      <label class="switch">
        <input type="checkbox" data-category="${key}" ${cat.enabled ? 'checked' : ''}>
        <span class="slider"></span>
      </label>
    `;
    container.appendChild(item);
  }

  container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', async (e) => {
      const category = e.target.dataset.category;
      const enabled = e.target.checked;
      await sendMessage({ type: 'toggleCategory', category, enabled });
      state.settings.categories[category].enabled = enabled;
      showToast(`${state.settings.categories[category].name} ${enabled ? 'enabled' : 'disabled'}`);
    });
  });
}

function renderBlocklist(filter = '') {
  const container = document.getElementById('blocklistContainer');
  const emptyState = document.getElementById('emptyState');

  if (!container) return;

  let filtered = state.blocklist;
  if (filter) {
    const lower = filter.toLowerCase();
    filtered = state.blocklist.filter(e => normalizeDomain(e.domain).includes(lower));
  }

  if (emptyState) {
    if (filtered.length === 0) {
      container.innerHTML = '';
      container.appendChild(emptyState);
      emptyState.classList.remove('hidden');
      return;
    }

    emptyState.classList.add('hidden');
  }

  container.innerHTML = '';

  for (const entry of filtered) {
    const normalized = normalizeDomain(entry.domain);
    const item = document.createElement('div');
    item.className = 'blocklist-item' + (selectedDomains.has(normalized) ? ' selected' : '');
    const cat = state.settings.categories[entry.category];
    const catColor = cat ? cat.color : '#6b7280';
    const catName = cat ? cat.name : entry.category;

    if (bulkMode) {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.dataset.domain = normalized;
      cb.checked = selectedDomains.has(normalized);
      item.appendChild(cb);
    }

    const domainSpan = document.createElement('span');
    domainSpan.className = 'blocklist-domain';
    domainSpan.textContent = normalized;
    item.appendChild(domainSpan);

    const catSpan = document.createElement('span');
    catSpan.className = 'blocklist-category';
    catSpan.style.background = catColor + '20';
    catSpan.style.color = catColor;
    catSpan.textContent = catName;
    item.appendChild(catSpan);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'blocklist-remove';
    removeBtn.dataset.domain = normalized;
    removeBtn.title = 'Remove';
    removeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    item.appendChild(removeBtn);

    container.appendChild(item);
  }

  container.querySelectorAll('.blocklist-remove').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const domain = normalizeDomain(e.currentTarget.dataset.domain || '');
      if (!domain) return;
      await sendMessage({ type: 'removeDomain', domain });
      state.blocklist = state.blocklist.filter(entry => normalizeDomain(entry.domain) !== domain);
      selectedDomains.delete(domain);
      renderBlocklist(document.getElementById('searchInput').value);
      showToast(`Removed ${domain}`);
    });
  });

  if (bulkMode) {
    container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const domain = normalizeDomain(e.target.dataset.domain || '');
        if (!domain) return;
        if (e.target.checked) {
          selectedDomains.add(domain);
        } else {
          selectedDomains.delete(domain);
        }
        renderBlocklist(document.getElementById('searchInput').value);
      });
    });
  }
}

function renderSchedule() {
  const toggle = document.getElementById('scheduleToggle');
  toggle.checked = state.schedule.enabled;

  const days = state.schedule.days;
  document.querySelectorAll('.day-row').forEach(row => {
    const day = row.dataset.day;
    const dayData = days[day];
    if (!dayData) return;

    const checkbox = row.querySelector('input[type="checkbox"]');
    const startInput = row.querySelector('.time-start');
    const endInput = row.querySelector('.time-end');

    checkbox.checked = dayData.enabled;
    startInput.value = dayData.start;
    endInput.value = dayData.end;

    row.classList.toggle('disabled', !dayData.enabled);

    checkbox.addEventListener('change', () => {
      row.classList.toggle('disabled', !checkbox.checked);
    });
  });
}

function initTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(tab.dataset.tab).classList.add('active');
    });
  });
}

function initDashboard() {
  document.getElementById('mainToggle').addEventListener('change', async (e) => {
    const enabled = e.target.checked;
    await sendMessage({ type: 'toggleEnabled', enabled });
    state.settings.enabled = enabled;
    updateDashboard();
    updateStatus();
    showToast(enabled ? 'Blocking enabled' : 'Blocking disabled');
  });

  document.querySelectorAll('.pause-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const minutes = parseInt(btn.dataset.minutes);

      if (state.settings.paused) {
        await sendMessage({ type: 'togglePause', pause: false });
        state.settings.paused = false;
        state.settings.pauseUntil = null;
        showToast('Blocking resumed');
      } else {
        await sendMessage({ type: 'togglePause', pause: true, duration: minutes || null });
        state.settings.paused = true;
        state.settings.pauseUntil = minutes ? Date.now() + minutes * 60000 : null;
        showToast(minutes ? `Paused for ${minutes} minutes` : 'Paused indefinitely');
      }
      updateDashboard();
      updateStatus();
    });
  });

  document.getElementById('quickAddInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('quickAddBtn').click();
  });

  document.getElementById('quickAddBtn').addEventListener('click', async () => {
    const input = document.getElementById('quickAddInput');
    const domain = input.value.trim();
    if (!domain) return;
    if (!isValidDomain(domain)) {
      showToast('Invalid domain');
      return;
    }
    await sendMessage({ type: 'addDomain', domain, category: 'custom' });
    state.blocklist.push({ domain: normalizeDomain(domain), category: 'custom', addedAt: Date.now() });
    input.value = '';
    renderCategories();
    showToast(`Added ${normalizeDomain(domain)}`);
  });

  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const category = btn.dataset.category;
      const domains = PRESET_CATEGORIES[category] || [];
      const normalizedDomains = domains.map(normalizeDomain).filter(Boolean);
      const existingDomains = new Set(
        state.blocklist.filter(entry => entry.category === category).map(entry => normalizeDomain(entry.domain))
      );
      const isActive = normalizedDomains.some(domain => existingDomains.has(domain));

      if (isActive) {
        await sendMessage({ type: 'bulkRemoveDomains', domains: normalizedDomains });
        state.blocklist = state.blocklist.filter(entry => {
          const domain = normalizeDomain(entry.domain);
          return !(entry.category === category && normalizedDomains.includes(domain));
        });
        renderCategories();
        renderBlocklist(document.getElementById('searchInput')?.value || '');
        showToast(`Removed ${normalizedDomains.length} ${category} sites`);
        return;
      }

      await sendMessage({ type: 'bulkAddDomains', domains: normalizedDomains, category });
      for (const domain of normalizedDomains) {
        if (!state.blocklist.find(e => normalizeDomain(e.domain) === domain)) {
          state.blocklist.push({ domain, category, addedAt: Date.now() });
        }
      }
      renderCategories();
      renderBlocklist(document.getElementById('searchInput')?.value || '');
      showToast(`Added ${normalizedDomains.length} ${category} sites`);
    });
  });
}

function initBlocklist() {
  const searchInput = document.getElementById('searchInput');
  searchInput.addEventListener('input', () => {
    renderBlocklist(searchInput.value);
  });

  document.getElementById('bulkSelectBtn').addEventListener('click', () => {
    bulkMode = !bulkMode;
    selectedDomains.clear();
    document.getElementById('bulkSelectBtn').textContent = bulkMode ? 'Cancel' : 'Select';
    document.getElementById('bulkDeleteBtn').classList.toggle('hidden', !bulkMode);
    renderBlocklist(searchInput.value);
  });

  document.getElementById('bulkDeleteBtn').addEventListener('click', async () => {
    if (selectedDomains.size === 0) {
      showToast('No domains selected');
      return;
    }
    const domains = [...selectedDomains].map(normalizeDomain).filter(Boolean);
    await sendMessage({ type: 'bulkRemoveDomains', domains });
    const normalizedSet = new Set(domains);
    state.blocklist = state.blocklist.filter(e => !normalizedSet.has(normalizeDomain(e.domain)));
    selectedDomains.clear();
    bulkMode = false;
    document.getElementById('bulkSelectBtn').textContent = 'Select';
    document.getElementById('bulkDeleteBtn').classList.add('hidden');
    renderBlocklist(searchInput.value);
    showToast(`Removed ${domains.length} domains`);
  });

  document.getElementById('addDomainBtn').addEventListener('click', () => {
    showModal('Add Domain', `
      <label>Domain</label>
      <textarea id="addDomainText" placeholder="Enter domain(s), one per line&#10;e.g., twitter.com&#10;facebook.com"></textarea>
      <label>Category</label>
      <select id="addDomainCategory">
        ${Object.entries(state.settings.categories).map(([k, v]) =>
          `<option value="${k}">${v.name}</option>`
        ).join('')}
      </select>
    `, `
      <button class="btn" id="modalCancel">Cancel</button>
      <button class="btn btn-primary" id="modalAdd">Add</button>
    `);

    document.getElementById('modalCancel').addEventListener('click', hideModal);
    document.getElementById('modalAdd').addEventListener('click', async () => {
      const text = document.getElementById('addDomainText').value;
      const category = document.getElementById('addDomainCategory').value;
      const domains = text.split('\n').map(d => d.trim()).filter(d => d && isValidDomain(d));

      if (domains.length === 0) {
        showToast('No valid domains found');
        return;
      }

      await sendMessage({ type: 'bulkAddDomains', domains, category });
      for (const domain of domains) {
        const normalized = normalizeDomain(domain);
        if (!state.blocklist.find(e => e.domain === normalized)) {
          state.blocklist.push({ domain: normalized, category, addedAt: Date.now() });
        }
      }
      hideModal();
      renderBlocklist(searchInput.value);
      renderCategories();
      showToast(`Added ${domains.length} domain(s)`);
    });
  });

  document.getElementById('importBtn').addEventListener('click', () => {
    showModal('Import Blocklist', `
      <p style="margin-bottom: 10px; font-size: 13px; color: var(--text-secondary);">
        Import from JSON, TXT (one domain per line), or CSV format.
      </p>
      <label>Or choose a file:</label>
      <button class="btn btn-full" id="chooseFileBtn" style="margin-bottom: 10px;">Choose File</button>
      <label>Or paste content:</label>
      <textarea id="importText" placeholder='JSON: [{"domain":"example.com","category":"social"}]&#10;TXT: example.com&#10;      facebook.com'></textarea>
    `, `
      <button class="btn" id="modalCancel">Cancel</button>
      <button class="btn btn-primary" id="modalImport">Import</button>
    `);

    document.getElementById('chooseFileBtn').addEventListener('click', () => {
      document.getElementById('fileInput').click();
    });

    document.getElementById('fileInput').onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        document.getElementById('importText').value = ev.target.result;
      };
      reader.readAsText(file);
      e.target.value = '';
    };

    document.getElementById('modalCancel').addEventListener('click', hideModal);
    document.getElementById('modalImport').addEventListener('click', async () => {
      const text = document.getElementById('importText').value.trim();
      if (!text) {
        showToast('No content to import');
        return;
      }

      let entries = [];
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
          entries = parsed.map(item => {
            if (typeof item === 'string') return { domain: item, category: 'custom' };
            return { domain: item.domain, category: item.category || 'custom' };
          });
        }
      } catch {
        const lines = text.split('\n').map(l => l.trim()).filter(l => l);
        entries = lines.map(line => {
          const parts = line.split(',');
          return {
            domain: parts[0].trim(),
            category: parts[1]?.trim() || 'custom'
          };
        });
      }

      const valid = entries.filter(e => isValidDomain(e.domain));
      if (valid.length === 0) {
        showToast('No valid domains found');
        return;
      }

      const response = await sendMessage({ type: 'importBlocklist', entries: valid });
      for (const entry of valid) {
        const normalized = normalizeDomain(entry.domain);
        if (!state.blocklist.find(e => e.domain === normalized)) {
          state.blocklist.push({ domain: normalized, category: entry.category || 'custom', addedAt: Date.now() });
        }
      }
      hideModal();
      renderBlocklist(searchInput.value);
      renderCategories();
      showToast(`Imported ${response.added || valid.length} domain(s)`);
    });
  });

  document.getElementById('exportBtn').addEventListener('click', () => {
    showModal('Export Blocklist', `
      <p style="margin-bottom: 10px; font-size: 13px; color: var(--text-secondary);">
        Choose export format:
      </p>
      <div style="display: flex; gap: 8px; margin-bottom: 12px;">
        <button class="btn btn-full export-format" data-format="json">JSON</button>
        <button class="btn btn-full export-format" data-format="txt">TXT</button>
        <button class="btn btn-full export-format" data-format="hosts">Hosts</button>
      </div>
      <textarea id="exportText" readonly style="min-height: 150px;"></textarea>
    `, `
      <button class="btn" id="modalCancel">Close</button>
      <button class="btn btn-primary" id="modalCopy">Copy</button>
      <button class="btn btn-primary" id="modalDownload">Download</button>
    `);

    let currentFormat = 'json';

    function updateExport(format) {
      currentFormat = format;
      const textEl = document.getElementById('exportText');
      switch (format) {
        case 'json':
          textEl.value = JSON.stringify(state.blocklist, null, 2);
          break;
        case 'txt':
          textEl.value = state.blocklist.map(e => e.domain).join('\n');
          break;
        case 'hosts':
          textEl.value = exportAsHosts(state.blocklist.map(e => e.domain));
          break;
      }
    }

    updateExport('json');

    document.querySelectorAll('.export-format').forEach(btn => {
      btn.addEventListener('click', () => updateExport(btn.dataset.format));
    });

    document.getElementById('modalCancel').addEventListener('click', hideModal);
    document.getElementById('modalCopy').addEventListener('click', () => {
      const text = document.getElementById('exportText').value;
      navigator.clipboard.writeText(text);
      showToast('Copied to clipboard');
    });
    document.getElementById('modalDownload').addEventListener('click', () => {
      const text = document.getElementById('exportText').value;
      const ext = currentFormat === 'hosts' ? 'txt' : currentFormat;
      const blob = new Blob([text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `focusguard-blocklist.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Downloaded');
    });
  });

  document.getElementById('importHostsBtn').addEventListener('click', () => {
    showModal('Import Hosts File', `
      <p style="margin-bottom: 10px; font-size: 13px; color: var(--text-secondary);">
        Import a hosts file to create a blocklist. Lines starting with 0.0.0.0 or 127.0.0.1 will be parsed.
      </p>
      <button class="btn btn-full" id="chooseHostsFileBtn" style="margin-bottom: 10px;">Choose Hosts File</button>
      <label>Or paste hosts content:</label>
      <textarea id="hostsImportText" placeholder="0.0.0.0 ads.example.com&#10;127.0.0.1 tracker.example.com"></textarea>
    `, `
      <button class="btn" id="modalCancel">Cancel</button>
      <button class="btn btn-primary" id="modalImportHosts">Import</button>
    `);

    document.getElementById('chooseHostsFileBtn').addEventListener('click', () => {
      document.getElementById('hostsFileInput').click();
    });

    document.getElementById('hostsFileInput').onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        document.getElementById('hostsImportText').value = ev.target.result;
      };
      reader.readAsText(file);
      e.target.value = '';
    };

    document.getElementById('modalCancel').addEventListener('click', hideModal);
    document.getElementById('modalImportHosts').addEventListener('click', async () => {
      const text = document.getElementById('hostsImportText').value;
      const domains = parseHostsFile(text);

      if (domains.length === 0) {
        showToast('No valid domains found in hosts file');
        return;
      }

      await sendMessage({ type: 'bulkAddDomains', domains, category: 'custom' });
      for (const domain of domains) {
        if (!state.blocklist.find(e => e.domain === domain)) {
          state.blocklist.push({ domain, category: 'custom', addedAt: Date.now() });
        }
      }
      hideModal();
      renderBlocklist(searchInput.value);
      renderCategories();
      showToast(`Imported ${domains.length} domain(s) from hosts file`);
    });
  });
}

function initSchedule() {
  document.getElementById('saveScheduleBtn').addEventListener('click', async () => {
    const enabled = document.getElementById('scheduleToggle').checked;
    const days = {};

    document.querySelectorAll('.day-row').forEach(row => {
      const day = row.dataset.day;
      days[day] = {
        enabled: row.querySelector('input[type="checkbox"]').checked,
        start: row.querySelector('.time-start').value,
        end: row.querySelector('.time-end').value
      };
    });

    const schedule = { enabled, days };
    await sendMessage({ type: 'updateSchedule', schedule });
    state.schedule = { ...state.schedule, ...schedule };
    updateStatus();
    showToast('Schedule saved');
  });
}

function initModal() {
  document.getElementById('modalClose').addEventListener('click', hideModal);
  document.querySelector('.modal-backdrop').addEventListener('click', hideModal);
}

async function init() {
  await loadState();

  initTabs();
  initDashboard();
  initBlocklist();
  initSchedule();
  initModal();

  document.getElementById('settingsBtn').addEventListener('click', () => {
    browser.runtime.openOptionsPage();
  });

  updateStatus();
  updateDashboard();
  renderBlocklist();
  renderSchedule();

  const pauseTimerId = setInterval(() => {
    if (state.settings.paused && state.settings.pauseUntil) {
      updatePauseTimer();
      if (Date.now() >= state.settings.pauseUntil) {
        state.settings.paused = false;
        state.settings.pauseUntil = null;
        updateDashboard();
        updateStatus();
      }
    }
  }, 1000);

  const countTimerId = setInterval(async () => {
    const response = await sendMessage({ type: 'getBlockedCount' });
    if (response.count !== undefined) {
      state.blockedCount = response.count;
      document.getElementById('blockedCount').textContent = state.blockedCount;
    }
  }, 5000);

  window.addEventListener('unload', () => {
    clearInterval(pauseTimerId);
    clearInterval(countTimerId);
  });
}

init();

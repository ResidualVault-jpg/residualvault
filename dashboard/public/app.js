/* ================================================================
   rv-control — Frontend Application
   ResidualVault Agent Dashboard
   ================================================================ */

'use strict';

// ─── State ────────────────────────────────────────────────────────────────────

const state = {
  summary:       null,
  agents:        [],
  logs:          [],
  alerts:        [],
  reports:       [],
  content:       [],
  connected:     false,
  pendingTrigger: null,   // { key, name }
};

// ─── Socket.IO ────────────────────────────────────────────────────────────────

const socket = io({ transports: ['websocket', 'polling'] });

socket.on('connect', () => {
  state.connected = true;
  setWsStatus(true);
});

socket.on('disconnect', () => {
  state.connected = false;
  setWsStatus(false);
});

socket.on('summary', (data) => {
  state.summary = data;
  renderSummaryCards(data.summary);
  renderAgentGrid(data.metrics);
  renderAlerts(data.openAlerts);
  renderLogs(data.recentLogs);
  renderReports(data.reports);
  renderContent(data.content);
  setLastUpdated();
});

socket.on('alerts', (alerts) => {
  state.alerts = alerts;
  renderAlerts(alerts);
});

socket.on('logs', (logs) => {
  state.logs = logs;
  renderLogs(logs);
});

// ─── WebSocket Status ─────────────────────────────────────────────────────────

function setWsStatus(connected) {
  const dot   = document.getElementById('ws-status');
  const label = document.getElementById('ws-label');
  dot.className   = connected ? 'dot dot--green' : 'dot dot--red';
  label.textContent = connected ? 'Live' : 'Reconnecting...';
}

function setLastUpdated() {
  document.getElementById('last-updated').textContent = new Date().toLocaleTimeString();
}

// ─── Summary Cards ────────────────────────────────────────────────────────────

function renderSummaryCards(summary = {}) {
  if (!summary) return;
  setText('val-agents',  summary.totalAgents  ?? '--');
  setText('val-runs',    summary.totalRuns     ?? '--');
  setText('val-success', summary.successRate != null ? summary.successRate + '%' : '--%');
  setText('val-alerts',  summary.openAlerts   ?? '--');

  // Colour-code alerts
  const alertCard = document.getElementById('stat-alerts');
  alertCard.style.borderColor = (summary.openAlerts > 0) ? 'var(--red)' : 'var(--border)';
}

// ─── Agent Grid ───────────────────────────────────────────────────────────────

function renderAgentGrid(metrics = []) {
  const grid   = document.getElementById('agent-grid');
  const search = document.getElementById('agent-search').value.toLowerCase();
  const filter = document.getElementById('report-filter');

  // Keep report/agent filter dropdowns in sync
  populateAgentDropdowns(metrics);

  // Build a lookup by name for live statuses
  const statusMap = {};
  if (state.summary && state.summary.metrics) {
    for (const m of state.summary.metrics) {
      statusMap[m.agent_name] = m;
    }
  }

  const filtered = metrics.filter(m =>
    !search || m.agent_name.toLowerCase().includes(search)
  );

  document.getElementById('agent-count').textContent = filtered.length;

  if (!filtered.length) {
    grid.innerHTML = '<div class="empty-state">No agents found</div>';
    return;
  }

  grid.innerHTML = filtered.map(m => {
    const status     = m.last_status || 'never_run';
    const successPct = m.runs_total > 0
      ? ((m.runs_success / m.runs_total) * 100).toFixed(0) + '%'
      : 'N/A';
    const agentKey   = agentNameToKey(m.agent_name);
    const lastRun    = m.last_run ? relativeTime(m.last_run) : 'Never';
    const avgMs      = m.avg_duration_ms ? Math.round(m.avg_duration_ms) + 'ms' : 'N/A';

    return `
      <div class="agent-card status--${status}" data-key="${agentKey}" data-name="${esc(m.agent_name)}">
        <div class="agent-name">${esc(m.agent_name)}</div>
        <span class="agent-status-pill pill--${status} ${status === 'running' ? 'running-pulse' : ''}">
          ${statusIcon(status)} ${status}
        </span>
        <div class="agent-meta">
          <span>&#128260; ${m.runs_total} runs &nbsp;&#9989; ${successPct}</span>
          <span>&#128337; Avg ${avgMs}</span>
          <span>&#128344; ${lastRun}</span>
        </div>
        <button class="agent-run-btn" data-key="${agentKey}" data-name="${esc(m.agent_name)}">
          &#9654; Run Now
        </button>
      </div>
    `;
  }).join('');

  // Bind run buttons
  grid.querySelectorAll('.agent-run-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openTriggerModal(btn.dataset.key, btn.dataset.name);
    });
  });
}

function statusIcon(status) {
  const icons = { idle: '&#9711;', running: '&#9654;', error: '&#9888;', never_run: '&#8212;' };
  return icons[status] || '&#9711;';
}

function agentNameToKey(name) {
  return name.toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[/&]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// ─── Alerts ───────────────────────────────────────────────────────────────────

function renderAlerts(alerts = []) {
  state.alerts = alerts;
  const list = document.getElementById('alerts-list');
  document.getElementById('alert-count').textContent = alerts.length;

  if (!alerts.length) {
    list.innerHTML = '<div class="empty-state">&#10003; No open alerts</div>';
    return;
  }

  list.innerHTML = alerts.map(a => `
    <div class="alert-item sev--${a.severity}" data-id="${a.id}">
      <div class="alert-header">
        <div>
          <div class="alert-title">${esc(a.title)}</div>
          <div class="alert-agent">${esc(a.agent_name)} &bull; <span class="sev-pill ${a.severity}">${a.severity}</span></div>
        </div>
        <button class="resolve-btn" data-id="${a.id}">Resolve</button>
      </div>
      <div class="alert-message">${esc(a.message)}</div>
      <div class="alert-agent" style="margin-top:4px">${relativeTime(a.created_at)}</div>
    </div>
  `).join('');

  list.querySelectorAll('.resolve-btn').forEach(btn => {
    btn.addEventListener('click', () => resolveAlert(parseInt(btn.dataset.id)));
  });
}

function resolveAlert(id) {
  socket.emit('resolve-alert', id);
  // Optimistic update
  state.alerts = state.alerts.filter(a => a.id !== id);
  renderAlerts(state.alerts);

  // Also hit REST endpoint
  fetch(`/api/alerts/${id}/resolve`, { method: 'POST' }).catch(() => {});
}

// ─── Log Stream ───────────────────────────────────────────────────────────────

function renderLogs(logs = []) {
  state.logs = logs;
  applyLogFilters();
}

function applyLogFilters() {
  const agentFilter = document.getElementById('log-filter').value;
  const typeFilter  = document.getElementById('log-type-filter').value;

  const filtered = state.logs.filter(l => {
    if (agentFilter && l.agent_name !== agentFilter) return false;
    if (typeFilter  && l.type       !== typeFilter)   return false;
    return true;
  });

  const stream = document.getElementById('log-stream');
  if (!filtered.length) {
    stream.innerHTML = '<div class="empty-state">No log entries</div>';
    return;
  }

  stream.innerHTML = filtered.slice(0, 150).map(l => `
    <div class="log-entry">
      <span class="log-ts">${formatTime(l.timestamp)}</span>
      <span class="log-agent">${esc(l.agent_name)}</span>
      <span class="log-type type--${l.type}">${l.type.toUpperCase()}</span>
      <span class="log-msg" title="${esc(l.message)}">${esc(l.message)}</span>
    </div>
  `).join('');
}

// ─── Reports ─────────────────────────────────────────────────────────────────

function renderReports(reports = []) {
  state.reports = reports;
  applyReportFilter();
}

function applyReportFilter() {
  const agentFilter = document.getElementById('report-filter').value;
  const filtered    = agentFilter
    ? state.reports.filter(r => r.agent_name === agentFilter)
    : state.reports;

  const list = document.getElementById('reports-list');
  document.getElementById('report-count').textContent = filtered.length;

  if (!filtered.length) {
    list.innerHTML = '<div class="empty-state">No reports yet</div>';
    return;
  }

  list.innerHTML = filtered.slice(0, 40).map(r => `
    <div class="report-item" data-id="${r.id}">
      <div class="report-title">${esc(r.title)}</div>
      <div class="report-meta">
        <span>${esc(r.agent_name)}</span>
        &bull;
        <span class="sev-pill ${r.priority}">${r.priority}</span>
        &bull;
        <span>${relativeTime(r.created_at)}</span>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.report-item').forEach(item => {
    item.addEventListener('click', () => {
      const report = filtered.find(r => r.id === parseInt(item.dataset.id));
      if (report) openReportModal(report);
    });
  });
}

// ─── Generated Content ────────────────────────────────────────────────────────

function renderContent(items = []) {
  state.content = items;
  applyContentFilter();
}

function applyContentFilter() {
  const typeFilter = document.getElementById('content-type-filter').value;
  const filtered   = typeFilter
    ? state.content.filter(c => c.content_type === typeFilter)
    : state.content;

  const list = document.getElementById('content-list');

  if (!filtered.length) {
    list.innerHTML = '<div class="empty-state">No content generated yet</div>';
    return;
  }

  list.innerHTML = filtered.slice(0, 30).map(c => `
    <div class="content-item">
      <span class="content-type-badge">${esc(c.content_type)}</span>
      <div class="content-title">${esc(c.title || '(untitled)')}</div>
      <div class="content-agent">${esc(c.agent_name)}</div>
      <div class="content-date">${relativeTime(c.created_at)}</div>
    </div>
  `).join('');
}

// ─── Dropdowns population ────────────────────────────────────────────────────

function populateAgentDropdowns(metrics) {
  const agentNames = metrics.map(m => m.agent_name).sort();

  for (const selectId of ['log-filter', 'report-filter']) {
    const sel = document.getElementById(selectId);
    const cur = sel.value;
    // Keep only the "All" option then re-add agents
    sel.innerHTML = `<option value="">All agents</option>`;
    agentNames.forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      if (name === cur) opt.selected = true;
      sel.appendChild(opt);
    });
  }
}

// ─── Trigger Modal ────────────────────────────────────────────────────────────

function openTriggerModal(key, name) {
  state.pendingTrigger = { key, name };
  document.getElementById('modal-title').textContent = `Run: ${name}`;
  document.getElementById('modal-desc').textContent  =
    `Manually trigger "${name}" now? It will run in the background and results will appear in the log stream.`;
  document.getElementById('trigger-modal').classList.add('open');
}

function closeTriggerModal() {
  document.getElementById('trigger-modal').classList.remove('open');
  state.pendingTrigger = null;
}

document.getElementById('modal-confirm').addEventListener('click', async () => {
  const { key, name } = state.pendingTrigger || {};
  if (!key) return closeTriggerModal();

  const btn = document.getElementById('modal-confirm');
  btn.textContent = 'Triggering...';
  btn.disabled = true;

  try {
    const res = await fetch(`/api/agents/${key}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed');
    showToast(`&#9654; ${name} triggered successfully`);
  } catch (err) {
    showToast(`&#9888; Error: ${err.message}`, true);
  } finally {
    btn.textContent = 'Run Now';
    btn.disabled = false;
    closeTriggerModal();
  }
});

document.getElementById('modal-cancel').addEventListener('click', closeTriggerModal);
document.getElementById('modal-close').addEventListener('click',  closeTriggerModal);
document.getElementById('modal-overlay').addEventListener('click', closeTriggerModal);

// ─── Report Detail Modal ──────────────────────────────────────────────────────

function openReportModal(report) {
  document.getElementById('report-modal-title').textContent = report.title;

  let content = report.content || '';
  try {
    const parsed = JSON.parse(content);
    content = JSON.stringify(parsed, null, 2);
  } catch (_) {}

  document.getElementById('report-modal-content').textContent = content;
  document.getElementById('report-modal').classList.add('open');
}

function closeReportModal() {
  document.getElementById('report-modal').classList.remove('open');
}

document.getElementById('report-modal-close').addEventListener('click',   closeReportModal);
document.getElementById('report-modal-overlay').addEventListener('click', closeReportModal);

// ─── Filters / Search event bindings ─────────────────────────────────────────

document.getElementById('agent-search').addEventListener('input', () => {
  if (state.summary) renderAgentGrid(state.summary.metrics || []);
});

document.getElementById('log-filter').addEventListener('change', applyLogFilters);
document.getElementById('log-type-filter').addEventListener('change', applyLogFilters);

document.getElementById('clear-logs').addEventListener('click', () => {
  document.getElementById('log-stream').innerHTML = '<div class="empty-state">Logs cleared</div>';
});

document.getElementById('report-filter').addEventListener('change', applyReportFilter);
document.getElementById('content-type-filter').addEventListener('change', applyContentFilter);

// ─── Toast Notifications ──────────────────────────────────────────────────────

function showToast(msg, isError = false) {
  const toast = document.createElement('div');
  toast.innerHTML = msg;
  Object.assign(toast.style, {
    position: 'fixed',
    bottom: '24px',
    right: '24px',
    background: isError ? 'var(--red)' : 'var(--green)',
    color: '#000',
    padding: '10px 18px',
    borderRadius: '8px',
    fontWeight: '600',
    fontSize: '13px',
    zIndex: '9999',
    boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
    opacity: '1',
    transition: 'opacity 0.4s ease',
  });
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; }, 2500);
  setTimeout(() => { toast.remove(); }, 3000);
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTime(ts) {
  if (!ts) return '--';
  const d = new Date(ts);
  return isNaN(d) ? ts : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function relativeTime(ts) {
  if (!ts) return 'never';
  const diff = Date.now() - new Date(ts).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60)   return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// ─── Keyboard shortcuts ───────────────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeTriggerModal();
    closeReportModal();
  }
});

// ─── Initial data load via REST (before socket delivers) ─────────────────────

async function initialLoad() {
  try {
    const res  = await fetch('/api/summary');
    const data = await res.json();
    state.summary = data;
    renderSummaryCards(data.summary);
    renderAgentGrid(data.metrics || []);
    renderAlerts(data.openAlerts || []);
    renderLogs(data.recentLogs || []);
    renderReports(data.reports || []);
    renderContent(data.content || []);
    setLastUpdated();
  } catch (err) {
    console.warn('Initial load failed (will retry via socket):', err.message);
  }
}

initialLoad();

// Periodic refresh every 60s as fallback
setInterval(initialLoad, 60000);

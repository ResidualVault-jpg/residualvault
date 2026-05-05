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

const socket = io({ path: '/rv-control/socket.io', transports: ['websocket', 'polling'] });

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

  list.innerHTML = alerts.map(a => {
    const sev = a.type || a.severity || 'medium';
    const title = a.message || a.title || 'Alert';
    return `
    <div class="alert-item sev--${sev}" data-id="${a.id}">
      <div class="alert-header">
        <div class="alert-clickable" data-id="${a.id}" style="cursor:pointer;flex:1">
          <div class="alert-title">${esc(title)}</div>
          <div class="alert-agent">${esc(a.agent_name)} &bull; <span class="sev-pill ${sev}">${sev}</span></div>
        </div>
        <button class="resolve-btn" data-id="${a.id}">Resolve</button>
      </div>
      <div class="alert-detail" id="alert-detail-${a.id}" style="display:none;margin-top:8px;padding:10px;background:var(--surface);border-radius:6px;font-size:13px;white-space:pre-wrap;max-height:400px;overflow-y:auto"></div>
      <div class="alert-agent" style="margin-top:4px">${relativeTime(a.created_at)}</div>
    </div>
  `}).join('');

  list.querySelectorAll('.resolve-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      resolveAlert(parseInt(btn.dataset.id));
    });
  });

  list.querySelectorAll('.alert-clickable').forEach(el => {
    el.addEventListener('click', () => toggleAlertDetail(parseInt(el.dataset.id)));
  });
}

function resolveAlert(id) {
  socket.emit('resolve-alert', id);
  // Optimistic update
  state.alerts = state.alerts.filter(a => a.id !== id);
  renderAlerts(state.alerts);

  // Also hit REST endpoint
  fetch(`/rv-control/api/alerts/${id}/resolve`, { method: 'POST' }).catch(() => {});
}

async function toggleAlertDetail(id) {
  const el = document.getElementById('alert-detail-' + id);
  if (!el) return;

  if (el.style.display !== 'none') {
    el.style.display = 'none';
    return;
  }

  el.style.display = 'block';
  el.textContent = 'Loading details...';

  try {
    const resp = await fetch('/rv-control/api/alerts/' + id + '/detail');
    const data = await resp.json();

    if (data.report) {
      const report = typeof data.report === 'string' ? data.report : JSON.stringify(data.report, null, 2);
      let html = '<strong>Agent Report</strong>\n\n';
      try {
        const parsed = typeof data.report === 'string' ? JSON.parse(data.report) : data.report;
        const reportData = parsed.data ? (typeof parsed.data === 'string' ? JSON.parse(parsed.data) : parsed.data) : parsed;
        html += formatReport(reportData);
      } catch (_) {
        html += esc(report.substring(0, 5000));
      }
      html += '<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">';
      html += '<button class="btn btn--primary implement-btn" data-id="' + id + '" style="margin-right:8px">Implement Recommendations</button>';
      html += '<span class="implement-status" id="impl-status-' + id + '"></span>';
      html += '</div>';
      el.innerHTML = html;
      el.querySelector('.implement-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        implementAlert(id);
      });
    } else if (data.logs && data.logs.length) {
      let html = '<strong>Agent Logs</strong>\n\n';
      data.logs.forEach(log => {
        html += '<div style="margin-bottom:6px"><span class="sev-pill ' + (log.status || 'info') + '">' + esc(log.status || 'info') + '</span> ' + esc(log.message || '') + '</div>';
      });
      el.innerHTML = html;
    } else {
      el.textContent = 'No additional details available for this alert.';
    }
  } catch (err) {
    el.textContent = 'Failed to load details: ' + err.message;
  }
}

async function implementAlert(id) {
  const btn = document.querySelector('.implement-btn[data-id="' + id + '"]');
  const status = document.getElementById('impl-status-' + id);
  if (btn) { btn.disabled = true; btn.textContent = 'Implementing...'; }
  if (status) status.textContent = 'Sending to agent...';

  try {
    const resp = await fetch('/rv-control/api/alerts/' + id + '/implement', { method: 'POST' });
    const data = await resp.json();

    if (data.success) {
      if (btn) { btn.textContent = 'Sent to Agent'; btn.style.background = 'var(--green)'; }
      if (status) status.innerHTML = '<span style="color:var(--green)">Agent is implementing recommendations now. This may take 1-2 minutes. Check the review queue for results.</span>';
      setTimeout(() => {
        state.alerts = state.alerts.filter(a => a.id !== id);
        renderAlerts(state.alerts);
      }, 3000);
    } else {
      if (btn) { btn.disabled = false; btn.textContent = 'Implement Recommendations'; }
      if (status) status.innerHTML = '<span style="color:var(--red)">Failed: ' + esc(data.error || 'Unknown error') + '</span>';
    }
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = 'Implement Recommendations'; }
    if (status) status.innerHTML = '<span style="color:var(--red)">Error: ' + esc(err.message) + '</span>';
  }
}

function formatReport(data) {
  if (!data || typeof data !== 'object') return esc(String(data));
  let html = '';

  if (data.contentAudit && Array.isArray(data.contentAudit)) {
    data.contentAudit.forEach(audit => {
      html += '<div style="margin-bottom:12px;padding:8px;border:1px solid var(--border);border-radius:4px">';
      html += '<strong>Content #' + (audit.contentId || '?') + '</strong> — ' + esc(audit.type || '') + ' — <span class="sev-pill ' + (audit.riskLevel || 'medium') + '">' + esc(audit.riskLevel || '?') + '</span>\n';
      if (audit.issues && Array.isArray(audit.issues)) {
        audit.issues.forEach((issue, i) => {
          html += '\n<strong>' + (i + 1) + '. [' + esc(issue.severity || '?').toUpperCase() + '] ' + esc(issue.regulation || '') + '</strong>\n';
          html += esc(issue.description || '') + '\n';
          if (issue.recommendation) html += '<em>Fix: ' + esc(issue.recommendation) + '</em>\n';
        });
      }
      html += '</div>';
    });
  } else if (data.gaps || data.contentGaps) {
    const gaps = data.gaps || data.contentGaps;
    if (Array.isArray(gaps)) {
      gaps.forEach((gap, i) => {
        html += '<strong>' + (i + 1) + '.</strong> ' + esc(typeof gap === 'string' ? gap : JSON.stringify(gap)) + '\n';
      });
    } else {
      html += esc(JSON.stringify(gaps, null, 2));
    }
  } else if (data.anomalies || data.alerts || data.findings || data.issues) {
    const items = data.anomalies || data.alerts || data.findings || data.issues;
    if (Array.isArray(items)) {
      items.forEach((item, i) => {
        html += '<strong>' + (i + 1) + '.</strong> ' + esc(typeof item === 'string' ? item : (item.title || item.message || item.description || JSON.stringify(item))) + '\n';
      });
    } else {
      html += esc(JSON.stringify(items, null, 2));
    }
  } else {
    html += esc(JSON.stringify(data, null, 2).substring(0, 5000));
  }

  return html;
}

// ─── Log Stream ───────────────────────────────────────────────────────────────

function renderLogs(logs = []) {
  state.logs = logs;
  applyLogFilters();
}

function applyLogFilters() {
  const agentFilter = document.getElementById('log-filter').value;
  const typeFilter  = document.getElementById('log-type-filter').value;

  if (typeof state.logs !== 'object') state.logs = [];
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
      <span class="log-type type--${l.type || 'info'}">${(l.type || 'info').toUpperCase()}</span>
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
    const res = await fetch(`/rv-control/api/agents/${key}/run`, {
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
    const res  = await fetch('/rv-control/api/summary');
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

// ─── Sunday Review Queue ──────────────────────────────────────────────────────

state.review       = [];
state.reviewEditId = null;

async function loadReviewQueue() {
  try {
    const res  = await fetch('/rv-control/api/review?limit=200');
    const data = await res.json();
    state.review = data.items || [];
    renderReviewQueue();
  } catch (err) {
    console.warn('Review queue load failed:', err.message);
  }
}

function renderReviewQueue() {
  const agentFilter = document.getElementById('review-agent-filter').value;
  const items = agentFilter
    ? state.review.filter(r => r.agentName === agentFilter)
    : state.review;

  document.getElementById('review-count').textContent = items.length;

  // Populate agent filter dropdown
  const allAgents = [...new Set(state.review.map(r => r.agentName))].sort();
  const sel = document.getElementById('review-agent-filter');
  const cur = sel.value;
  sel.innerHTML = '<option value="">All agents</option>';
  allAgents.forEach(name => {
    const opt = document.createElement('option');
    opt.value = name; opt.textContent = name;
    if (name === cur) opt.selected = true;
    sel.appendChild(opt);
  });

  const body = document.getElementById('review-body');

  if (!items.length) {
    body.innerHTML = '<div class="review-empty">&#10003; All content reviewed — ready for the week!</div>';
    return;
  }

  // Group by agent
  const groups = {};
  for (const item of items) {
    if (!groups[item.agentName]) groups[item.agentName] = [];
    groups[item.agentName].push(item);
  }

  body.innerHTML = Object.entries(groups).map(([agent, groupItems]) => `
    <div class="review-group">
      <div class="review-group-header">${esc(agent)} &bull; ${groupItems.length} item${groupItems.length !== 1 ? 's' : ''}</div>
      ${groupItems.map(item => `
        <div class="review-item" data-id="${item.id}">
          <div class="review-item-header">
            <span class="review-type-badge">${esc(item.contentType)}</span>
            <div class="review-item-title" style="cursor:pointer;flex:1;" onclick="const d=this.closest('.review-item').querySelector('.full-content'); if(d){d.style.display=d.style.display==='none'?'block':'none';this.style.opacity=d.style.display==='none'?'1':'0.7';}">${esc(item.title || '(untitled)')} <span style="font-size:10px;opacity:0.5;">▼ click to expand</span></div>
            <span class="review-status-badge status--${item.status}">${item.status.replace(/_/g,' ')}</span>
          </div>
          <div class="full-content" style="display:none;background:rgba(255,255,255,0.05);padding:12px;border-radius:6px;font-size:12px;white-space:pre-wrap;max-height:500px;overflow-y:auto;margin:8px 0;line-height:1.6;border-left:3px solid #f0a500;">${esc(item.content || item.preview || 'No content available')}</div>
          ${item.preview ? `<div class="review-preview" style="cursor:pointer;max-height:80px;overflow:hidden;transition:max-height 0.4s ease;padding:8px;background:rgba(255,255,255,0.03);border-radius:4px;margin-bottom:4px;" onclick="this.style.maxHeight=this.style.maxHeight==='80px'?'2000px':'80px';this.nextElementSibling.style.display=this.style.maxHeight==='80px'?'none':'block'">${esc(item.preview)}</div><div style="display:none;background:rgba(255,255,255,0.05);padding:10px;border-radius:6px;font-size:12px;white-space:pre-wrap;max-height:500px;overflow-y:auto;margin-bottom:8px;line-height:1.6;">${esc(item.content || item.preview)}</div>` : ''}
          ${item.content ? `<div class="review-full-content" style="display:none;background:rgba(255,255,255,0.05);padding:10px;margin-top:8px;border-radius:6px;font-size:12px;white-space:pre-wrap;max-height:400px;overflow-y:auto;">${esc(typeof item.content === 'object' ? JSON.stringify(item.content, null, 2) : item.content)}</div>` : ''}
          <div class="review-item-actions">
            <button class="btn-approve" data-id="${item.id}">&#10003; Approve</button>
            <button class="btn-reject"  data-id="${item.id}">&#10007; Reject</button>
            <button class="btn-edit"    data-id="${item.id}">&#9998; Edit</button>
            <span style="font-size:10px;color:var(--text-faint)">${relativeTime(item.createdAt)}</span>
          </div>
          <div class="reject-reason-form" id="reject-form-${item.id}">
            <input class="reject-reason-input" id="reject-input-${item.id}" placeholder="Reason (optional)..." />
            <button class="btn-reject-confirm" data-id="${item.id}">Confirm Reject</button>
            <button class="btn-reject-cancel"  data-id="${item.id}">Cancel</button>
          </div>
        </div>
      `).join('')}
    </div>
  `).join('');

  body.querySelectorAll('.btn-approve').forEach(btn =>
    btn.addEventListener('click', () => approveReviewItem(parseInt(btn.dataset.id)))
  );
  body.querySelectorAll('.btn-reject').forEach(btn =>
    btn.addEventListener('click', () => {
      document.getElementById(`reject-form-${btn.dataset.id}`)?.classList.toggle('visible');
    })
  );
  body.querySelectorAll('.btn-reject-confirm').forEach(btn =>
    btn.addEventListener('click', () => {
      const reason = document.getElementById(`reject-input-${btn.dataset.id}`)?.value || '';
      rejectReviewItem(parseInt(btn.dataset.id), reason);
    })
  );
  body.querySelectorAll('.btn-reject-cancel').forEach(btn =>
    btn.addEventListener('click', () => {
      document.getElementById(`reject-form-${btn.dataset.id}`)?.classList.remove('visible');
    })
  );
  body.querySelectorAll('.btn-edit').forEach(btn =>
    btn.addEventListener('click', () => openReviewEdit(parseInt(btn.dataset.id)))
  );
}

async function approveReviewItem(id) {
  state.review = state.review.filter(r => r.id !== id);
  renderReviewQueue();
  try {
    const res  = await fetch(`/rv-control/api/review/${id}/approve`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: '{}' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Approve failed');
    showToast('&#10003; Approved' + (data.youtubeUrl ? ' & uploaded to YouTube' : ''));
  } catch (err) { showToast('&#9888; ' + err.message, true); loadReviewQueue(); }
}

async function rejectReviewItem(id, reason) {
  state.review = state.review.filter(r => r.id !== id);
  renderReviewQueue();
  try {
    const res  = await fetch(`/rv-control/api/review/${id}/reject`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ reason }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Reject failed');
    showToast('&#10007; Rejected');
  } catch (err) { showToast('&#9888; ' + err.message, true); loadReviewQueue(); }
}

async function openReviewEdit(id) {
  state.reviewEditId = id;
  document.getElementById('review-edit-title-input').value = '';
  document.getElementById('review-edit-body').value = 'Loading...';
  document.getElementById('review-edit-modal').classList.add('open');
  try {
    const res  = await fetch(`/rv-control/api/review/${id}`);
    const data = await res.json();
    document.getElementById('review-edit-title-input').value = data.title || '';
    let body = data.content || '';
    try { body = JSON.stringify(JSON.parse(body), null, 2); } catch (_) {}
    document.getElementById('review-edit-body').value = body;
  } catch (err) {
    document.getElementById('review-edit-body').value = 'Error: ' + err.message;
  }
}

function closeReviewEdit() {
  document.getElementById('review-edit-modal').classList.remove('open');
  state.reviewEditId = null;
}

document.getElementById('review-edit-save').addEventListener('click', async () => {
  const id = state.reviewEditId; if (!id) return;
  const btn = document.getElementById('review-edit-save');
  btn.textContent = 'Saving...'; btn.disabled = true;
  try {
    const title   = document.getElementById('review-edit-title-input').value.trim();
    const content = document.getElementById('review-edit-body').value;
    const res  = await fetch(`/rv-control/api/review/${id}`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ title, content }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Save failed');
    showToast('&#9998; Saved — back in queue');
    closeReviewEdit(); loadReviewQueue();
  } catch (err) { showToast('&#9888; ' + err.message, true); }
  finally { btn.textContent = 'Save & Re-queue'; btn.disabled = false; }
});

document.getElementById('review-edit-cancel').addEventListener('click',  closeReviewEdit);
document.getElementById('review-edit-close').addEventListener('click',   closeReviewEdit);
document.getElementById('review-edit-overlay').addEventListener('click', closeReviewEdit);
document.getElementById('review-refresh').addEventListener('click',      loadReviewQueue);
document.getElementById('review-agent-filter').addEventListener('change', renderReviewQueue);

// Hook Escape key to also close edit modal
const _origKeydown = document.onkeydown;
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeReviewEdit(); });

// Load immediately + poll every 30 s
loadReviewQueue();
setInterval(loadReviewQueue, 30000);

var calendarWeekOffset = 0;
var calendarPlatform = '';
var DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

async function loadCalendar() {
  try {
    var url = '/rv-control/api/calendar' + String.fromCharCode(63) + 'week=' + calendarWeekOffset;
    if (calendarPlatform) url += String.fromCharCode(38) + 'platform=' + calendarPlatform;
    var res = await fetch(url);
    var data = await res.json();
    renderCalendar(data);
  } catch (err) { console.error('Calendar error:', err); }
}

function renderCalendar(data) {
  var grid = document.getElementById('calendar-grid');
  var label = document.getElementById('cal-week-label');
  var badge = document.getElementById('calendar-count');
  if (!grid) return;
  var start = new Date(data.weekStart + 'T00:00:00');
  var today = new Date().toISOString().split('T')[0];
  label.textContent = fmtD(start) + ' - ' + fmtD(new Date(start.getTime() + 6*86400000));
  badge.textContent = data.posts.length;
  var byDay = {};
  for (var d = 0; d < 7; d++) {
    var dt = new Date(start.getTime() + d * 86400000);
    byDay[dt.toISOString().split('T')[0]] = { date: dt, posts: [] };
  }
  data.posts.forEach(function(p) { var sd = (p.scheduled_date || '').split('T')[0]; if (byDay[sd]) byDay[sd].posts.push(p); });
  var h = '';
  Object.keys(byDay).sort().forEach(function(key) {
    var day = byDay[key];
    var td = key === today;
    h += '<div class="cal-day' + (td ? ' cal-day--today' : '') + '">';
    h += '<div class="cal-day-header">' + DAYS[day.date.getDay()] + '</div>';
    h += '<div class="cal-day-date">' + day.date.getDate() + '</div>';
    if (day.posts.length === 0) { h += '<div class="cal-empty">No posts</div>'; }
    else { day.posts.forEach(function(p) {
      var pr = (p.content || '').substring(0, 60).replace(/[<>"]/g, '');
      var sc = p.status === 'published' ? 'cal-status--published' : p.status === 'approved' ? 'cal-status--approved' : 'cal-status--pending';
      h += '<div class="cal-post" data-platform="' + p.platform + '">';
      h += '<div class="cal-platform">' + p.platform + '</div>';
      h += '<div>' + pr + '</div>';
      h += '<span class="cal-status ' + sc + '">' + p.status + '</span></div>';
    }); }
    h += '</div>';
  });
  grid.innerHTML = h;
}

function fmtD(d) { return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()] + ' ' + d.getDate(); }

document.getElementById('cal-prev').addEventListener('click', function() { calendarWeekOffset--; loadCalendar(); });
document.getElementById('cal-next').addEventListener('click', function() { calendarWeekOffset++; loadCalendar(); });
document.getElementById('cal-platform-filter').addEventListener('change', function(e) { calendarPlatform = e.target.value; loadCalendar(); });

loadCalendar();
setInterval(loadCalendar, 60000);

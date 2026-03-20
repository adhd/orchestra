import type { WorkerEntry, TokenUsage } from "../types/index.js";
import type { HistoryEntry } from "./history.js";

interface DashboardData {
  stats: {
    running: number;
    retrying: number;
    released: number;
    paused: boolean;
    totalSpentUSD: number;
    budgetLimitUSD: number | null;
  };
  workers: WorkerEntry[];
  retries: Array<{
    issueId: string;
    identifier: string;
    attempt: number;
    dueAtMs: number;
    error: string | null;
  }>;
  tokens: TokenUsage;
  history: HistoryEntry[];
}

export function renderDashboard(data: DashboardData): string {
  const { stats, workers, retries, tokens, history } = data;

  const workerRows = workers
    .map(
      (w) => `
      <tr>
        <td><code>${w.issue.identifier}</code></td>
        <td>${escapeHtml(w.issue.title)}</td>
        <td><span class="badge ${w.runAttemptState}">${w.runAttemptState}</span></td>
        <td>${w.attempt}</td>
        <td>${w.turnCount}</td>
        <td>${formatDuration(Date.now() - w.startedAt)}</td>
        <td>$${w.tokenUsage.costUSD.toFixed(4)}</td>
      </tr>`,
    )
    .join("");

  const retryRows = retries
    .map(
      (r) => `
      <tr>
        <td><code>${r.identifier}</code></td>
        <td>${r.attempt}</td>
        <td>${formatDuration(r.dueAtMs - Date.now())}</td>
        <td>${escapeHtml(r.error ?? "—")}</td>
      </tr>`,
    )
    .join("");

  const historyRows = history
    .slice()
    .reverse()
    .map(
      (h) => `
      <tr>
        <td><code>${escapeHtml(h.identifier)}</code></td>
        <td>${escapeHtml(h.title)}</td>
        <td><span class="badge ${h.status}">${h.status}</span></td>
        <td>${h.attempts}</td>
        <td>$${h.totalCostUSD.toFixed(4)}</td>
        <td>${formatDuration(h.durationMs)}</td>
        <td>${escapeHtml(h.error ?? "")}</td>
      </tr>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Orchestra Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0a0a0a; color: #e0e0e0; padding: 2rem; }
    h1 { font-size: 1.5rem; margin-bottom: 1.5rem; color: #fff; }
    h2 { font-size: 1.1rem; margin: 1.5rem 0 0.75rem; color: #aaa; text-transform: uppercase; letter-spacing: 0.05em; }
    .stats { display: flex; gap: 1.5rem; margin-bottom: 2rem; }
    .stat { background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 1rem 1.5rem; }
    .stat-value { font-size: 2rem; font-weight: 700; color: #fff; }
    .stat-label { font-size: 0.8rem; color: #888; margin-top: 0.25rem; }
    table { width: 100%; border-collapse: collapse; background: #1a1a1a; border: 1px solid #333; border-radius: 8px; overflow: hidden; }
    th { text-align: left; padding: 0.75rem 1rem; background: #222; color: #888; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; }
    td { padding: 0.75rem 1rem; border-top: 1px solid #2a2a2a; font-size: 0.9rem; }
    code { background: #2a2a2a; padding: 0.15rem 0.4rem; border-radius: 3px; font-size: 0.85rem; }
    .badge { padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600; }
    .badge.streaming_turn { background: #1a3a2a; color: #4ade80; }
    .badge.preparing_workspace, .badge.building_prompt, .badge.launching_agent { background: #1a2a3a; color: #60a5fa; }
    .badge.succeeded { background: #1a3a2a; color: #4ade80; }
    .badge.failed, .badge.max_retries, .badge.circuit_breaker { background: #3a1a1a; color: #f87171; }
    .badge.completed { background: #1a3a2a; color: #4ade80; }
    .badge.paused-badge { background: #3a3a1a; color: #facc15; font-size: 0.9rem; vertical-align: middle; }
    .empty { color: #555; font-style: italic; padding: 1rem; }
  </style>
</head>
<body>
  <h1>Orchestra${stats.paused ? ' <span class="badge paused-badge">PAUSED</span>' : ""}</h1>

  <div class="stats">
    <div class="stat">
      <div class="stat-value" data-stat="running">${stats.running}</div>
      <div class="stat-label">Running</div>
    </div>
    <div class="stat">
      <div class="stat-value" data-stat="retrying">${stats.retrying}</div>
      <div class="stat-label">Retrying</div>
    </div>
    <div class="stat">
      <div class="stat-value" data-stat="released">${stats.released}</div>
      <div class="stat-label">Completed</div>
    </div>
    <div class="stat">
      <div class="stat-value" data-stat="cost">$${tokens.costUSD.toFixed(2)}</div>
      <div class="stat-label">Total Cost</div>
    </div>
    <div class="stat">
      <div class="stat-value" data-stat="tokens">${formatTokenCount(tokens.input + tokens.output)}</div>
      <div class="stat-label">Total Tokens</div>
    </div>
    <div class="stat">
      <div class="stat-value" data-stat="budget">${stats.budgetLimitUSD !== null ? `$${stats.totalSpentUSD.toFixed(2)} / $${stats.budgetLimitUSD.toFixed(2)}` : "No limit"}</div>
      <div class="stat-label">Budget</div>
    </div>
  </div>

  <h2>Running Workers</h2>
  <div id="workers">
  ${
    workers.length
      ? `<table>
    <thead><tr><th>Issue</th><th>Title</th><th>State</th><th>Attempt</th><th>Turns</th><th>Elapsed</th><th>Cost</th></tr></thead>
    <tbody>${workerRows}</tbody>
  </table>`
      : '<div class="empty">No running workers</div>'
  }
  </div>

  <h2>Retry Queue</h2>
  <div id="retries">
  ${
    retries.length
      ? `<table>
    <thead><tr><th>Issue</th><th>Attempt</th><th>Due In</th><th>Error</th></tr></thead>
    <tbody>${retryRows}</tbody>
  </table>`
      : '<div class="empty">No pending retries</div>'
  }
  </div>

  <h2>Recent History</h2>
  <div id="history">
  ${
    history.length
      ? `<table>
    <thead><tr><th>Issue</th><th>Title</th><th>Status</th><th>Attempts</th><th>Cost</th><th>Duration</th><th>Error</th></tr></thead>
    <tbody>${historyRows}</tbody>
  </table>`
      : '<div class="empty">No history yet</div>'
  }
  </div>

  <script>
  (function() {
    var es = new EventSource('/api/v1/events');

    function $(sel) { return document.querySelector(sel); }

    function formatTokens(n) {
      if (n >= 1e6) return (n/1e6).toFixed(1) + 'M';
      if (n >= 1e3) return (n/1e3).toFixed(1) + 'K';
      return String(n);
    }

    function formatDuration(ms) {
      if (ms < 0) return 'now';
      var s = Math.floor(ms/1000);
      if (s < 60) return s + 's';
      var m = Math.floor(s/60);
      if (m < 60) return m + 'm ' + (s%60) + 's';
      return Math.floor(m/60) + 'h ' + (m%60) + 'm';
    }

    function esc(s) {
      var d = document.createElement('div');
      d.textContent = s;
      return d.innerHTML;
    }

    es.onmessage = function(e) {
      var d = JSON.parse(e.data);
      var now = Date.now();

      // Update stat values
      var el;
      el = $('[data-stat="running"]');
      if (el) el.textContent = d.stats.running;
      el = $('[data-stat="retrying"]');
      if (el) el.textContent = d.stats.retrying;
      el = $('[data-stat="released"]');
      if (el) el.textContent = d.stats.released;
      el = $('[data-stat="cost"]');
      if (el) el.textContent = '$' + d.tokens.costUSD.toFixed(2);
      el = $('[data-stat="tokens"]');
      if (el) el.textContent = formatTokens(d.tokens.input + d.tokens.output);
      el = $('[data-stat="budget"]');
      if (el) el.textContent = d.stats.budgetLimitUSD !== null
        ? '$' + d.stats.totalSpentUSD.toFixed(2) + ' / $' + d.stats.budgetLimitUSD.toFixed(2)
        : 'No limit';

      // Update paused badge
      var h1 = document.querySelector('h1');
      if (h1) {
        var badge = h1.querySelector('.paused-badge');
        if (d.stats.paused && !badge) {
          var span = document.createElement('span');
          span.className = 'badge paused-badge';
          span.textContent = 'PAUSED';
          h1.appendChild(document.createTextNode(' '));
          h1.appendChild(span);
        } else if (!d.stats.paused && badge) {
          badge.remove();
        }
      }

      // Update workers table
      var wc = document.getElementById('workers');
      if (wc) {
        if (d.workers.length === 0) {
          wc.innerHTML = '<div class="empty">No running workers</div>';
        } else {
          var rows = d.workers.map(function(w) {
            var elapsed = now - new Date(w.started_at).getTime();
            return '<tr>' +
              '<td><code>' + esc(w.identifier) + '</code></td>' +
              '<td>' + esc(w.title) + '</td>' +
              '<td><span class="badge ' + esc(w.state) + '">' + esc(w.state) + '</span></td>' +
              '<td>' + w.attempt + '</td>' +
              '<td>' + w.turn_count + '</td>' +
              '<td>' + formatDuration(elapsed) + '</td>' +
              '<td>$' + w.token_usage.costUSD.toFixed(4) + '</td>' +
              '</tr>';
          }).join('');
          wc.innerHTML = '<table>' +
            '<thead><tr><th>Issue</th><th>Title</th><th>State</th><th>Attempt</th><th>Turns</th><th>Elapsed</th><th>Cost</th></tr></thead>' +
            '<tbody>' + rows + '</tbody></table>';
        }
      }

      // Update retries table
      var rc = document.getElementById('retries');
      if (rc) {
        if (d.retries.length === 0) {
          rc.innerHTML = '<div class="empty">No pending retries</div>';
        } else {
          var rrows = d.retries.map(function(r) {
            var due = r.dueAtMs - now;
            return '<tr>' +
              '<td><code>' + esc(r.identifier) + '</code></td>' +
              '<td>' + r.attempt + '</td>' +
              '<td>' + formatDuration(due) + '</td>' +
              '<td>' + esc(r.error || '\\u2014') + '</td>' +
              '</tr>';
          }).join('');
          rc.innerHTML = '<table>' +
            '<thead><tr><th>Issue</th><th>Attempt</th><th>Due In</th><th>Error</th></tr></thead>' +
            '<tbody>' + rrows + '</tbody></table>';
        }
      }
    };

    es.onerror = function() {
      document.title = 'Orchestra (reconnecting...)';
    };

    es.onopen = function() {
      document.title = 'Orchestra';
    };
  })();
  </script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDuration(ms: number): string {
  if (ms < 0) return "now";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

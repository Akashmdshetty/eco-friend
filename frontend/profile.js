// profile.js — improved, robust, and production-friendly
(() => {
  'use strict';

  /************ Config ************/
  const API_BASE = window.API_BASE || 'http://localhost:5000';
  const REQUEST_TIMEOUT = 10_000; // ms
  const currentUser = (() => {
    // Prefer username from token or local storage; fallback to the old global
    try {
      const token = localStorage.getItem('ecowise_token');
      if (!token) return window.currentUser || 'EcoStudent';
      // naive extraction if JWT-like: second part is payload
      const parts = token.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
        return payload.username || window.currentUser || 'EcoStudent';
      }
    } catch (e) { /* ignore */ }
    return window.currentUser || 'EcoStudent';
  })();

  /************ DOM refs ************/
  const $ = id => document.getElementById(id);
  const profileUsernameEl = $('profileUsername');
  const profileLevelEl = $('profileLevel');
  const statPointsEl = $('statPoints');
  const statItemsEl = $('statItems');
  const statCarbonEl = $('statCarbon');
  const historyListEl = $('historyList');
  const refreshBtn = document.querySelector('.refresh-btn');
  const exportBtn = document.querySelector('.action-btn'); // first export button
  const leaderboardBtn = document.querySelector('.action-btn.secondary');
  const analyzePageLink = 'analyze.html';

  /************ Helpers ************/
  function safeText(v) { return String(v == null ? '' : v); }

  function timeoutFetch(url, opts = {}, timeout = REQUEST_TIMEOUT) {
    const controller = new AbortController();
    opts.signal = controller.signal;
    const timer = setTimeout(() => controller.abort(), timeout);
    return fetch(url, opts)
      .then(async res => {
        clearTimeout(timer);
        const text = await res.text();
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
        return { ok: res.ok, status: res.status, json, text };
      })
      .catch(err => {
        clearTimeout(timer);
        throw err;
      });
  }

  // small number animation for stats
  function animateNumber(el, from, to, duration = 700, suffix = '') {
    if (!el) return;
    const start = performance.now();
    const diff = to - from;
    (function frame(now) {
      const progress = Math.min((now - start) / duration, 1);
      const value = Math.floor(from + diff * progress);
      el.textContent = suffix ? `${value}${suffix}` : value;
      if (progress < 1) requestAnimationFrame(frame);
    })(start);
  }

  // build accessible modal (small, reusable)
  function showModal(title, htmlContent, { closable = true } = {}) {
    const root = document.createElement('div');
    root.className = 'modal-backdrop';
    root.style.cssText = 'position:fixed;inset:0;z-index:1200;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6)';
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.cssText = 'background:var(--surface);border-radius:12px;padding:16px;max-width:800px;width:95%';
    modal.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <h3 style="margin:0">${title}</h3>
        ${closable ? '<button aria-label="Close modal" data-close class="btn ghost"><i class="fas fa-times"></i></button>' : ''}
      </div>
      <div>${htmlContent}</div>
    `;
    root.appendChild(modal);
    document.body.appendChild(root);
    function close() { root.remove(); }
    root.addEventListener('click', e => { if (e.target === root) close(); });
    modal.querySelectorAll('[data-close]').forEach(btn => btn.addEventListener('click', close));
    return { close };
  }

  // present small toast-like message
  function toast(msg) {
    console.info('TOAST:', msg);
    alert(String(msg)); // simple fallback; replace with fancier toast if available
  }

  // fallback/mock data (used when API fails)
  function mockProfile() {
    return {
      username: currentUser,
      level: 'Eco Friend',
      eco_points: 245,
      items_recycled: 32,
      carbon_saved_kg: 47,
      member_since: '2024-01-01T00:00:00Z',
      email: ''
    };
  }
  function mockHistory() {
    return [
      { filename: "Plastic Bottle", processed_at: "2024-01-15T10:30:00Z", points_earned: 10 },
      { filename: "Old Books", processed_at: "2024-01-14T14:22:00Z", points_earned: 15 },
      { filename: "Cardboard Box", processed_at: "2024-01-13T09:15:00Z", points_earned: 5 },
      { filename: "Glass Jar", processed_at: "2024-01-12T16:45:00Z", points_earned: 8 }
    ];
  }

  /************ UI Renderers ************/
  function renderProfile(profile) {
    profileUsernameEl.textContent = safeText(profile.username || 'User');
    profileLevelEl.textContent = safeText(profile.level || 'Eco Friend');
    animateNumber(statPointsEl, 0, Number(profile.eco_points || 0), 900);
    animateNumber(statItemsEl, 0, Number(profile.items_recycled || 0), 900);
    animateNumber(statCarbonEl, 0, Number(profile.carbon_saved_kg || 0), 900, 'kg');
    updateAchievements(profile.eco_points || 0, profile.items_recycled || 0, profile.carbon_saved_kg || 0);
  }

  function renderHistory(history) {
    if (!history || history.length === 0) {
      historyListEl.innerHTML = `
        <div class="no-history" style="padding:18px">
          <p>No recycling history yet.</p>
          <a href="${analyzePageLink}" class="cta-link">Start analyzing items! 📸</a>
        </div>`;
      return;
    }

    historyListEl.innerHTML = history.map(item => {
      const date = item.processed_at ? new Date(item.processed_at).toLocaleDateString() : '-';
      const points = item.points_earned ?? item.points ?? 0;
      return `
        <div class="history-item">
          <div style="display:flex;align-items:center;gap:12px">
            <div class="history-icon">📸</div>
            <div>
              <strong>${safeText(item.filename || 'Item')}</strong>
              <div class="muted">${date}</div>
            </div>
          </div>
          <div class="history-points">+${safeText(points)} pts</div>
        </div>`;
    }).join('');
  }

  function updateAchievements(points = 0, items = 0, carbon = 0) {
    const byId = id => document.getElementById(id);
    if (!byId) return;
    const map = [
      { id: 'achv-first', cond: items > 0 },
      { id: 'achv-200', cond: points >= 200 },
      { id: 'achv-50', cond: items >= 50 },
      { id: 'achv-carbon', cond: carbon >= 100 }
    ];
    map.forEach(entry => {
      const el = document.getElementById(entry.id);
      if (!el) return;
      el.classList.toggle('unlocked', !!entry.cond);
      el.classList.toggle('locked', !entry.cond);
    });
  }

  /************ API Actions ************/
  async function fetchProfile() {
    const url = `${API_BASE}/user/${encodeURIComponent(currentUser)}`;
    try {
      const resp = await timeoutFetch(url);
      if (resp.ok && resp.json) return resp.json;
      console.warn('fetchProfile non-ok or invalid json', resp.status, resp.json);
      return mockProfile();
    } catch (err) {
      console.warn('fetchProfile failed', err);
      return mockProfile();
    }
  }

  async function fetchHistory() {
    const url = `${API_BASE}/user/${encodeURIComponent(currentUser)}/history`;
    try {
      const resp = await timeoutFetch(url);
      if (resp.ok && Array.isArray(resp.json)) return resp.json;
      if (resp.ok && resp.json && Array.isArray(resp.json.history)) return resp.json.history;
      console.warn('fetchHistory non-ok or invalid json', resp.status);
      return mockHistory();
    } catch (err) {
      console.warn('fetchHistory failed', err);
      return mockHistory();
    }
  }

  async function loadProfileAndHistory() {
    // visual feedback
    historyListEl.innerHTML = '<div class="loading-history" style="padding:18px">Loading your recycling history...</div>';
    try {
      const [profile, history] = await Promise.all([fetchProfile(), fetchHistory()]);
      renderProfile(profile);
      renderHistory(history);
    } catch (err) {
      console.error('loadProfileAndHistory error', err);
      renderProfile(mockProfile());
      renderHistory(mockHistory());
    }
  }

  async function exportUserData() {
    exportBtn.disabled = true;
    const original = exportBtn.innerHTML;
    exportBtn.innerHTML = '<span class="loader" aria-hidden="true"></span> Exporting...';

    try {
      const [profile, history] = await Promise.all([fetchProfile(), fetchHistory()]);
      const exportObj = {
        profile,
        history,
        exported_at: new Date().toISOString(),
        totals: {
          items_recycled: profile.items_recycled || history.length || 0,
          carbon_saved_kg: profile.carbon_saved_kg || 0
        }
      };
      const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ecowise_export_${currentUser}_${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast('📊 Your EcoWise data has been exported!');
    } catch (err) {
      console.error('exportUserData error', err);
      toast('❌ Failed to export data. See console.');
    } finally {
      setTimeout(() => {
        exportBtn.disabled = false;
        exportBtn.innerHTML = original;
      }, 600);
    }
  }

  async function showLeaderboard() {
    try {
      const resp = await timeoutFetch(`${API_BASE}/leaderboard`);
      let list = [];
      if (resp.ok && Array.isArray(resp.json)) list = resp.json;
      else list = [
        { username: 'EcoMaster', eco_points: 542, level: 'Eco Champion' },
        { username: 'GreenWarrior', eco_points: 387, level: 'Eco Warrior' },
        { username: currentUser, eco_points: 245, level: 'Eco Friend' }
      ];

      const html = list.map((u, i) => {
        const rank = i + 1;
        const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}.`;
        const isCurrent = u.username === currentUser;
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px;border-radius:8px;margin-bottom:8px;background:${isCurrent ? 'rgba(16,185,129,0.08)' : 'transparent'};border:1px solid var(--glass-border)">
                  <div style="display:flex;gap:12px;align-items:center"><div style="font-weight:700">${medal}</div><div>${safeText(u.username)}</div></div>
                  <div style="font-weight:700;color:var(--primary)">${safeText(u.eco_points)} pts</div>
                </div>`;
      }).join('');

      showModal('🏆 Eco Leaderboard', `<div>${html}</div>`);
    } catch (err) {
      console.error('showLeaderboard error', err);
      toast('Unable to load leaderboard. Try again later.');
    }
  }

  /************ Event wiring ************/
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.disabled = true;
      refreshBtn.textContent = '🔄 Loading...';
      await loadProfileAndHistory();
      setTimeout(() => { refreshBtn.disabled = false; refreshBtn.textContent = '🔄 Refresh'; }, 400);
    });
  }

  if (exportBtn) exportBtn.addEventListener('click', exportUserData);
  if (leaderboardBtn) leaderboardBtn.addEventListener('click', showLeaderboard);

  // initial load
  document.addEventListener('DOMContentLoaded', loadProfileAndHistory);

  // expose for debugging/console
  window.EcoWiseProfile = {
    load: loadProfileAndHistory,
    exportData: exportUserData,
    showLeaderboard,
    _mockProfile: mockProfile,
    _mockHistory: mockHistory
  };

})();

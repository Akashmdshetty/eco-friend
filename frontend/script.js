// scripts.js — complete, robust frontend helper for EcoWise
// - preview & validation
// - upload with timeout & progress
// - resilient parsing of backend responses (many possible shapes)
// - demo mode, profile, centers, export & share helpers
// - no mandatory auth for analysis (easier dev/testing)
// - debug log: prints backend response payload for inspection

(() => {
  'use strict';

  /* ======= Config ======= */
  const API_BASE = window.API_BASE || 'http://localhost:5000';
  const API_TIMEOUT = 15000;              // fetch timeout in ms
  const UPLOAD_TIMEOUT_MS = 60000;        // XHR upload timeout
  const MAX_IMAGE_SIZE = 8 * 1024 * 1024; // 8MB
  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const DEFAULT_USERNAME = 'Guest';

  /* ======= State ======= */
  let authToken = null;
  try { authToken = localStorage.getItem('ecowise_token') || null; } catch (e) { authToken = null; }
  let currentUser = DEFAULT_USERNAME;
  try { currentUser = localStorage.getItem('ecowise_username') || currentUser; } catch (e) {}
  let demoTimer = null;
  let inDemo = false;
  let previewObjectUrl = null;

  /* ======= DOM refs (defensive) ======= */
  const $id = (id) => document.getElementById(id);
  const fileInput = $id('imageUpload');
  const previewArea = $id('imagePreview');
  const analyzeBtn = $id('analyzeButton');
  const resultsSection = $id('resultsSection') || $id('results');
  const resultsContent = $id('resultsContent') || $id('resultsContent');
  const profileContent = $id('profileContent');
  const exportBtn = document.querySelector('.export-btn');
  const demoBtn = document.querySelector('.demo-btn');

  /* ======= Utilities ======= */
  const log = (...args) => console.log('[ecowise]', ...args);
  function safeJsonParse(text) { try { return text ? JSON.parse(text) : null; } catch (e) { return text; } }

  function fetchWithTimeout(url, opts = {}, timeout = API_TIMEOUT) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    opts.signal = controller.signal;
    return fetch(url, opts).then(async (res) => {
      clearTimeout(timer);
      const txt = await res.text();
      const json = safeJsonParse(txt);
      return { ok: res.ok, status: res.status, json, text: txt, res };
    }).catch((err) => {
      clearTimeout(timer);
      throw err;
    });
  }

  function getAuthHeaders(extra = {}) {
    const h = Object.assign({}, extra);
    if (authToken) h['Authorization'] = `Bearer ${authToken}`;
    return h;
  }

  function showInlineMessage(containerId, message, isError = true) {
    const container = $id(containerId);
    if (!container) {
      isError ? alert(message) : console.info(message);
      return;
    }
    container.innerHTML = `<div role="status" aria-live="polite" style="padding:12px;border-radius:8px;background:${isError ? '#fee2e2' : '#ecfdf5'};color:${isError ? '#991b1b' : '#065f46'}">${message}</div>`;
    if (!isError) setTimeout(() => { if (container) container.innerHTML = ''; }, 3500);
  }

  function createModal(html, options = {}) {
    const { closeOnEsc = true } = options;
    closeModal();
    const overlay = document.createElement('div');
    overlay.id = 'ecowise-modal';
    overlay.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);z-index:9999;padding:16px';
    const box = document.createElement('div');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.style.cssText = 'background:#0f172a;color:#fff;border-radius:10px;max-width:920px;width:100%;max-height:90vh;overflow:auto;padding:18px;box-shadow:0 12px 40px rgba(2,6,23,0.35)';
    box.innerHTML = html;
    overlay.appendChild(box);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
    document.body.appendChild(overlay);

    if (closeOnEsc) {
      const esc = (e) => { if (e.key === 'Escape') closeModal(); };
      overlay._escHandler = esc;
      document.addEventListener('keydown', esc);
    }
    return {
      close: closeModal
    };

    function closeModal() {
      const ex = document.getElementById('ecowise-modal');
      if (!ex) return;
      if (ex._escHandler) document.removeEventListener('keydown', ex._escHandler);
      ex.remove();
    }
  }

  function closeModal() {
    const ex = document.getElementById('ecowise-modal');
    if (ex) ex.remove();
  }

  function copyToClipboard(text) {
    if (navigator.clipboard) return navigator.clipboard.writeText(text);
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { log('copy failed', e); }
    ta.remove();
    return Promise.resolve();
  }

  /* ======= Preview & validation ======= */
  function validateImageFile(file) {
    if (!file) return 'No file selected';
    if (!ALLOWED_TYPES.includes(file.type)) return 'Unsupported file type — use JPG/PNG/WebP/GIF';
    if (file.size > MAX_IMAGE_SIZE) return `Image too large — keep under ${Math.round(MAX_IMAGE_SIZE / 1024 / 1024)} MB`;
    return null;
  }

  function safeRevokePreview() {
    if (previewObjectUrl) {
      try { URL.revokeObjectURL(previewObjectUrl); } catch (e) {}
      previewObjectUrl = null;
    }
  }

  function showImagePreview(file) {
    if (!previewArea) return;
    if (!file) { previewArea.style.display = 'none'; previewArea.innerHTML = ''; safeRevokePreview(); return; }
    const reader = new FileReader();
    reader.onload = (e) => {
      previewArea.style.display = '';
      previewArea.innerHTML = `
        <div style="display:flex;gap:12px;align-items:center">
          <img src="${e.target.result}" alt="preview" style="max-width:160px;max-height:120px;border-radius:8px;object-fit:cover;border:1px solid rgba(255,255,255,0.04)"/>
          <div>
            <div style="font-weight:700">${file.name}</div>
            <div style="color:#94a3b8;font-size:.9rem">${(file.size/1024).toFixed(1)} KB • ${file.type}</div>
          </div>
        </div>
      `;
    };
    reader.readAsDataURL(file);
  }

  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      const err = validateImageFile(f);
      if (err) { showInlineMessage('resultsContent', err, true); showImagePreview(null); return; }
      showImagePreview(f);
      if (resultsSection) resultsSection.style.display = 'none';
    });
  }

  /* ======= Upload & analyze ======= */
  async function analyzeImage() {
    // No required auth for analysis to make dev easier
    const file = (fileInput && fileInput.files && fileInput.files[0]) || null;
    const validation = validateImageFile(file);
    if (validation) { showInlineMessage('resultsContent', validation, true); return; }
    if (!resultsSection) throw new Error('resultsSection missing from DOM');
    resultsSection.style.display = '';
    resultsContent.innerHTML = `<div style="padding:12px">🔄 Analyzing ${file.name}…</div>`;
    if (analyzeBtn) { analyzeBtn.disabled = true; analyzeBtn.dataset.prev = analyzeBtn.innerHTML; analyzeBtn.innerHTML = 'Analyzing…'; }

    try {
      const compressed = await maybeCompress(file);
      const form = new FormData();
      form.append('image', compressed, file.name || `upload_${Date.now()}.jpg`);
      form.append('username', currentUser || DEFAULT_USERNAME);

      const result = await uploadWithProgress(`${API_BASE}/detect`, form, (p) => {
        // optionally show progress
        const prog = $id('uploadProgress');
        if (prog && typeof p === 'number') { prog.value = p; prog.style.display = ''; }
      });

      // debug: inspect backend response payload
      console.log('[ecowise] analyze response:', result);

      // normalize payload shape
      const data = normalizeResponse(result);
      renderResults(data);
      // refresh profile best-effort
      loadUserProfile().catch(() => {});
    } catch (err) {
      log('analyze error', err);
      resultsContent.innerHTML = `<div style="padding:12px;color:#fb923c">❌ Analysis failed — ${err && err.message ? err.message : 'server or network error'}</div>`;
    } finally {
      if (analyzeBtn) { analyzeBtn.disabled = false; analyzeBtn.innerHTML = analyzeBtn.dataset.prev || 'Analyze'; }
      const prog = $id('uploadProgress'); if (prog) prog.style.display = 'none';
    }
  }

  // compress image moderately if large — returns a Blob (File-like)
  async function maybeCompress(file) {
    if (!file) throw new Error('No file to upload');
    if (file.size <= 1.5 * 1024 * 1024) return file; // small enough
    // use canvas and toBlob to compress
    const img = await loadImageBitmap(file);
    const MAX_W = 1600;
    let w = img.width, h = img.height;
    if (w > MAX_W) { h = Math.round(h * (MAX_W / w)); w = MAX_W; }
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    let quality = 0.9;
    let blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
    while (blob && blob.size > MAX_IMAGE_SIZE && quality > 0.35) {
      quality -= 0.07;
      blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
    }
    return blob || file;
  }

  function loadImageBitmap(file) {
    if (window.createImageBitmap) return createImageBitmap(file);
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
        resolve(canvas);
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }

  // XHR upload for progress with timeout
  function uploadWithProgress(url, formData, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url, true);
      xhr.responseType = 'json';
      if (authToken) xhr.setRequestHeader('Authorization', `Bearer ${authToken}`);
      const abortTimer = setTimeout(() => { xhr.abort(); reject(new Error('Upload timeout')); }, UPLOAD_TIMEOUT_MS);
      xhr.upload.onprogress = (e) => { if (e.lengthComputable && typeof onProgress === 'function') onProgress(e.loaded / e.total); };
      xhr.onload = () => {
        clearTimeout(abortTimer);
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(xhr.response || xhr.responseText || {});
        } else {
          reject(new Error(`Upload failed (status ${xhr.status})`));
        }
      };
      xhr.onerror = () => { clearTimeout(abortTimer); reject(new Error('Network error during upload')); };
      try { xhr.send(formData); } catch (e) { clearTimeout(abortTimer); reject(e); }
    });
  }

  // Normalize backend response into a well-known shape the UI expects
  function normalizeResponse(raw) {
    // raw might be { success, detected_objects: [...], recommendations: [...], eco_points, carbon_saved_kg, ... }
    // it might also be plain array, or { objects: [...] }, etc.
    if (!raw) return { success: false, detected_objects: [], recommendations: [], eco_points: 0, carbon_saved_kg: 0 };
    // If fetchWithTimeout returned object wrapper: { ok, status, json }
    if (raw && raw.json && (raw.status || raw.res)) raw = raw.json;

    // attempt to find detected objects
    let detected = [];
    if (Array.isArray(raw.detected_objects)) detected = raw.detected_objects;
    else if (Array.isArray(raw.detected)) detected = raw.detected;
    else if (Array.isArray(raw.objects)) detected = raw.objects;
    else if (Array.isArray(raw.results)) detected = raw.results;
    else if (Array.isArray(raw.items)) detected = raw.items;
    else if (Array.isArray(raw)) detected = raw;

    // each detection might use conf/score/confidence and label/name/class
    detected = detected.map((d) => {
      const name = d.name || d.label || d.class || d.type || d.item || (d.names && d.names[d.cls]) || 'item';
      const conf = (d.conf !== undefined) ? d.conf : (d.confidence !== undefined ? d.confidence : (d.score !== undefined ? d.score : (d.probability !== undefined ? d.probability : 0)));
      const bbox = d.bbox || d.xyxy || d.box || null;
      return { name: String(name || '').trim(), conf: Number(conf || 0), bbox };
    });

    // recommendations
    let recs = [];
    if (Array.isArray(raw.recommendations)) recs = raw.recommendations;
    else if (Array.isArray(raw.recs)) recs = raw.recs;
    else if (Array.isArray(raw.recommend)) recs = raw.recommend;
    else if (raw.recommendation) recs = [raw.recommendation];
    else if (raw.message) recs = [raw.message];

    // fallback: if detected list but recommendations empty, build generic recs per item
    if (!recs.length && detected.length) {
      recs = detected.map(d => `${d.name} — Unknown: please consult local recycling rules`);
    }

    const eco_points = raw.eco_points !== undefined ? raw.eco_points : raw.points || raw.points_earned || 0;
    const carbon_saved_kg = raw.carbon_saved_kg !== undefined ? raw.carbon_saved_kg : raw.carbon || 0;
    const filename = raw.filename || raw.file || '';

    return {
      success: raw.success !== undefined ? raw.success : true,
      detected_objects: detected,
      recommendations: recs,
      eco_points: eco_points,
      carbon_saved_kg: carbon_saved_kg,
      filename,
      debug: raw.debug || { model_loaded: raw.model_loaded || false, detections_count: detected.length }
    };
  }

  /* ======= Render results ======= */
  function sanitizeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function renderResults(data) {
    if (!resultsContent) return;
    resultsContent.innerHTML = '';
    if (!data || !data.success) {
      resultsContent.innerHTML = `<div style="padding:12px;color:#f97316">No valid result received from server</div>`;
      return;
    }

    const detected = Array.isArray(data.detected_objects) ? data.detected_objects : [];
    const recs = Array.isArray(data.recommendations) ? data.recommendations : [];

    const countsHtml = `
      <div style="display:flex;gap:12px;align-items:center;justify-content:space-between">
        <div style="font-weight:700">Analysis Results</div>
        <div style="color:#10b981;font-weight:700">+${data.eco_points || 0} pts</div>
      </div>
    `;

    // build left column (overview + list)
    let itemsHtml = '';
    if (!detected.length) {
      itemsHtml = `<div style="padding:16px;color:#94a3b8">No objects detected — try a clearer photo or different angle.</div>`;
    } else {
      itemsHtml = `<ul style="margin:0;padding:0;list-style:none">` + detected.map(d => {
        const confPct = Math.round((d.conf || 0) * 100);
        const label = sanitizeHtml(d.name || 'item');
        return `<li style="display:flex;justify-content:space-between;padding:10px;border-bottom:1px solid rgba(255,255,255,0.02)"><span style="font-weight:600">${label}</span><span style="color:#94a3b8">${confPct}%</span></li>`;
      }).join('') + `</ul>`;
    }

    const recsHtml = recs.length ? `<ul style="padding-left:16px;margin:0">${recs.map(r => `<li>${sanitizeHtml(r)}</li>`).join('')}</ul>` : `<div style="color:#94a3b8">No recommendations.</div>`;

    const summaryHtml = `
      <div style="padding:12px">
        ${countsHtml}
        <div style="margin-top:12px;display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px">
          <div style="background:rgba(255,255,255,0.02);border-radius:8px;padding:10px">
            <div style="font-size:.85rem;color:#94a3b8">Objects</div>
            <div style="font-weight:700;font-size:1.1rem">${detected.length}</div>
          </div>
          <div style="background:rgba(255,255,255,0.02);border-radius:8px;padding:10px">
            <div style="font-size:.85rem;color:#94a3b8">EcoPoints</div>
            <div style="font-weight:700;font-size:1.1rem">+${data.eco_points || 0}</div>
          </div>
          <div style="background:rgba(255,255,255,0.02);border-radius:8px;padding:10px">
            <div style="font-size:.85rem;color:#94a3b8">Carbon saved</div>
            <div style="font-weight:700;font-size:1.1rem">${data.carbon_saved_kg || 0} kg</div>
          </div>
        </div>

        <section style="margin-top:14px">
          <h4 style="margin:0 0 8px 0">Detected items</h4>
          ${itemsHtml}
        </section>

        <section style="margin-top:12px">
          <h4 style="margin:0 0 8px 0">Recommendations</h4>
          ${recsHtml}
        </section>

        <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
          <button id="btnCenters" style="padding:8px 12px;border-radius:8px;background:#10b981;color:white;border:none;cursor:pointer">📍 Find Centers</button>
          <button id="btnHistory" style="padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.04);background:transparent;cursor:pointer">📄 History</button>
          <button id="btnShare" style="padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.04);background:transparent;cursor:pointer">🔗 Share</button>
        </div>

        <div id="ecowise-locations" style="margin-top:12px;display:none"></div>
        <div id="ecowise-history" style="margin-top:12px;display:none"></div>
      </div>
    `;

    resultsContent.innerHTML = summaryHtml;

    // attach buttons
    const btnCenters = $id('btnCenters');
    const btnHistory = $id('btnHistory');
    const btnShare = $id('btnShare');
    if (btnCenters) btnCenters.addEventListener('click', showRecyclingCenters);
    if (btnHistory) btnHistory.addEventListener('click', showUserHistory);
    if (btnShare) btnShare.addEventListener('click', () => {
      const text = `I used EcoWise and found ${detected.length} items — got +${data.eco_points || 0} EcoPoints!`;
      if (navigator.share) navigator.share({ title: 'EcoWise result', text }).catch(() => copyToClipboard(text));
      else copyToClipboard(text).then(() => showInlineMessage('resultsContent', 'Share text copied', false));
    });
  }

  /* ======= Centers & History helpers ======= */
  async function showRecyclingCenters() {
    try {
      const { ok, json } = await fetchWithTimeout(`${API_BASE}/recycling-centers`, { headers: getAuthHeaders({ 'Content-Type': 'application/json' }) });
      if (!ok) { showInlineMessage('resultsContent', 'Could not load centers', true); return; }
      const centers = Array.isArray(json) ? json : (json.centers || []);
      const container = $id('ecowise-locations');
      if (!container) return;
      container.innerHTML = centers.map(c => `
        <div style="border:1px solid rgba(255,255,255,0.02);padding:10px;border-radius:8px;margin-bottom:8px;display:flex;justify-content:space-between">
          <div>
            <div style="font-weight:700">${sanitize(c.name)}</div>
            <div style="color:#94a3b8">${sanitize(c.address || '')}</div>
          </div>
          <div style="text-align:right">
            <div style="font-weight:700;color:#10b981">${c.distance || '--'}</div>
            <div style="margin-top:8px"><button style="padding:6px 8px;border-radius:6px;background:#3b82f6;color:#fff;border:none;cursor:pointer" onclick="event.stopPropagation(); window.ecowise.showCenterDetails(${c.id})">Details</button></div>
          </div>
        </div>
      `).join('') || '<div style="color:#94a3b8">No centers available</div>';
      container.style.display = '';
      const hist = $id('ecowise-history'); if (hist) hist.style.display = 'none';
    } catch (err) {
      log('centers err', err);
      showInlineMessage('resultsContent', 'Could not fetch centers', true);
    }
  }

  async function showUserHistory() {
    // no required auth for view in dev; if your backend requires auth, you can uncomment requireAuth()
    try {
      const { ok, json } = await fetchWithTimeout(`${API_BASE}/user/${encodeURIComponent(currentUser)}/history`, { headers: getAuthHeaders({ 'Content-Type': 'application/json' }) });
      if (!ok) { showInlineMessage('resultsContent', 'Unable to load history', true); return; }
      const history = (json && json.history) ? json.history : (Array.isArray(json) ? json : []);
      const container = $id('ecowise-history');
      if (!container) return;
      container.innerHTML = history.length ? history.map(h => `
        <div style="padding:8px;border-bottom:1px solid rgba(255,255,255,0.02);display:flex;justify-content:space-between">
          <div>
            <div style="font-weight:700">${sanitize(h.filename || 'Item')}</div>
            <div style="color:#94a3b8;font-size:.85rem">${h.processed_at ? (new Date(h.processed_at)).toLocaleString() : ''}</div>
          </div>
          <div style="font-weight:700;color:#10b981">+${h.points_earned || h.points || 0} pts</div>
        </div>
      `).join('') : '<div style="color:#94a3b8">No history yet</div>';
      container.style.display = '';
      const loc = $id('ecowise-locations'); if (loc) loc.style.display = 'none';
    } catch (err) {
      log('history err', err);
      showInlineMessage('resultsContent', 'Could not load history', true);
    }
  }

  async function exportUserData() {
    try {
      const [uRes, hRes] = await Promise.all([
        fetchWithTimeout(`${API_BASE}/user/${encodeURIComponent(currentUser)}`, { headers: getAuthHeaders({ 'Content-Type': 'application/json' }) }),
        fetchWithTimeout(`${API_BASE}/user/${encodeURIComponent(currentUser)}/history`, { headers: getAuthHeaders({ 'Content-Type': 'application/json' }) })
      ]);
      if (!uRes.ok || !hRes.ok) throw new Error('Failed to fetch export data');
      const payload = { profile: uRes.json || {}, history: (hRes.json && hRes.json.history) ? hRes.json.history : (hRes.json || []), exported_at: new Date().toISOString() };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `ecowise_export_${currentUser}_${Date.now()}.json`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      showInlineMessage('resultsContent', 'Export completed', false);
    } catch (err) {
      log('export err', err);
      showInlineMessage('resultsContent', 'Export failed', true);
    }
  }

  /* ======= Demo Mode ======= */
  const PROJECT_ZIP_URL = '/mnt/data/ecowise-project[1].zip'; // developer-only: reference path for demo filenames
  function startDemoMode() {
    if (inDemo) return;
    inDemo = true;
    showInlineMessage('resultsContent', '🚀 Demo mode started — processing sample images', false);
    const demoFiles = [
      'plastic_water_bottle.jpg',
      'old_smartphone.png',
      'textbook.jpeg'
    ];
    let i = 0;
    demoTimer = setInterval(async () => {
      if (i >= demoFiles.length) {
        clearInterval(demoTimer); inDemo = false; showInlineMessage('resultsContent', 'Demo finished', false); return;
      }
      // simulate selection for UI only
      const dummy = new File([new Blob([''])], demoFiles[i], { type: 'image/jpeg' });
      try {
        const dt = new DataTransfer(); dt.items.add(dummy); if (fileInput) fileInput.files = dt.files;
      } catch (e) {
        // fallback: ignore
      }
      showImagePreview(dummy);
      await analyzeImage();
      i++;
    }, 2200);
  }

  function stopDemoMode() {
    if (demoTimer) clearInterval(demoTimer);
    inDemo = false;
    showInlineMessage('resultsContent', 'Demo stopped', false);
  }

  /* ======= Profile loader ======= */
  async function loadUserProfile() {
    if (!profileContent) return;
    profileContent.innerHTML = '<div style="color:#94a3b8">Loading…</div>';
    try {
      if (authToken) {
        // try /me first (if implemented)
        const me = await fetchWithTimeout(`${API_BASE}/me`, { headers: getAuthHeaders({ 'Content-Type': 'application/json' }) }).catch(() => null);
        if (me && me.ok && me.json && me.json.user) {
          currentUser = me.json.user.username || currentUser;
        }
      }
    } catch (e) { /* ignore */ }

    try {
      const { ok, json } = await fetchWithTimeout(`${API_BASE}/user/${encodeURIComponent(currentUser)}`, { headers: getAuthHeaders({ 'Content-Type': 'application/json' }) });
      if (!ok) { profileContent.innerHTML = `<div style="color:#94a3b8">Profile not available</div>`; return; }
      const p = json || {};
      profileContent.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <div style="font-weight:700">${sanitize(p.username || currentUser)}</div>
            <div style="color:#94a3b8">${sanitize(p.level || 'Eco Friend')}</div>
          </div>
          <div style="text-align:right">
            <div style="font-weight:700;color:#10b981">${p.eco_points || 0}</div>
            <div style="font-size:.85rem;color:#94a3b8">EcoPoints</div>
          </div>
        </div>
      `;
    } catch (err) {
      log('profile err', err);
      profileContent.innerHTML = `<div style="color:#94a3b8">Backend not reachable</div>`;
    }
  }

  /* ======= Misc helpers & wiring ======= */
  function sanitize(s) { if (s == null) return ''; return String(s).replace(/[&<>"'`=\/]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;",'/':'&#x2F;','`':'&#x60;','=':'&#x3D;'}[c])); }

  // Wire UI events after DOM ready
  document.addEventListener('DOMContentLoaded', () => {
    if (analyzeBtn) analyzeBtn.addEventListener('click', analyzeImage);
    if (exportBtn) exportBtn.addEventListener('click', exportUserData);
    if (demoBtn) demoBtn.addEventListener('click', startDemoMode);
    // Expose a few helpers for debug & small buttons
    window.ecowise = window.ecowise || {};
    Object.assign(window.ecowise, {
      analyzeImage, startDemoMode, stopDemoMode, exportUserData,
      showCenterDetails: showCenterDetails, getDirections: getDirections, callCenter: callCenter
    });
    loadUserProfile().catch(() => {});
    log('scripts.js loaded — API_BASE =', API_BASE);
  });

  /* ======= Center detail small helpers (used by showCenterDetails) ======= */
  async function showCenterDetails(id) {
    try {
      const { ok, json } = await fetchWithTimeout(`${API_BASE}/recycling-centers`, { headers: getAuthHeaders({ 'Content-Type': 'application/json' }) });
      if (!ok) { showInlineMessage('resultsContent', 'Could not load centers', true); return; }
      const centers = Array.isArray(json) ? json : (json.centers || []);
      const c = centers.find(x => x.id === id);
      if (!c) { showInlineMessage('resultsContent', 'Center not found', true); return; }
      const html = `
        <div style="display:flex;justify-content:space-between;align-items:center">
          <h3 style="margin:0">${sanitize(c.name)}</h3>
          <button onclick="document.getElementById('ecowise-modal')?.remove()" style="border:none;background:none;font-size:20px;cursor:pointer;color:#fff">×</button>
        </div>
        <div style="margin-top:10px;color:#94a3b8">${sanitize(c.address || '')}</div>
        <div style="margin-top:10px"><strong>Hours:</strong> ${sanitize(c.hours || 'N/A')}</div>
        <div style="margin-top:8px"><strong>Phone:</strong> ${sanitize(c.phone || 'N/A')}</div>
        <div style="margin-top:12px;display:flex;gap:8px">
          <button style="padding:8px 10px;border-radius:8px;background:#10b981;color:#fff;border:none;cursor:pointer" onclick="window.ecowise.getDirections(${c.id})">Directions</button>
          ${c.phone ? `<button style="padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.04);background:transparent;cursor:pointer" onclick="window.ecowise.callCenter('${sanitize(c.phone)}')">Call</button>` : ''}
          ${c.website ? `<button style="padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.04);background:transparent;cursor:pointer" onclick="window.open('${sanitize(c.website)}','_blank')">Visit</button>` : ''}
        </div>
      `;
      createModal(html);
    } catch (err) {
      log('showCenterDetails err', err);
      showInlineMessage('resultsContent', 'Unable to show center details', true);
    }
  }

  async function getDirections(centerId) {
    try {
      const { ok, json } = await fetchWithTimeout(`${API_BASE}/get-directions/${centerId}`, { headers: getAuthHeaders({ 'Content-Type': 'application/json' }) });
      if (!ok) { showInlineMessage('resultsContent', 'Directions not available', true); return; }
      const d = json || {};
      const html = `
        <div style="display:flex;justify-content:space-between;align-items:center">
          <h3 style="margin:0">Directions to ${sanitize(d.name || '')}</h3>
          <button onclick="document.getElementById('ecowise-modal')?.remove()" style="border:none;background:none;font-size:20px;cursor:pointer;color:#fff">×</button>
        </div>
        <div style="margin-top:10px">${sanitize(d.directions || 'No directions available')}</div>
        <div style="margin-top:12px;display:flex;gap:8px">
          ${d.phone ? `<button style="padding:8px 10px;border-radius:8px;background:#3b82f6;color:#fff;border:none;cursor:pointer" onclick="window.ecowise.callCenter('${sanitize(d.phone)}')">Call</button>` : ''}
          <button style="padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.04);background:transparent;cursor:pointer" onclick="copyToClipboard('${sanitize(d.directions || '')}')">Copy</button>
        </div>
      `;
      createModal(html);
    } catch (err) {
      log('getDirections err', err);
      showInlineMessage('resultsContent', 'Could not fetch directions', true);
    }
  }

  function callCenter(phone) {
    if (!phone) { showInlineMessage('resultsContent', 'No phone available', true); return; }
    window.location.href = `tel:${phone}`;
  }

  /* ======= Small helpers for UI tests ======= */
  function sanitizeHtml(s) { if (s == null) return ''; return String(s).replace(/[&<>]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;' }[c])); }

  // expose debug helpers
  window._ecowise_debug = {
    API_BASE,
    maybeCompress,
    uploadWithProgress,
    normalizeResponse
  };

})();

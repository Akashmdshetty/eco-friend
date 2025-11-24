// analyze.js — improved, robust, and compatible ES module version
// Usage: <script type="module" src="/frontend/analyze.js"></script>
/*
  Changes / improvements vs your previous version:
  - Default API_BASE points to :5000 (matches Flask backend) but respects window.API_BASE.
  - Safer fetchWithTimeout shared helper (used for centers / detect fallback).
  - Better error handling and user feedback (inline messages, progress element).
  - Reuse of compressImage flow but simplified for reliability.
  - Uses FormData + fetch (XMLHttpRequest retained in uploadWithProgress for upload progress).
  - Defensive DOM lookup: works if script runs in head or body.
  - Exposes small debug helpers on window.ecowiseDebug.
*/

const API_BASE = window.API_BASE || 'http://localhost:5000';
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024; // 12 MB
const MAX_WIDTH = 1200;
const UPLOAD_TIMEOUT_MS = 60000;

let currentFile = null;
let cameraStream = null;
let previewObjectUrl = null;

// DOM helpers
const el = id => document.getElementById(id);
const fileUploadArea = el('fileUploadArea');
const imageUpload = el('imageUpload');
const browseBtn = el('browseBtn');
const imagePreview = el('imagePreview');
const previewImage = el('previewImage');
const clearPreview = el('clearPreview');

const startCameraBtn = el('startCameraBtn');
const cameraPlaceholder = el('cameraPlaceholder');
const cameraPreview = el('cameraPreview');
const cameraVideo = el('cameraVideo');
const captureBtn = el('captureBtn');
const stopCameraBtn = el('stopCameraBtn');

const analyzeButton = el('analyzeButton');
const analyzeHint = el('analyzeHint');

const resultsSection = el('resultsSection');
const resultsContent = el('resultsContent');
const resultsBadge = el('resultsBadge');

const show = node => { if (node) node.style.display = ''; };
const hide = node => { if (node) node.style.display = 'none'; };
const setBadge = (text, color = '') => { if (resultsBadge) { resultsBadge.textContent = text; resultsBadge.style.background = color || 'var(--accent)'; } };

const enableAnalyze = () => { if (analyzeButton) { analyzeButton.disabled = false; } if (analyzeHint) analyzeHint.textContent = 'Ready — click Analyze'; };
const disableAnalyze = () => { if (analyzeButton) { analyzeButton.disabled = true; } if (analyzeHint) analyzeHint.textContent = 'Select or capture an image to enable analysis'; };

function safeRevokePreview(){
  if (previewObjectUrl){
    try { URL.revokeObjectURL(previewObjectUrl); } catch(e) {}
    previewObjectUrl = null;
  }
}

function showPreviewFromBlob(blob){
  safeRevokePreview();
  previewObjectUrl = URL.createObjectURL(blob);
  if (previewImage) { previewImage.src = previewObjectUrl; previewImage.alt = 'Selected image preview'; }
  if (imagePreview) show(imagePreview);
  const label = fileUploadArea && fileUploadArea.querySelector('.upload-label');
  if (label) hide(label);
}

// Event wiring helpers (defensive)
function on(node, ev, cb){ if (node && cb) node.addEventListener(ev, cb); }

on(clearPreview, 'click', () => {
  if (imageUpload) imageUpload.value = '';
  if (previewImage) previewImage.src = '';
  safeRevokePreview();
  if (imagePreview) hide(imagePreview);
  const label = fileUploadArea && fileUploadArea.querySelector('.upload-label'); if (label) show(label);
  currentFile = null;
  disableAnalyze();
  if (resultsSection) resultsSection.style.display = 'none';
});

// FILE INPUT + DRAG/DROP
on(browseBtn, 'click', () => imageUpload && imageUpload.click());
on(imageUpload, 'change', (e) => handleFiles(e.target.files));

['dragenter','dragover','dragleave','drop'].forEach(evt => {
  if (fileUploadArea) fileUploadArea.addEventListener(evt, e => e.preventDefault());
  document.body.addEventListener(evt, e => e.preventDefault());
});
['dragenter','dragover'].forEach(evt => { if (fileUploadArea) fileUploadArea.addEventListener(evt, () => fileUploadArea.classList.add('highlight')); });
['dragleave','drop'].forEach(evt => { if (fileUploadArea) fileUploadArea.addEventListener(evt, () => fileUploadArea.classList.remove('highlight')); });

if (fileUploadArea) fileUploadArea.addEventListener('drop', (e) => {
  const dt = e.dataTransfer; if (!dt) return; const files = dt.files; if (files && files.length) handleFiles(files);
});

function handleFiles(files){
  const f = files && files[0];
  if (!f) return;
  if (!f.type || !f.type.startsWith('image/')) { alert('Please provide an image file.'); return; }
  if (f.size > MAX_UPLOAD_BYTES) { alert('File too large (max 12MB). Please pick a smaller file.'); return; }
  currentFile = f;
  showPreviewFromBlob(f);
  enableAnalyze();
}

// CAMERA
on(startCameraBtn, 'click', startCamera);
on(stopCameraBtn, 'click', stopCamera);
on(captureBtn, 'click', captureFromCamera);

async function startCamera(){
  if (cameraStream) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){ alert('Camera API not supported in this browser.'); return; }
  try{
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    if (cameraVideo) { cameraVideo.srcObject = cameraStream; await cameraVideo.play(); }
    if (cameraPlaceholder) hide(cameraPlaceholder);
    if (cameraPreview) show(cameraPreview);
  }catch(err){ console.error('camera start failed', err); alert('Could not access camera. Check permissions or use file upload.'); }
}

function stopCamera(){
  if (!cameraStream) return; cameraStream.getTracks().forEach(t => { try{ t.stop(); } catch(e){} }); cameraStream = null; if (cameraVideo) cameraVideo.srcObject = null; if (cameraPreview) hide(cameraPreview); if (cameraPlaceholder) show(cameraPlaceholder);
}

function captureFromCamera(){
  if (!cameraStream) { alert('Camera not started'); return; }
  const w = (cameraVideo && cameraVideo.videoWidth) ? cameraVideo.videoWidth : 1280;
  const h = (cameraVideo && cameraVideo.videoHeight) ? cameraVideo.videoHeight : 720;
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h; const ctx = canvas.getContext('2d'); ctx.drawImage(cameraVideo, 0, 0, w, h);
  canvas.toBlob((blob) => {
    if (!blob) { alert('Capture failed'); return; }
    const file = new File([blob], `capture_${Date.now()}.jpg`, { type: 'image/jpeg' });
    currentFile = file; showPreviewFromBlob(file); enableAnalyze(); stopCamera();
  }, 'image/jpeg', 0.9);
}

// compression helpers
async function createBitmap(file){
  if (window.createImageBitmap) return createImageBitmap(file);
  return new Promise((resolve, reject) => {
    const img = new Image(); img.onload = () => {
      try{
        const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d'); ctx.drawImage(img,0,0);
        resolve(canvas);
      }catch(e){ reject(e); }
    };
    img.onerror = reject; img.src = URL.createObjectURL(file);
  });
}

async function compressImage(file, maxBytes = MAX_UPLOAD_BYTES, maxW = MAX_WIDTH){
  try{
    const bitmap = await createBitmap(file);
    let w = bitmap.width, h = bitmap.height;
    if (w > maxW){ h = Math.round(h * (maxW / w)); w = maxW; }
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h; const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, w, h);

    let quality = 0.92; let blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', quality));
    while (blob && blob.size > maxBytes && quality > 0.35){ quality -= 0.07; blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', quality)); }
    return blob || file;
  }catch(e){
    console.warn('compressImage fallback to original file', e);
    return file;
  }
}

// upload with progress (XMLHttpRequest to support progress events)
function uploadFileWithProgress(blob, filename, onProgress){
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    const toSend = (blob instanceof File) ? blob : new File([blob], filename, { type: blob.type || 'image/jpeg' });
    fd.append('image', toSend, toSend.name);
    fd.append('username', 'EcoStudent');

    const xhr = new XMLHttpRequest(); xhr.open('POST', `${API_BASE}/detect`, true); xhr.responseType = 'json';
    const abortTimer = setTimeout(() => { try{ xhr.abort(); }catch(e){}; reject(new Error('Upload timeout')); }, UPLOAD_TIMEOUT_MS);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && typeof onProgress === 'function') onProgress(e.loaded / e.total); };
    xhr.onload = () => { clearTimeout(abortTimer); if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response); else {
        // Try to parse response body as JSON or text
        try { const parsed = xhr.response || JSON.parse(xhr.responseText || '{}'); resolve(parsed); } catch(e){ reject(new Error('Upload failed: ' + xhr.status)); }
      }
    };
    xhr.onerror = () => { clearTimeout(abortTimer); reject(new Error('Network error during upload')); };
    try { xhr.send(fd); } catch(e){ clearTimeout(abortTimer); reject(e); }
  });
}

// small fetch timeout helper
function fetchWithTimeoutSimple(url, ms = 10000){
  const controller = new AbortController(); const id = setTimeout(() => controller.abort(), ms);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(id));
}

// main analyze flow
on(analyzeButton, 'click', async () => {
  if (!currentFile) { alert('Select or capture image first'); return; }
  if (analyzeButton) { analyzeButton.disabled = true; analyzeButton.textContent = '⏳ Analyzing...'; }
  if (resultsSection) resultsSection.style.display = '';
  setBadge('Analyzing...', 'var(--accent)');
  if (resultsContent) resultsContent.innerHTML = `<div class="loading-analysis"><div><span class="analyzing-dot"></span><span class="analyzing-dot"></span><span class="analyzing-dot"></span></div><p style="color:var(--muted);margin-top:12px">Identifying objects...</p></div>`;

  try {
    const compressedBlob = await compressImage(currentFile);
    const origName = currentFile.name || `upload_${Date.now()}.jpg`;
    const extMatch = origName.match(/\.[0-9a-z]+$/i);
    const ext = extMatch ? extMatch[0] : '.jpg';
    const uploadName = `ecowise_${Date.now()}${ext}`;

    const progressContainer = document.createElement('div');
    progressContainer.style.margin = '12px 0';
    const progressEl = document.createElement('progress');
    progressEl.max = 1;
    progressEl.value = 0;
    progressEl.style.width = '100%';
    progressContainer.appendChild(progressEl);
    if (resultsContent) resultsContent.appendChild(progressContainer);

    const res = await uploadFileWithProgress(
      compressedBlob,
      uploadName,
      (fraction) => { progressEl.value = fraction; }
    );

    const data = res && typeof res === 'object' ? res : {};
    data.detected_objects =
      data.detected_objects || data.detected || data.items || data.objects || data.results || [];

    // 🔥 IMPORTANT: add debug here
    console.log('[ecowise] analyze response:', data);

    renderResults(data);
  } catch (err) {
    console.error('Analyze error:', err);
    if (resultsContent)
      resultsContent.innerHTML = `<div style="padding:20px;color:var(--muted)">Server error: ${err.message}. Showing sample result.</div>`;
    setTimeout(() => showMockResult(), 600);
  } finally {
    if (analyzeButton) {
      analyzeButton.disabled = false;
      analyzeButton.textContent = '🤖 Analyze with AI';
    }
  }
});


// results rendering (modular)
function renderResults(data){
  setBadge('Analysis Complete', 'var(--primary)');
  if (resultsContent) resultsContent.innerHTML = '';
  const detected = Array.isArray(data.detected_objects) ? data.detected_objects : [];
  if (!detected.length){
    if (resultsContent) resultsContent.innerHTML = `<div style="padding:28px;text-align:center"><h3>No items detected</h3><p style="color:var(--muted)">Try a clearer photo or different angle.</p><div style="margin-top:12px"><button class="analyze-btn" onclick="location.reload()">Try Again</button></div></div>`;
    return;
  }

  const primary = detected[0];
  const name = primary.name || primary.label || primary.type || primary.item || primary.class || 'item';
  const points = primary.points || primary.score || Math.round((primary.confidence || primary.conf || primary.probability || 0) * 100) || primary.eco_points || 0;
  const carbon = primary.carbon_saved_kg || primary.carbon || (data.carbon_saved_kg || 0);
  const details = getItemDetails(String(name).toLowerCase());

  // left column (info)
  const left = document.createElement('div'); left.className = 'item-info';
  left.innerHTML = `
    <div style="display:flex;gap:12px;align-items:center;margin-bottom:12px">
      <div style="width:72px;height:72px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--gradient);font-size:28px">${details.icon}</div>
      <div>
        <h3 style="margin:0">${escapeHtml(details.name)}</h3>
        <div style="color:var(--primary);font-weight:600">${escapeHtml(details.category)}</div>
      </div>
    </div>
    <div style="color:var(--muted);line-height:1.5">${escapeHtml(details.description)}</div>

    <div style="margin-top:12px;padding:10px;border-radius:8px;background:rgba(16,185,129,0.06);border-left:4px solid var(--primary)">
      <strong>${escapeHtml(details.action)}</strong> — ${escapeHtml(details.actionDescription)}
    </div>

    <div class="stats-grid" style="margin-top:14px;display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
      <div class="stat-card" style="background:#fff;padding:10px;border-radius:8px"><div style="font-weight:700;color:var(--primary);font-size:1.2rem">+${escapeHtml(String(points))}</div><div style="color:var(--muted);font-size:0.85rem">EcoPoints</div></div>
      <div class="stat-card" style="background:#fff;padding:10px;border-radius:8px"><div style="font-weight:700;color:var(--primary);font-size:1.2rem">${escapeHtml(String(carbon))}kg</div><div style="color:var(--muted);font-size:0.85rem">Carbon Saved</div></div>
      <div class="stat-card" style="background:#fff;padding:10px;border-radius:8px"><div style="font-weight:700;color:var(--primary);font-size:1.2rem">${escapeHtml(details.processingTime)}</div><div style="color:var(--muted);font-size:0.85rem">Processing Time</div></div>
    </div>

    <div style="margin-top:12px"><h4 style="margin:8px 0">📋 Tips</h4></div>
  `;
  const tipsContainer = document.createElement('div'); (details.tips || []).forEach(t => { const d = document.createElement('div'); d.className = 'recommendation-item'; d.textContent = t; tipsContainer.appendChild(d); });
  left.appendChild(tipsContainer);

  // right column (centers + actions)
  const right = document.createElement('div');
  const centersSection = document.createElement('div'); const centersTitle = document.createElement('h4'); centersTitle.textContent = '📍 Nearby Recycling Centers'; centersSection.appendChild(centersTitle);
  const centersList = document.createElement('div'); centersList.id = 'centersList'; centersList.className = 'centers-list'; centersList.style.marginTop = '10px'; centersSection.appendChild(centersList);
  const actionsRow = document.createElement('div'); actionsRow.style.marginTop = '12px'; actionsRow.style.display = 'flex'; actionsRow.style.gap = '8px';
  const viewMapBtn = document.createElement('button'); viewMapBtn.className = 'analyze-btn'; viewMapBtn.type = 'button'; viewMapBtn.textContent = '🗺️ View All Centers'; viewMapBtn.addEventListener('click', () => location.href = 'map.html');
  const anotherBtn = document.createElement('button'); anotherBtn.className = 'browse-btn'; anotherBtn.type = 'button'; anotherBtn.style.background = 'transparent'; anotherBtn.addEventListener('click', analyzeAnother); anotherBtn.textContent = '🔄 Analyze Another';
  actionsRow.appendChild(viewMapBtn); actionsRow.appendChild(anotherBtn); centersSection.appendChild(actionsRow); right.appendChild(centersSection);

  const container = document.createElement('div'); container.className = 'analysis-result'; container.style.display = 'grid'; container.style.gridTemplateColumns = '1fr 340px'; container.style.gap = '18px'; container.appendChild(left); container.appendChild(right);
  if (resultsContent) resultsContent.appendChild(container);

  // fetch centers (best effort)
  try{
    const resp = await fetchWithTimeoutSimple(`${API_BASE}/recycling-centers`, 10000);
    if (resp.ok || resp.status === 200){
      const json = await resp.json();
      const centers = Array.isArray(json.centers) ? json.centers : (Array.isArray(json) ? json : []);
      const picks = centers.filter(c => Array.isArray(details.centers) && details.centers.includes(c.id)).slice(0,3);
      if (!picks.length){
        (centers.slice(0,3)).forEach(c => appendCenterItem(centersList, c));
        if (!centers.length) { const msg = document.createElement('div'); msg.className = 'no-centers'; msg.textContent = 'No centers available right now.'; centersList.appendChild(msg); }
      } else {
        picks.forEach(c => appendCenterItem(centersList, c));
      }
    } else {
      const msg = document.createElement('div'); msg.className = 'no-centers'; msg.textContent = "Couldn't load centers. Try again later."; centersList.appendChild(msg);
    }
  }catch(e){
    console.warn('centers fetch failed', e);
    const msg = document.createElement('div'); msg.className = 'no-centers'; msg.textContent = "Couldn't load centers. Try again later."; centersList.appendChild(msg);
  }
}

function appendCenterItem(container, c){ if (!container) return; const ce = document.createElement('div'); ce.className = 'center-item'; ce.tabIndex = 0; ce.style.cursor = 'pointer'; ce.style.padding = '8px'; ce.style.borderBottom = '1px solid rgba(0,0,0,0.04)'; ce.addEventListener('click', () => openCenter(c.id)); ce.addEventListener('keydown', (e) => { if (e.key === 'Enter') openCenter(c.id); }); const nameEl = document.createElement('div'); nameEl.style.fontWeight = '600'; nameEl.textContent = c.name || 'Center'; const linkEl = document.createElement('div'); linkEl.style.color = 'var(--primary)'; linkEl.style.fontSize = '0.85rem'; linkEl.textContent = (c.lat && c.lng) ? 'Open in Maps' : 'Contact for details'; const addrEl = document.createElement('div'); addrEl.style.color = 'var(--muted)'; addrEl.style.fontSize = '0.85rem'; addrEl.style.marginTop = '6px'; addrEl.textContent = c.address || ''; ce.appendChild(nameEl); ce.appendChild(linkEl); ce.appendChild(addrEl); container.appendChild(ce); }

window.openCenter = function(id){ try { localStorage.setItem('selectedCenter', String(id)); } catch(e) { console.warn('localStorage unavailable', e); } location.href = 'map.html'; };

function analyzeAnother(){ if (imageUpload) imageUpload.value = ''; if (previewImage) previewImage.src = ''; safeRevokePreview(); if (imagePreview) hide(imagePreview); const label = fileUploadArea && fileUploadArea.querySelector('.upload-label'); if (label) show(label); currentFile = null; disableAnalyze(); if (resultsSection) resultsSection.style.display = 'none'; }

function showMockResult(){ const mock = { detected_objects: [{ name:'bottle', points:10 }], carbon_saved_kg: 0.5, recommendations: ['Recycle the bottle at nearest center'], eco_points: 5 }; renderResults(mock); }

// small item DB (same as your previous function; kept here for completeness)
function getItemDetails(itemName){
  const db = {
    bottle:{name:'Plastic Bottle',category:'Recyclable Plastic',icon:'🥤',points:10,carbonSaved:0.5,processingTime:'2.1s',action:'Recycle',actionDescription:'Place in plastic recycling bin',description:'Plastic bottles are widely recyclable and can be turned into new products.',tips:['Rinse the bottle','Remove the cap','Flatten to save space'],centers:[1,2,5]},
    book:{name:'Books',category:'Donation/Reuse',icon:'📚',points:15,carbonSaved:0.8,processingTime:'1.8s',action:'Donate',actionDescription:'Give to libraries or community centers',description:'Books can be reused or donated.',tips:['Check condition','Contact local libraries'],centers:[8]},
    phone:{name:'Mobile Phone',category:'E-waste',icon:'📱',points:25,carbonSaved:2.0,processingTime:'2.5s',action:'Resell/Recycle',actionDescription:'Sell or recycle properly',description:'Contains valuable metals',tips:['Wipe data','Remove SIM'],centers:[3]},
    clothing:{name:'Clothing',category:'Donation/Reuse',icon:'👕',points:12,carbonSaved:1.2,processingTime:'1.9s',action:'Donate',actionDescription:'Give to charity or thrift stores',description:'Donate wearable clothing.',tips:['Wash before donating'],centers:[7]},
    can:{name:'Metal Can',category:'Recyclable Metal',icon:'🥫',points:10,carbonSaved:0.6,processingTime:'1.7s',action:'Recycle',actionDescription:'Place in metal recycling bin',description:'Metal cans are highly recyclable.',tips:['Rinse thoroughly','Crush to save space'],centers:[1,6]},
    glass:{name:'Glass Bottle',category:'Recyclable Glass',icon:'🍶',points:12,carbonSaved:0.4,processingTime:'2.0s',action:'Recycle',actionDescription:'Place in glass recycling bin',description:'Glass is 100% recyclable.',tips:['Rinse','Remove lids'],centers:[1,5]},

    // new: keyboard - map to e-waste / electronics recycling guidance
    keyboard:{name:'Keyboard',category:'E-waste / Electronics',icon:'⌨️',points:8,carbonSaved:0.3,processingTime:'2.0s',action:'E-waste',actionDescription:'Recycle at e-waste drop-off or through manufacturer',description:'Keyboards contain plastics and electronics. Dispose via e-waste programs.',tips:['Remove batteries (if any)','Check for manufacturer take-back'],centers:[3]},

    // new: laptop - stronger e-waste mapping
    laptop:{name:'Laptop',category:'E-waste / Electronics',icon:'💻',points:30,carbonSaved:3.0,processingTime:'3.0s',action:'E-waste',actionDescription:'Bring to certified e-waste recycler or reuse program',description:'Laptops contain valuable metals and batteries; handle via e-waste routes.',tips:['Back up/wipe data','Remove battery (if removable)'],centers:[3]},

    item:{name:'General Item',category:'Check Guidelines',icon:'📦',points:5,carbonSaved:0.2,processingTime:'1.5s',action:'Check Guidelines',actionDescription:'Consult local recycling rules',description:'Check with local authorities.',tips:['Check guidelines','Visit map'],centers:[1]}
  };
  const key = (itemName || '').toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,32);
  return db[key] || db['item'];
}


function escapeHtml(s = ''){ return String(s).replace(/[&<>\"'`=\/]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','/':'&#x2F;','`':'&#x60;','=':'&#x3D;'}[c])); }

// keyboard accessibility
if (fileUploadArea) fileUploadArea.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); imageUpload && imageUpload.click(); } });

// init state
disableAnalyze();

// expose debug helpers
window.ecowiseDebug = { API_BASE, showMockResult, safeRevokePreview, compressImage, uploadFileWithProgress };

console.log('[analyze.js] module loaded. API_BASE=', API_BASE);

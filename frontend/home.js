// frontend/home.js
// Improved, modular, and robust home page script for EcoWise
// Usage: <script type="module" src="/frontend/home.js"></script>

const API_BASE = window.API_BASE || (window.ECOWISE && window.ECOWISE.apiBase) || 'http://localhost:5000';

export default (function HomeModule() {
  'use strict';
  const raf = window.requestAnimationFrame.bind(window);
  const BUFFER = 40; // placement buffer between cards (px)

  /* ----------------- Utilities ----------------- */
  const noop = () => {};
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const isVisible = (el) => !!el && !!(el.offsetParent !== null || el.getBoundingClientRect().width);
  const qs = (s, root = document) => root.querySelector(s);
  const qsa = (s, root = document) => Array.from(root.querySelectorAll(s));

  function safeJSON(res) {
    try { return res.json(); } catch (e) { return Promise.resolve(null); }
  }

  /* ----------------- Counters ----------------- */
  function animateCounter(el, target, duration = 900, suffix = '') {
    if (!el) return;
    const startVal = 0;
    const endVal = (typeof target === 'number') ? target : Number(target);
    if (Number.isNaN(endVal)) { el.textContent = String(target); return; }

    let start = null;
    function step(ts) {
      if (!start) start = ts;
      const progress = Math.min((ts - start) / duration, 1);
      const current = Math.floor(progress * (endVal - startVal) + startVal);
      el.textContent = current + suffix;
      if (progress < 1) raf(step);
    }
    raf(step);
  }

  function initCounters() {
    const counters = qsa('.stat-item[data-count]');
    if (!counters.length) return;

    const startOne = (el) => {
      const raw = el.getAttribute('data-count') || '0';
      // support suffix like '2.5T'
      if (raw.toUpperCase().includes('T')) {
        animateCounter(el, parseFloat(raw.replace(/[^\d.-]/g, '')) || 0, 900, 'T');
      } else {
        animateCounter(el, parseInt(raw, 10) || 0, 900);
      }
    };

    if ('IntersectionObserver' in window) {
      const obs = new IntersectionObserver((entries, o) => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          startOne(entry.target);
          o.unobserve(entry.target);
        });
      }, { threshold: 0.35 });
      counters.forEach(c => obs.observe(c));
    } else {
      counters.forEach(startOne);
    }
  }

  /* ----------------- Typing (non-destructive) ----------------- */
  function initTyping(selector = '.hero-title', speed = 30) {
    const el = qs(selector);
    if (!el) return;
    // preserve inline markup by reading textContent and writing back plain text gradually
    const full = el.textContent.trim();
    el.textContent = '';
    let idx = 0;
    function tick() {
      idx++;
      el.textContent = full.slice(0, idx);
      if (idx < full.length) setTimeout(tick, speed);
    }
    setTimeout(tick, 350);
  }

  /* ----------------- Parallax (throttled RAF) ----------------- */
  function initParallax() {
    const items = qsa('.card[data-speed]');
    if (!items.length) return;

    let mouseX = 0.5, mouseY = 0.5;
    let scheduled = false;

    function update() {
      scheduled = false;
      items.forEach(it => {
        const speed = Math.max(0, Math.min(0.5, parseFloat(it.dataset.speed) || 0.03));
        const x = (mouseX - 0.5) * speed * 100;
        const y = (mouseY - 0.5) * speed * 100;
        it.style.transform = `translate(${x}px, ${y}px)`;
      });
    }

    const onMove = (e) => {
      mouseX = e.clientX / Math.max(1, window.innerWidth);
      mouseY = e.clientY / Math.max(1, window.innerHeight);
      if (!scheduled) { scheduled = true; raf(update); }
    };

    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('resize', () => items.forEach(i => i.style.transform = ''), { passive: true });
  }

  /* ----------------- Floating Cards Placement ----------------- */
  function intersectsWithBuffer(a, b, buffer = BUFFER) {
    return !(
      a.right + buffer < b.left ||
      a.left - buffer > b.right ||
      a.bottom + buffer < b.top ||
      a.top - buffer > b.bottom
    );
  }

  function makeBox(left, top, w, h) {
    return { left, top, right: left + w, bottom: top + h, w, h };
  }

  function placeCards(containerId = 'cardsArea') {
    const area = document.getElementById(containerId);
    if (!area) return;
    const cards = qsa('.floating-card', area);
    if (!cards.length) return;

    const rect = area.getBoundingClientRect();
    const areaW = Math.max(1, rect.width);
    const areaH = Math.max(1, rect.height);
    const padding = 20;
    const placed = [];

    // reset style to measure natural sizes
    cards.forEach(c => {
      c.style.position = 'absolute';
      c.style.left = '0px';
      c.style.top = '0px';
      c.style.transform = 'none';
    });

    cards.forEach((card, idx) => {
      const measured = card.getBoundingClientRect();
      const w = Math.min(measured.width || 190, Math.max(110, areaW * 0.25));
      const h = Math.min(measured.height || 120, Math.max(70, areaH * 0.18));
      const maxLeft = Math.max(10, areaW - w - padding * 2);
      const maxTop = Math.max(10, areaH - h - padding * 2);

      let attempts = 0;
      let chosen = null;
      while (attempts < 120 && !chosen) {
        const left = padding + Math.round(Math.random() * maxLeft);
        const top = padding + Math.round(Math.random() * maxTop);
        const candidate = makeBox(left, top, w, h);
        let ok = true;
        for (const p of placed) {
          if (intersectsWithBuffer(candidate, p)) { ok = false; break; }
        }
        if (ok) chosen = candidate;
        attempts++;
      }

      if (!chosen) {
        // fallback stacking
        const offset = placed.length * 28;
        const left = Math.min(padding + offset, areaW - w - padding);
        const top = Math.min(padding + offset, areaH - h - padding);
        chosen = makeBox(left, top, w, h);
      }

      placed.push(chosen);
      // convert to percent so layout is more responsive
      card.style.left = ((chosen.left / areaW) * 100).toFixed(3) + '%';
      card.style.top  = ((chosen.top  / areaH) * 100).toFixed(3) + '%';
      // tiny random rotation & animation jitter
      const rot = (Math.random() - 0.5) * 1.4;
      card.style.transform = `rotate(${rot}deg)`;
      card.style.animationDelay = (Math.random() * 1.2).toFixed(2) + 's';
      card.style.animationDuration = (5 + Math.random() * 3).toFixed(2) + 's';
    });

    // keep for debug
    window._ecowisePlacedRects = placed;
  }

  const debounced = (fn, wait = 140) => {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  };

  /* ----------------- Particles (lightweight) ----------------- */
  function createParticles(max = 6) {
    const container = qs('.floating-shapes');
    if (!container) return;
    // remove previously injected runtime particles
    container.querySelectorAll('.runtime-particle').forEach(n => n.remove());
    const count = Math.max(0, Math.min(8, Math.floor(max)));
    for (let i = 0; i < count; i++) {
      const p = document.createElement('div');
      p.className = 'shape runtime-particle';
      const size = Math.round(Math.random() * 90 + 40);
      p.style.width = `${size}px`;
      p.style.height = `${size}px`;
      p.style.left = `${Math.random() * 100}%`;
      p.style.top = `${Math.random() * 100}%`;
      p.style.opacity = (Math.random() * 0.06 + 0.03).toString();
      p.style.animationDelay = `${Math.random() * 5}s`;
      // subtle neutral gradient (avoid extreme colors)
      const hue = Math.round(Math.random() * 60 + 160); // greens/blues
      p.style.background = `linear-gradient(45deg, hsl(${hue},55%,55%), hsl(${(hue + 40) % 360},55%,45%))`;
      container.appendChild(p);
    }
  }

  /* ----------------- Interactive Background (low-cost) ----------------- */
  function initInteractiveBackground() {
    if (!('documentElement' in document)) return;
    let scheduled = false;
    function move(e) {
      if (scheduled) return;
      scheduled = true;
      raf(() => {
        scheduled = false;
        const x = (e.clientX / Math.max(1, window.innerWidth)).toFixed(3);
        const y = (e.clientY / Math.max(1, window.innerHeight)).toFixed(3);
        document.documentElement.style.setProperty('--mouse-x', x);
        document.documentElement.style.setProperty('--mouse-y', y);
      });
    }
    window.addEventListener('mousemove', move, { passive: true });
  }

  /* ----------------- Demo Modal ----------------- */
  function openDemoModal() {
    const modal = qs('#demoModal');
    if (!modal) return;
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
    createDemoAnimation();
    // trap focus minimally
    const focusable = modal.querySelector('button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])');
    if (focusable) focusable.focus();
  }

  function closeDemoModal() {
    const modal = qs('#demoModal');
    if (!modal) return;
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden', 'true');
    const anim = modal.querySelector('.demo-animation');
    if (anim) anim.innerHTML = '';
  }

  function createDemoAnimation() {
    const demoVisual = qs('.demo-animation');
    if (!demoVisual) return;
    demoVisual.innerHTML = '';
    const flow = document.createElement('div');
    flow.className = 'demo-flow';
    const steps = [
      { icon: '📸', text: 'Capture Item' },
      { icon: '🤖', text: 'AI Analysis' },
      { icon: '🎯', text: 'Get Recommendations' }
    ];
    steps.forEach((s, i) => {
      const step = document.createElement('div');
      step.className = 'demo-step';
      step.innerHTML = `<div class="demo-icon" aria-hidden="true">${s.icon}</div><p>${s.text}</p>`;
      flow.appendChild(step);
      if (i < steps.length - 1) {
        const arrow = document.createElement('div');
        arrow.className = 'demo-arrow';
        arrow.textContent = '→';
        flow.appendChild(arrow);
      }
    });
    demoVisual.appendChild(flow);
  }

  /* ----------------- Tagline Controls ----------------- */
  function initTaglineControls() {
    const selector = qs('.tagline-selector');
    if (!selector) return;
    selector.addEventListener('click', (ev) => {
      const opt = ev.target.closest('.tagline-option');
      if (opt && opt.dataset.index != null) {
        const idx = Number(opt.dataset.index);
        if (Number.isFinite(idx) && window.changeTagline) {
          // prefer page-provided function to preserve markup and animation
          try { window.changeTagline(idx); } catch (e) { /* ignore */ }
        } else {
          // fallback: safely update hero title by text nodes
          const pieces = opt.textContent.trim().split(/\s+into\s+|\s+to\s+|,/i);
          if (pieces.length >= 2) {
            const left = pieces[0].trim();
            const right = pieces[1].trim();
            const title = qs('#heroTitle');
            if (title) {
              title.textContent = '';
              title.appendChild(document.createTextNode('Transform '));
              const a = document.createElement('span'); a.className = 'gradient-text'; a.textContent = left;
              const b = document.createElement('span'); b.className = 'gradient-text'; b.textContent = right;
              title.appendChild(a);
              title.appendChild(document.createTextNode(' into '));
              title.appendChild(b);
            }
          }
        }
        // UI active class update
        selector.querySelectorAll('.tagline-option').forEach(o => o.classList.remove('active'));
        opt.classList.add('active');
        const optsBox = qs('#taglineOptions');
        if (optsBox) optsBox.classList.remove('active');
      } else if (ev.target.matches('.tagline-toggle')) {
        qs('#taglineOptions')?.classList.toggle('active');
      }
    });

    document.addEventListener('click', (ev) => {
      const sel = qs('.tagline-selector');
      if (!sel) return;
      if (!sel.contains(ev.target)) qs('#taglineOptions')?.classList.remove('active');
    });
  }

  /* ----------------- Page entrance animations ----------------- */
  function initEntranceAnimations() {
    const features = qsa('.feature-card');
    features.forEach((el, i) => {
      el.style.transition = 'transform 0.6s cubic-bezier(.2,.9,.2,1), opacity 0.6s';
      el.style.transform = 'translateY(12px)';
      el.style.opacity = '0';
      setTimeout(() => { el.style.transform = ''; el.style.opacity = '1'; }, 220 + i * 120);
    });

    const steps = qsa('.step');
    steps.forEach((el, i) => {
      el.style.transition = 'transform 0.6s ease, opacity 0.6s ease';
      el.style.transform = 'translateY(16px)';
      el.style.opacity = '0';
      setTimeout(() => { el.style.transform = ''; el.style.opacity = '1'; }, 420 + i * 140);
    });
  }

  /* ----------------- Fallbacks & Debug ----------------- */
  function emergencyCounterFix() {
    const counters = qsa('.stat-item');
    const defaults = [1247, 568, '2.5T'];
    counters.forEach((c, i) => {
      if (!c.textContent || c.textContent.trim() === '0') {
        c.textContent = defaults[i] || '';
        // eslint-disable-next-line no-console
        console.info('[home] emergency counter fix applied', i);
      }
    });
  }

  function debugCounters() {
    const counters = qsa('.stat-item');
    console.log('[home] counters:', counters.map(c => ({ text: c.textContent, data: c.dataset.count })));
  }

  /* ----------------- Boot & wiring ----------------- */
  function boot() {
    // counters & typing
    initCounters();
    initTyping('.hero-title', 25);

    // parallax & background
    initParallax();
    initInteractiveBackground();
    createParticles(6);

    // cards placement
    placeCards();
    window.addEventListener('resize', debounced(() => placeCards(), 160), { passive: true });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) placeCards(); });

    // modal controls
    const demoBtn = qs('#liveDemoBtn');
    if (demoBtn) demoBtn.addEventListener('click', openDemoModal);
    const demoModal = qs('#demoModal');
    if (demoModal) {
      demoModal.addEventListener('click', (ev) => { if (ev.target === demoModal) closeDemoModal(); });
      qsa('.close-modal', demoModal).forEach(b => b.addEventListener('click', closeDemoModal));
      document.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape' && demoModal.classList.contains('show')) closeDemoModal();
      });
    }

    // tagline
    initTaglineControls();

    // entrance animations
    initEntranceAnimations();

    // emergency fixes for odd rendering cases
    setTimeout(emergencyCounterFix, 2500);
    setTimeout(debugCounters, 1200);

    // expose a small debug API intentionally
    window.ecowisePlaceCards = placeCards;
    window.debugHome = { debugCounters, emergencyCounterFix, openDemoModal, closeDemoModal };

    // kick off stats load (non-blocking)
    (async function loadStats() {
      const elUsers = qs('#statUsers');
      const elCenters = qs('#statCenters');
      const elCO2 = qs('#statCO2');
      if (!elUsers && !elCenters && !elCO2) return;
      try {
        const res = await fetch(`${API_BASE.replace(/\/+$/, '')}/stats`);
        if (!res.ok) throw new Error('no stats');
        const d = await res.json();
        if (elUsers) animateCounter(elUsers, Number(d.users || 0), 900);
        if (elCenters) animateCounter(elCenters, Number(d.centers || 0), 900);
        if (elCO2) {
          if (typeof d.co2_saved_formatted === 'string') elCO2.textContent = d.co2_saved_formatted;
          else animateCounter(elCO2, d.co2_saved || d.co2 || 0, 900);
        }
      } catch (err) {
        // fallback static values
        if (elUsers) animateCounter(elUsers, 1247, 900);
        if (elCenters) animateCounter(elCenters, 568, 900);
        if (elCO2) elCO2.textContent = '2.5T';
      }
    })();

    // log
    // eslint-disable-next-line no-console
    console.log('[home] boot completed');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  // return minimal public API (for tests or dev console)
  return {
    placeCards,
    createParticles,
    openDemoModal,
    closeDemoModal,
  };
})();

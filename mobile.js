/* ==========================================================================
   KinWeave \u2014 mobile shell
   Service worker registration, install prompt, and drawer behaviour.
   Loaded after app.js. Keeps all phone-specific concerns out of app.js.
   ========================================================================== */

(function () {
'use strict';

const $ = s => document.querySelector(s);

/* ----------------------------------------------------- service worker */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {
      /* file:// or no HTTPS \u2014 app still works, just not offline-installable */
    });
  });
}

/* ----------------------------------------------------- install prompt */

let deferredPrompt = null;
const installBtn = $('#btnInstall');

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
  if (installBtn) installBtn.hidden = false;
});

if (installBtn) {
  installBtn.addEventListener('click', async () => {
    $('#dataMenu').hidden = true;
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    installBtn.hidden = true;
  });
}

window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  if (installBtn) installBtn.hidden = true;
});

/* ----------------------------------------------------- drawers */

const sidebar = $('#sidebar');
const detail  = $('#detailPanel');
const scrim   = $('#drawerScrim');

function isNarrow()  { return window.matchMedia('(max-width:760px)').matches; }
function isTablet()  { return window.matchMedia('(max-width:1100px)').matches; }

function anyOpen() {
  return sidebar.classList.contains('open') || detail.classList.contains('open');
}

function syncScrim() {
  scrim.hidden = !anyOpen();
}

function openDrawer(el) {
  // only one at a time on phones
  if (el === sidebar) detail.classList.remove('open');
  if (el === detail)  sidebar.classList.remove('open');
  el.classList.add('open');
  syncScrim();
}

function closeDrawer(el) {
  el.classList.remove('open');
  syncScrim();
}

function closeAll() {
  sidebar.classList.remove('open');
  detail.classList.remove('open');
  syncScrim();
}

$('#btnDrawerPeople').addEventListener('click', () => {
  sidebar.classList.contains('open') ? closeDrawer(sidebar) : openDrawer(sidebar);
});

$('#btnDrawerDetail').addEventListener('click', () => {
  detail.classList.contains('open') ? closeDrawer(detail) : openDrawer(detail);
});

document.querySelectorAll('[data-drawer-close]').forEach(b => {
  b.addEventListener('click', () => closeDrawer($('#' + b.dataset.drawerClose)));
});

scrim.addEventListener('click', closeAll);

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && anyOpen()) closeAll();
});

/* When a person is picked from the people drawer on a phone, swap straight
   over to their profile so you are not left staring at the list. */
document.addEventListener('click', e => {
  if (!isNarrow()) return;

  if (e.target.closest('#peopleList li')) {
    setTimeout(() => openDrawer(detail), 120);
    return;
  }

  // tapping a node on the tree/web canvas should surface the profile too
  if (e.target.closest('.node')) {
    setTimeout(() => {
      if ($('#detailBody') && !$('#detailBody').hidden) openDrawer(detail);
    }, 120);
  }
}, true);

/* Opening a modal should never leave a drawer stranded underneath it. */
['#btnAddPerson', '#btnAddLink'].forEach(sel => {
  const b = $(sel);
  if (b) b.addEventListener('click', closeAll);
});

/* Reset drawer state when crossing the desktop breakpoint. */
let lastNarrow = isTablet();
window.addEventListener('resize', () => {
  const now = isTablet();
  if (now !== lastNarrow) { closeAll(); lastNarrow = now; }
});

/* ----------------------------------------------------- misc touch polish */

/* Stop iOS/Android double-tap-to-zoom on controls without killing scroll. */
let lastTouch = 0;
document.addEventListener('touchend', e => {
  const now = Date.now();
  if (now - lastTouch < 300 && e.target.closest('button,.tab,.tf,.node')) {
    e.preventDefault();
  }
  lastTouch = now;
}, { passive: false });

/* Pinch-to-zoom on the two SVG canvases. */
['#treeSvg', '#webSvg'].forEach(sel => {
  const svg = $(sel);
  if (!svg) return;
  let d0 = 0, vb0 = null;

  const dist = t =>
    Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

  svg.addEventListener('touchstart', e => {
    if (e.touches.length !== 2) return;
    d0 = dist(e.touches);
    vb0 = svg.getAttribute('viewBox').split(/\s+/).map(Number);
  }, { passive: true });

  svg.addEventListener('touchmove', e => {
    if (e.touches.length !== 2 || !vb0 || !d0) return;
    e.preventDefault();
    const k = d0 / dist(e.touches);
    const r = svg.getBoundingClientRect();
    const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    const px = (cx - r.left) / r.width;
    const py = (cy - r.top) / r.height;
    const nw = Math.max(80, Math.min(12000, vb0[2] * k));
    const nh = Math.max(80, Math.min(12000, vb0[3] * k));
    svg.setAttribute('viewBox',
      (vb0[0] + (vb0[2] - nw) * px) + ' ' +
      (vb0[1] + (vb0[3] - nh) * py) + ' ' + nw + ' ' + nh);
  }, { passive: false });

  svg.addEventListener('touchend', e => {
    if (e.touches.length < 2) { d0 = 0; vb0 = null; }
  }, { passive: true });
});

})();

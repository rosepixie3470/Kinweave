/* =========================================================================
   KinWeave \u2014 family tree + relationship mapper
   Single-file app logic. No dependencies.
   ========================================================================= */

const App = (() => {
'use strict';

/* ------------------------------------------------------------------ *
 * 1. Relationship type registry
 * ------------------------------------------------------------------ */
const LINK_TYPES = {
  friend:      { label:'Friend',           color:'#34d399', dash:null,    directed:false },
  best_friend: { label:'Best friend',      color:'#10b981', dash:null,    directed:false, width:2.6 },
  ally:        { label:'Ally',             color:'#22d3ee', dash:null,    directed:false },
  mentor:      { label:'Mentor \u2192 student', color:'#a78bfa', dash:null,    directed:true  },
  guardian:    { label:'Guardian \u2192 ward',  color:'#60a5fa', dash:null,    directed:true, width:2.4 },
  colleague:   { label:'Colleague',        color:'#93a4c4', dash:'5 4',   directed:false },
  acquaintance:{ label:'Acquaintance',     color:'#6b7488', dash:'2 4',   directed:false },
  romantic:    { label:'Romantic interest',color:'#f472b6', dash:'6 3',   directed:false },
  rival:       { label:'Rival',            color:'#fbbf24', dash:'7 4',   directed:false },
  enemy:       { label:'Enemy',            color:'#f87171', dash:null,    directed:false, width:2.4 },
  custom:      { label:'Other / custom',   color:'#c4b5fd', dash:'3 3',   directed:false }
};

const UNION_TYPES = {
  marriage:   'Married',
  partnership:'Partners',
  engaged:    'Engaged',
  divorced:   'Divorced',
  separated:  'Separated',
  unknown:    'Unspecified'
};

/* ------------------------------------------------------------------ *
 * 2. State + persistence
 * ------------------------------------------------------------------ */
const DB_KEY = 'kinweave.v1';

let state = blankState();
let ui = {
  view: 'tree',
  selected: null,
  tree:   { k:1, x:0, y:0, showDates:true },
  net:    { showFamily:false, showLabels:true, hidden:new Set() },
  gallery:{ filter:'' },
  lightbox:{ list:[], index:0 }
};

function blankState(){ return { people:[], unions:[], links:[] }; }
function uid(p='id'){ return p + '_' + Math.random().toString(36).slice(2,9); }

function save(){
  // NOTE: photos are base64 data URLs. If you outgrow localStorage,
  // swap this module for IndexedDB and store blobs instead.
  try { localStorage.setItem(DB_KEY, JSON.stringify(state)); }
  catch(e){ toast('Could not save \u2014 storage is full. Export a backup.'); }
}
function load(){
  try {
    const raw = localStorage.getItem(DB_KEY);
    if(!raw) return;
    const d = JSON.parse(raw);
    state = {
      people: Array.isArray(d.people)? d.people : [],
      unions: Array.isArray(d.unions)? d.unions : [],
      links:  Array.isArray(d.links) ? d.links  : []
    };
  } catch(e){ state = blankState(); }
}

/* ------------------------------------------------------------------ *
 * 3. Data accessors
 * ------------------------------------------------------------------ */
const byId = id => state.people.find(p => p.id === id);
const nameOf = id => (byId(id)||{}).name || 'Unknown';

function unionsOf(pid){ return state.unions.filter(u => u.partners.includes(pid)); }
function parentUnionOf(pid){ return state.unions.find(u => u.children.includes(pid)); }

function parentsOf(pid){
  const u = parentUnionOf(pid);
  return u ? u.partners.filter(Boolean) : [];
}
function childrenOf(pid){
  const out = [];
  unionsOf(pid).forEach(u => u.children.forEach(c => { if(!out.includes(c)) out.push(c); }));
  return out;
}
function partnersOf(pid){
  const out = [];
  unionsOf(pid).forEach(u => u.partners.forEach(x => { if(x && x !== pid && !out.includes(x)) out.push(x); }));
  return out;
}
function siblingsOf(pid){
  const u = parentUnionOf(pid);
  return u ? u.children.filter(c => c !== pid) : [];
}
function linksOf(pid){ return state.links.filter(l => l.from === pid || l.to === pid); }

/* mutations ---------------------------------------------------------- */

function addPerson(data){
  const p = Object.assign({
    id: uid('p'), name:'Unnamed', nickname:'', gender:'', birth:'', death:'',
    occupation:'', bio:'', avatar:'', photos:[], tags:[]
  }, data);
  state.people.push(p); save(); return p;
}

function removePerson(pid){
  state.people = state.people.filter(p => p.id !== pid);
  state.links  = state.links.filter(l => l.from !== pid && l.to !== pid);
  state.unions.forEach(u => {
    u.partners = u.partners.map(x => x === pid ? null : x);
    u.children = u.children.filter(c => c !== pid);
  });
  // drop unions that no longer connect anyone
  state.unions = state.unions.filter(u => u.partners.filter(Boolean).length || u.children.length);
  if(ui.selected === pid) ui.selected = null;
  save();
}

function findOrCreateUnion(a, b){
  let u = state.unions.find(x =>
    x.partners.includes(a) && (b ? x.partners.includes(b) : x.partners.filter(Boolean).length === 1));
  if(u) return u;
  u = { id:uid('u'), partners:[a, b||null], children:[], type:'partnership', start:'', end:'' };
  state.unions.push(u); return u;
}

function linkPartners(a, b, type){
  if(a === b) return;
  const existing = state.unions.find(u => u.partners.includes(a) && u.partners.includes(b));
  if(existing){ if(type) existing.type = type; save(); return existing; }
  // reuse a solo union if one exists
  const solo = state.unions.find(u => u.partners.filter(Boolean).length === 1 &&
                                      u.partners.includes(a) && !u.partners.includes(b));
  if(solo){ solo.partners = [a,b]; if(type) solo.type = type; save(); return solo; }
  const u = { id:uid('u'), partners:[a,b], children:[], type:type||'partnership', start:'', end:'' };
  state.unions.push(u); save(); return u;
}

function addChildTo(parentId, childId){
  if(parentId === childId) return;
  const prev = parentUnionOf(childId);
  if(prev) prev.children = prev.children.filter(c => c !== childId);
  const u = unionsOf(parentId)[0] || findOrCreateUnion(parentId, null);
  if(!state.unions.includes(u)) state.unions.push(u);
  if(!u.children.includes(childId)) u.children.push(childId);
  save();
}

function addParentTo(childId, parentId){
  if(parentId === childId) return;
  let u = parentUnionOf(childId);
  if(!u){
    u = { id:uid('u'), partners:[parentId,null], children:[childId], type:'partnership', start:'', end:'' };
    state.unions.push(u);
  } else if(!u.partners.includes(parentId)){
    const slot = u.partners.indexOf(null);
    if(slot >= 0) u.partners[slot] = parentId;
    else u.partners.push(parentId);
  }
  save();
}

function detachParents(childId){
  const u = parentUnionOf(childId);
  if(!u) return;
  u.children = u.children.filter(c => c !== childId);
  save();
}

function unlinkPartner(a, b){
  const u = state.unions.find(x => x.partners.includes(a) && x.partners.includes(b));
  if(!u) return;
  if(u.children.length){ u.partners = u.partners.map(x => x === b ? null : x); }
  else { state.unions = state.unions.filter(x => x.id !== u.id); }
  save();
}

function addLink(from, to, type, label){
  if(from === to) return;
  const dup = state.links.find(l => l.type === type &&
    ((l.from===from&&l.to===to) || (!LINK_TYPES[type].directed && l.from===to && l.to===from)));
  if(dup) return dup;
  const l = { id:uid('l'), from, to, type, label:label||'' };
  state.links.push(l); save(); return l;
}
function removeLink(id){ state.links = state.links.filter(l => l.id !== id); save(); }

/* ------------------------------------------------------------------ *
 * 4. Small DOM helpers
 * ------------------------------------------------------------------ */
const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const SVGNS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs){
  const e = document.createElementNS(SVGNS, tag);
  for(const k in (attrs||{})) if(attrs[k] != null) e.setAttribute(k, attrs[k]);
  return e;
}
function esc(s){
  return String(s==null?'':s).replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function initials(n){
  return String(n||'?').trim().split(/\s+/).slice(0,2).map(w=>w[0]).join('').toUpperCase() || '?';
}
function yearOf(d){ const m = /\d{4}/.exec(d||''); return m ? m[0] : ''; }
function lifespan(p){
  const b = yearOf(p.birth), d = yearOf(p.death);
  if(!b && !d) return '';
  if(b && d) return b + '\u2013' + d;
  if(b) return b + '\u2013';
  return '\u2013' + d;
}
function toast(msg){
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  $('#toastWrap').appendChild(t);
  setTimeout(()=>t.remove(), 2600);
}

/* ------------------------------------------------------------------ *
 * 5. TREE LAYOUT
 *    Generation assignment + iterative ordering, then centring.
 * ------------------------------------------------------------------ */
const CARD_W = 148, CARD_H = 52, H_GAP = 26, V_GAP = 96, COUPLE_GAP = 34;

function computeTreeLayout(){
  const people = state.people;
  if(!people.length) return { nodes:{}, unions:{}, width:0, height:0, gens:0 };

  /* --- generations: longest path from an ancestor --- */
  const gen = {};
  const visiting = {};
  function depth(id){
    if(gen[id] != null) return gen[id];
    if(visiting[id]) return 0;           // cycle guard
    visiting[id] = true;
    const ps = parentsOf(id);
    let g = 0;
    ps.forEach(p => { g = Math.max(g, depth(p) + 1); });
    visiting[id] = false;
    return (gen[id] = g);
  }
  people.forEach(p => depth(p.id));

  /* pull partners onto the same row where possible */
  for(let pass=0; pass<3; pass++){
    state.unions.forEach(u => {
      const ps = u.partners.filter(Boolean);
      if(ps.length < 2) return;
      const g = Math.max.apply(null, ps.map(x => gen[x]));
      ps.forEach(x => { if(childrenOf(x).every(c => gen[c] > g)) gen[x] = g; });
    });
  }

  /* --- build blocks per generation (a block = person, or a couple) --- */
  const maxGen = Math.max.apply(null, people.map(p => gen[p.id]));
  const rows = [];
  for(let g=0; g<=maxGen; g++) rows.push([]);

  const placed = new Set();
  const blockOf = {};

  // couples first so they stay adjacent
  state.unions.forEach(u => {
    const ps = u.partners.filter(Boolean);
    if(ps.length < 2) return;
    if(ps.some(x => placed.has(x))) return;
    if(gen[ps[0]] !== gen[ps[1]]) return;
    const b = { id:uid('b'), members:ps.slice(0,2), gen:gen[ps[0]], union:u.id, x:0 };
    ps.slice(0,2).forEach(x => { placed.add(x); blockOf[x] = b; });
    rows[b.gen].push(b);
  });
  // then singletons
  people.forEach(p => {
    if(placed.has(p.id)) return;
    const b = { id:uid('b'), members:[p.id], gen:gen[p.id], union:null, x:0 };
    placed.add(p.id); blockOf[p.id] = b;
    rows[b.gen].push(b);
  });

  const blockWidth = b =>
    b.members.length === 2 ? CARD_W*2 + COUPLE_GAP : CARD_W;

  /* --- ordering passes: top-down then bottom-up barycentre --- */
  function parentBary(b){
    const ps = [];
    b.members.forEach(m => parentsOf(m).forEach(p => ps.push(p)));
    if(!ps.length) return null;
    const xs = ps.map(p => blockOf[p] ? blockOf[p].x : 0);
    return xs.reduce((a,c)=>a+c,0) / xs.length;
  }
  function childBary(b){
    const cs = [];
    b.members.forEach(m => childrenOf(m).forEach(c => cs.push(c)));
    if(!cs.length) return null;
    const xs = cs.map(c => blockOf[c] ? blockOf[c].x : 0);
    return xs.reduce((a,c)=>a+c,0) / xs.length;
  }
  function pack(row){
    let x = 0;
    row.forEach(b => { b.x = x + blockWidth(b)/2; x += blockWidth(b) + H_GAP; });
    return x - H_GAP;
  }

  rows.forEach(pack);
  for(let iter=0; iter<8; iter++){
    const down = iter % 2 === 0;
    const order = down ? rows : rows.slice().reverse();
    order.forEach(row => {
      const keyed = row.map((b,i) => {
        const bary = down ? parentBary(b) : childBary(b);
        return { b, k: bary == null ? b.x : bary, i };
      });
      keyed.sort((a,c) => (a.k - c.k) || (a.i - c.i));
      row.length = 0;
      keyed.forEach(o => row.push(o.b));
      pack(row);
    });
  }

  /* centre each row on the widest row */
  const rowWidths = rows.map(r => r.length ? (r[r.length-1].x + blockWidth(r[r.length-1])/2) : 0);
  const total = Math.max.apply(null, rowWidths.concat([CARD_W]));
  rows.forEach((r,i) => {
    const shift = (total - rowWidths[i]) / 2;
    r.forEach(b => b.x += shift);
  });

  /* --- emit node + union coordinates --- */
  const nodes = {};
  rows.forEach((row,g) => {
    row.forEach(b => {
      const y = g * (CARD_H + V_GAP);
      if(b.members.length === 2){
        nodes[b.members[0]] = { x: b.x - (CARD_W+COUPLE_GAP)/2, y, gen:g };
        nodes[b.members[1]] = { x: b.x + (CARD_W+COUPLE_GAP)/2, y, gen:g };
      } else {
        nodes[b.members[0]] = { x: b.x, y, gen:g };
      }
    });
  });

  const unions = {};
  state.unions.forEach(u => {
    const ps = u.partners.filter(Boolean).filter(p => nodes[p]);
    if(!ps.length) return;
    const xs = ps.map(p => nodes[p].x);
    const ys = ps.map(p => nodes[p].y);
    unions[u.id] = {
      x: xs.reduce((a,c)=>a+c,0)/xs.length,
      y: Math.max.apply(null, ys) + CARD_H/2 + 18,
      partners: ps
    };
  });

  return { nodes, unions, width: total, height: (maxGen+1)*(CARD_H+V_GAP), gens:maxGen+1 };
}

/* ------------------------------------------------------------------ *
 * 6. TREE RENDER
 * ------------------------------------------------------------------ */
let treeLayout = null;

function renderTree(){
  const svg = $('#treeSvg');
  svg.innerHTML = '';
  $('#treeEmpty').classList.toggle('hidden', state.people.length > 0);
  if(!state.people.length) return;

  treeLayout = computeTreeLayout();
  const L = treeLayout;

  const root = svgEl('g', { id:'treeRoot' });
  svg.appendChild(root);

  const edgeLayer = svgEl('g'); root.appendChild(edgeLayer);
  const nodeLayer = svgEl('g'); root.appendChild(nodeLayer);

  /* ---- edges ---- */
  state.unions.forEach(u => {
    const U = L.unions[u.id];
    if(!U) return;
    const dashed = (u.type==='divorced' || u.type==='separated') ? '6 4' : null;

    // partner bar
    if(U.partners.length === 2){
      const a = L.nodes[U.partners[0]], b = L.nodes[U.partners[1]];
      const y = Math.max(a.y, b.y);
      edgeLayer.appendChild(svgEl('path', {
        class:'edge partner', 'stroke-dasharray':dashed,
        d:`M ${a.x} ${y} L ${b.x} ${y}`
      }));
      edgeLayer.appendChild(svgEl('circle', { class:'union-dot', cx:U.x, cy:y, r:4 }));
      if(u.children.length){
        edgeLayer.appendChild(svgEl('path', { class:'edge', d:`M ${U.x} ${y} L ${U.x} ${U.y}` }));
      }
    }

    // children
    const kids = u.children.filter(c => L.nodes[c]);
    if(!kids.length) return;

    const anchorX = U.partners.length === 2 ? U.x : L.nodes[U.partners[0]].x;
    const anchorY = U.partners.length === 2
      ? U.y
      : L.nodes[U.partners[0]].y + CARD_H/2;

    const kidXs = kids.map(c => L.nodes[c].x);
    const busY  = Math.min.apply(null, kids.map(c => L.nodes[c].y)) - CARD_H/2 - 30;

    edgeLayer.appendChild(svgEl('path', { class:'edge', d:`M ${anchorX} ${anchorY} L ${anchorX} ${busY}` }));
    if(kids.length > 1){
      edgeLayer.appendChild(svgEl('path', {
        class:'edge',
        d:`M ${Math.min.apply(null,kidXs.concat([anchorX]))} ${busY} L ${Math.max.apply(null,kidXs.concat([anchorX]))} ${busY}`
      }));
    }
    kids.forEach(c => {
      const n = L.nodes[c];
      edgeLayer.appendChild(svgEl('path', { class:'edge', d:`M ${n.x} ${busY} L ${n.x} ${n.y - CARD_H/2}` }));
    });
  });

  /* ---- cards ---- */
  state.people.forEach(p => {
    const n = L.nodes[p.id];
    if(!n) return;
    const g = svgEl('g', {
      class:'node-card' + (ui.selected===p.id?' selected':'') + (p.death?' deceased':''),
      transform:`translate(${n.x - CARD_W/2}, ${n.y - CARD_H/2})`
    });
    g.appendChild(svgEl('rect', { class:'card-bg', width:CARD_W, height:CARD_H, rx:9 }));

    if(p.avatar){
      const cid = 'clip_' + p.id;
      const cp = svgEl('clipPath', { id:cid });
      cp.appendChild(svgEl('circle', { cx:24, cy:CARD_H/2, r:15 }));
      g.appendChild(cp);
      const im = svgEl('image', {
        x:9, y:CARD_H/2-15, width:30, height:30,
        'clip-path':`url(#${cid})`, preserveAspectRatio:'xMidYMid slice'
      });
      im.setAttributeNS('http://www.w3.org/1999/xlink','href', p.avatar);
      im.setAttribute('href', p.avatar);
      g.appendChild(im);
    } else {
      g.appendChild(svgEl('circle', { cx:24, cy:CARD_H/2, r:15, fill:'#232836', stroke:'#2f3purple' }));
      g.lastChild.setAttribute('stroke','#2f3545');
      const t = svgEl('text', { x:24, y:CARD_H/2+4, 'text-anchor':'middle', fill:'#6b7488', 'font-size':11, 'font-weight':700 });
      t.textContent = initials(p.name);
      g.appendChild(t);
    }

    const nm = svgEl('text', { class:'nm', x:46, y: ui.tree.showDates && lifespan(p) ? 22 : 30 });
    nm.textContent = truncate(p.name, 15);
    g.appendChild(nm);

    if(ui.tree.showDates && lifespan(p)){
      const dt = svgEl('text', { class:'dt', x:46, y:37 });
      dt.textContent = lifespan(p);
      g.appendChild(dt);
    }

    g.addEventListener('click', ev => { ev.stopPropagation(); selectPerson(p.id); });
    nodeLayer.appendChild(g);
  });

  applyTreeTransform();
}

function truncate(s, n){ s = String(s||''); return s.length > n ? s.slice(0,n-1)+'\u2026' : s; }

function applyTreeTransform(){
  const r = $('#treeRoot');
  if(r) r.setAttribute('transform', `translate(${ui.tree.x},${ui.tree.y}) scale(${ui.tree.k})`);
  $('#treeZoomLabel').textContent = Math.round(ui.tree.k*100) + '%';
}

function fitTree(){
  if(!treeLayout || !state.people.length) return;
  const svg = $('#treeSvg');
  const W = svg.clientWidth, H = svg.clientHeight;
  const pad = 70;
  const k = Math.min((W-pad*2)/Math.max(treeLayout.width,1), (H-pad*2)/Math.max(treeLayout.height+CARD_H,1), 1.4);
  ui.tree.k = Math.max(0.15, k);
  ui.tree.x = W/2 - (treeLayout.width/2)*ui.tree.k;
  ui.tree.y = pad - (-CARD_H/2)*ui.tree.k;
  applyTreeTransform();
}

/* ------------------------------------------------------------------ *
 * 7. NETWORK VIEW (lightweight force simulation)
 * ------------------------------------------------------------------ */
let netNodes = [], netSimTimer = null;

function visibleLinks(){
  return state.links.filter(l => !ui.net.hidden.has(l.type) && byId(l.from) && byId(l.to));
}
function familyPairs(){
  const out = [];
  state.unions.forEach(u => {
    const ps = u.partners.filter(Boolean);
    if(ps.length===2) out.push([ps[0],ps[1]]);
    u.children.forEach(c => ps.forEach(p => out.push([p,c])));
  });
  return out;
}

function renderNetwork(){
  const svg = $('#netSvg');
  const links = visibleLinks();
  const fam = ui.net.showFamily ? familyPairs() : [];
  $('#netEmpty').classList.toggle('hidden', links.length > 0 || fam.length > 0);

  // only include people who appear in a visible link (or everyone if overlaying family)
  const ids = new Set();
  links.forEach(l => { ids.add(l.from); ids.add(l.to); });
  if(ui.net.showFamily) state.people.forEach(p => ids.add(p.id));
  const list = Array.from(ids);

  const W = svg.clientWidth || 800, H = svg.clientHeight || 600;
  const prev = {}; netNodes.forEach(n => prev[n.id] = n);
  netNodes = list.map((id,i) => {
    const o = prev[id];
    const ang = (i/Math.max(list.length,1)) * Math.PI*2;
    return o ? o : {
      id, x: W/2 + Math.cos(ang)*Math.min(W,H)*0.3,
      y: H/2 + Math.sin(ang)*Math.min(W,H)*0.3, vx:0, vy:0
    };
  });

  const index = {}; netNodes.forEach(n => index[n.id] = n);
  const edges = links.map(l => ({ a:index[l.from], b:index[l.to], link:l, fam:false }))
    .concat(fam.filter(([a,b]) => index[a] && index[b]).map(([a,b]) => ({ a:index[a], b:index[b], fam:true })));

  simulate(edges, W, H);
  drawNetwork(edges, W, H);
}

function simulate(edges, W, H, iterations){
  const n = netNodes.length;
  if(!n) return;
  const iters = iterations || 300;
  const ideal = Math.max(90, Math.min(W,H) / Math.sqrt(n+1) * 1.5);

  for(let it=0; it<iters; it++){
    const cool = 1 - it/iters;
    // repulsion
    for(let i=0;i<n;i++){
      for(let j=i+1;j<n;j++){
        const a = netNodes[i], b = netNodes[j];
        let dx = b.x-a.x, dy = b.y-a.y;
        let d2 = dx*dx+dy*dy || 0.01;
        const d = Math.sqrt(d2);
        const rep = (ideal*ideal) / d2 * 0.9;
        const ux = dx/d, uy = dy/d;
        a.vx -= ux*rep; a.vy -= uy*rep;
        b.vx += ux*rep; b.vy += uy*rep;
      }
    }
    // springs
    edges.forEach(e => {
      if(!e.a || !e.b) return;
      const dx = e.b.x-e.a.x, dy = e.b.y-e.a.y;
      const d = Math.sqrt(dx*dx+dy*dy) || 0.01;
      const k = e.fam ? 0.012 : 0.02;
      const f = (d - ideal) * k;
      const ux = dx/d, uy = dy/d;
      e.a.vx += ux*f; e.a.vy += uy*f;
      e.b.vx -= ux*f; e.b.vy -= uy*f;
    });
    // gravity toward centre + integrate
    netNodes.forEach(p => {
      p.vx += (W/2 - p.x) * 0.004;
      p.vy += (H/2 - p.y) * 0.004;
      p.vx *= 0.82*cool + 0.1; p.vy *= 0.82*cool + 0.1;
      p.x += Math.max(-18, Math.min(18, p.vx));
      p.y += Math.max(-18, Math.min(18, p.vy));
      p.x = Math.max(40, Math.min(W-40, p.x));
      p.y = Math.max(40, Math.min(H-40, p.y));
    });
  }
}

function drawNetwork(edges, W, H){
  const svg = $('#netSvg');
  svg.innerHTML = '';

  // arrow markers per type
  const defs = svgEl('defs');
  Object.keys(LINK_TYPES).forEach(t => {
    const cfg = LINK_TYPES[t];
    if(!cfg.directed) return;
    const m = svgEl('marker', {
      id:'arr_'+t, viewBox:'0 0 10 10', refX:19, refY:5,
      markerWidth:6, markerHeight:6, orient:'auto-start-reverse'
    });
    m.appendChild(svgEl('path', { d:'M 0 0 L 10 5 L 0 10 z', fill:cfg.color }));
    defs.appendChild(m);
  });
  svg.appendChild(defs);

  const eg = svgEl('g'), ng = svgEl('g');
  svg.appendChild(eg); svg.appendChild(ng);

  edges.forEach(e => {
    if(!e.a || !e.b) return;
    if(e.fam){
      eg.appendChild(svgEl('line', {
        class:'net-link fam', x1:e.a.x, y1:e.a.y, x2:e.b.x, y2:e.b.y
      }));
      return;
    }
    const cfg = LINK_TYPES[e.link.type] || LINK_TYPES.custom;
    const ln = svgEl('line', {
      class:'net-link', x1:e.a.x, y1:e.a.y, x2:e.b.x, y2:e.b.y,
      stroke:cfg.color, 'stroke-width':cfg.width||1.8,
      'stroke-dasharray':cfg.dash,
      'marker-end': cfg.directed ? `url(#arr_${e.link.type})` : null
    });
    const title = svgEl('title');
    title.textContent = `${nameOf(e.link.from)} \u2014 ${cfg.label}${e.link.label?' ('+e.link.label+')':''} \u2014 ${nameOf(e.link.to)}`;
    ln.appendChild(title);
    eg.appendChild(ln);
  });

  netNodes.forEach(nd => {
    const p = byId(nd.id); if(!p) return;
    const g = svgEl('g', { class:'net-node', transform:`translate(${nd.x},${nd.y})` });
    const deg = linksOf(p.id).filter(l=>!ui.net.hidden.has(l.type)).length;
    const r = 9 + Math.min(10, deg*1.6);
    g.appendChild(svgEl('circle', {
      r, fill: ui.selected===p.id ? '#7c9cff' : '#39405a'
    }));
    if(ui.net.showLabels){
      const t = svgEl('text', { y: r + 14, 'text-anchor':'middle' });
      t.textContent = truncate(p.name, 16);
      g.appendChild(t);
    }
    g.addEventListener('click', ev => { ev.stopPropagation(); selectPerson(p.id); });
    ng.appendChild(g);
  });
}

function renderLegend(){
  const box = $('#legendList');
  box.innerHTML = '';
  Object.keys(LINK_TYPES).forEach(t => {
    const cfg = LINK_TYPES[t];
    const count = state.links.filter(l => l.type === t).length;
    const lab = document.createElement('label');
    lab.className = 'legend-item';
    lab.innerHTML =
      `<input type="checkbox" ${ui.net.hidden.has(t)?'':'checked'} data-type="${t}">` +
      `<span class="swatch" style="background:${cfg.color}"></span>` +
      `<span style="flex:1">${esc(cfg.label)}</span>` +
      `<span class="muted" style="font-size:11px">${count||''}</span>`;
    lab.querySelector('input').addEventListener('change', e => {
      if(e.target.checked) ui.net.hidden.delete(t); else ui.net.hidden.add(t);
      renderNetwork(); renderLegend();
    });
    box.appendChild(lab);
  });
}

/* ------------------------------------------------------------------ *
 * 8. GALLERY VIEW
 * ------------------------------------------------------------------ */
function renderGallery(){
  const grid = $('#galleryGrid');
  const sel  = $('#galleryFilter');
  const keep = sel.value;
  sel.innerHTML = '<option value="">Everyone</option>' +
    state.people.slice().sort((a,b)=>a.name.localeCompare(b.name))
      .map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  sel.value = keep && byId(keep) ? keep : '';
  ui.gallery.filter = sel.value;

  const people = ui.gallery.filter ? [byId(ui.gallery.filter)] : state.people;
  const groups = people.filter(p => p && p.photos && p.photos.length);
  const total = groups.reduce((a,p)=>a+p.photos.length, 0);

  $('#galleryCount').textContent = total ? `${total} photo${total===1?'':'s'}` : '';
  $('#galleryEmpty').classList.toggle('hidden', total > 0);
  grid.innerHTML = '';

  groups.forEach(p => {
    const sec = document.createElement('div');
    sec.className = 'gal-group';
    sec.innerHTML = `<h3>${esc(p.name)} <span class="count">${p.photos.length}</span></h3>`;
    const row = document.createElement('div');
    row.className = 'gal-row';
    p.photos.forEach((ph, i) => {
      const fig = document.createElement('figure');
      fig.className = 'gal-cell';
      fig.innerHTML = `<img src="${ph.src}" alt="${esc(ph.caption||p.name)}">` +
                      (ph.caption ? `<figcaption>${esc(ph.caption)}</figcaption>` : '');
      fig.addEventListener('click', () => openLightbox(p.photos, i, p.name));
      row.appendChild(fig);
    });
    sec.appendChild(row);
    grid.appendChild(sec);
  });
}

/* ------------------------------------------------------------------ *
 * 9. SIDE PANEL
 * ------------------------------------------------------------------ */
function selectPerson(id){
  ui.selected = id;
  openPanel(id);
  if(ui.view === 'tree') renderTree();
  if(ui.view === 'network') drawNetworkRefresh();
}
function drawNetworkRefresh(){
  const links = visibleLinks();
  const fam = ui.net.showFamily ? familyPairs() : [];
  const index = {}; netNodes.forEach(n => index[n.id] = n);
  const edges = links.map(l => ({ a:index[l.from], b:index[l.to], link:l, fam:false }))
    .concat(fam.filter(([a,b]) => index[a] && index[b]).map(([a,b]) => ({ a:index[a], b:index[b], fam:true })));
  drawNetwork(edges);
}

function closePanel(){
  $('#sidepanel').classList.add('hidden');
  ui.selected = null;
  if(ui.view==='tree') renderTree();
  if(ui.view==='network') drawNetworkRefresh();
}

function openPanel(id){
  const p = byId(id);
  if(!p) return closePanel();
  const panel = $('#sidepanel');
  panel.classList.remove('hidden');
  const body = $('#panelBody');

  const av = p.avatar
    ? `<img class="avatar" src="${p.avatar}" alt="">`
    : `<div class="avatar">${esc(initials(p.name))}</div>`;

  const sub = [p.nickname && '\u201c'+p.nickname+'\u201d', lifespan(p), p.occupation]
    .filter(Boolean).join(' \u00b7 ');

  let html = `
    <div class="p-head">
      ${av}
      <div style="min-width:0">
        <h2>${esc(p.name)}</h2>
        ${sub ? `<div class="sub">${esc(sub)}</div>` : ''}
      </div>
    </div>

    <div class="p-sec">
      <div class="row">
        <button class="btn small" data-act="edit">Edit</button>
        <button class="btn small ghost" data-act="photos">+ Photos</button>
        <button class="btn small danger" data-act="delete">Delete</button>
      </div>
    </div>`;

  if(p.bio){
    html += `<div class="p-sec"><h4>About</h4><p>${esc(p.bio)}</p></div>`;
  }
  if(p.tags && p.tags.length){
    html += `<div class="p-sec"><h4>Tags</h4><div class="chips">` +
      p.tags.map(t=>`<span class="chip">${esc(t)}</span>`).join('') + `</div></div>`;
  }

  /* ---- family ---- */
  const fam = [];
  parentsOf(p.id).forEach(x => fam.push(['Parent', x, '#60a5fa', 'parent']));
  partnersOf(p.id).forEach(x => {
    const u = state.unions.find(z => z.partners.includes(p.id) && z.partners.includes(x));
    fam.push([UNION_TYPES[(u&&u.type)||'partnership'], x, '#a78bfa', 'partner']);
  });
  siblingsOf(p.id).forEach(x => fam.push(['Sibling', x, '#5eead4', 'sibling']));
  childrenOf(p.id).forEach(x => fam.push(['Child', x, '#fbbf24', 'child']));

  html += `<div class="p-sec">
    <h4>Family <button class="btn small ghost" data-act="addfam">+ Add</button></h4>`;
  html += fam.length
    ? fam.map(([lab,x,col,kind]) =>
        `<div class="rel-line" data-goto="${x}">
           <span class="tag" style="background:${col}">${esc(lab)}</span>
           <span class="nm">${esc(nameOf(x))}</span>
           ${kind==='sibling'?'':`<span class="x" data-unfam="${kind}:${x}" title="Remove">\u00d7</span>`}
         </div>`).join('')
    : `<p class="muted" style="font-size:13px">No family recorded.</p>`;
  html += `</div>`;

  /* ---- social links ---- */
  const ls = linksOf(p.id);
  html += `<div class="p-sec">
    <h4>Relationships <button class="btn small ghost" data-act="addlink">+ Add</button></h4>`;
  html += ls.length
    ? ls.map(l => {
        const cfg = LINK_TYPES[l.type] || LINK_TYPES.custom;
        const other = l.from === p.id ? l.to : l.from;
        const dir = cfg.directed ? (l.from === p.id ? ' \u2192' : ' \u2190') : '';
        return `<div class="rel-line" data-goto="${other}">
            <span class="tag" style="background:${cfg.color}">${esc(cfg.label.split(' \u2192')[0])}${dir}</span>
            <span class="nm">${esc(nameOf(other))}${l.label?' \u00b7 '+esc(l.label):''}</span>
            <span class="x" data-unlink="${l.id}" title="Remove">\u00d7</span>
          </div>`;
      }).join('')
    : `<p class="muted" style="font-size:13px">No friendships, rivalries or guardians yet.</p>`;
  html += `</div>`;

  /* ---- gallery ---- */
  html += `<div class="p-sec">
    <h4>Gallery <span class="muted" style="font-weight:500">${(p.photos||[]).length}</span></h4>`;
  html += (p.photos && p.photos.length)
    ? `<div class="mini-gal">` + p.photos.map((ph,i) =>
        `<div class="cell" data-photo="${i}">
           <img src="${ph.src}" alt="">
           <button class="del" data-delphoto="${i}">\u00d7</button>
         </div>`).join('') + `</div>`
    : `<p class="muted" style="font-size:13px">No photos yet.</p>`;
  html += `</div>`;

  body.innerHTML = html;

  /* ---- wiring ---- */
  body.querySelectorAll('[data-goto]').forEach(el => {
    el.addEventListener('click', ev => {
      if(ev.target.dataset.unlink || ev.target.dataset.unfam) return;
      selectPerson(el.dataset.goto);
    });
  });
  body.querySelectorAll('[data-unlink]').forEach(el =>
    el.addEventListener('click', ev => {
      ev.stopPropagation();
      removeLink(el.dataset.unlink); refreshAll(); openPanel(p.id);
    }));
  body.querySelectorAll('[data-unfam]').forEach(el =>
    el.addEventListener('click', ev => {
      ev.stopPropagation();
      const [kind, other] = el.dataset.unfam.split(':');
      if(kind === 'parent'){
        const u = parentUnionOf(p.id);
        if(u && u.partners.filter(Boolean).length <= 1) detachParents(p.id);
        else if(u){ u.partners = u.partners.map(x => x===other ? null : x); save(); }
      }
      else if(kind === 'partner') unlinkPartner(p.id, other);
      else if(kind === 'child') detachParents(other);
      refreshAll(); openPanel(p.id);
    }));
  body.querySelectorAll('[data-photo]').forEach(el =>
    el.addEventListener('click', ev => {
      if(ev.target.dataset.delphoto) return;
      openLightbox(p.photos, +el.dataset.photo, p.name);
    }));
  body.querySelectorAll('[data-delphoto]').forEach(el =>
    el.addEventListener('click', ev => {
      ev.stopPropagation();
      p.photos.splice(+el.dataset.delphoto, 1); save(); openPanel(p.id);
      if(ui.view==='gallery') renderGallery();
    }));

  const act = a => body.querySelector(`[data-act="${a}"]`);
  act('edit').addEventListener('click', () => openPersonEditor(p.id));
  act('photos').addEventListener('click', () => pickPhotos(p.id));
  act('delete').addEventListener('click', () => {
    if(confirm(`Delete ${p.name}? This also removes their relationships.`)){
      removePerson(p.id); closePanel(); refreshAll(); toast('Person deleted');
    }
  });
  act('addfam').addEventListener('click', () => openFamilyDialog(p.id));
  act('addlink').addEventListener('click', () => openLinkDialog(p.id));
}

/* ------------------------------------------------------------------ *
 * 10. MODALS
 * ------------------------------------------------------------------ */
function showModal(title, html, wire){
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = html;
  $('#modalBackdrop').classList.remove('hidden');
  if(wire) wire($('#modalBody'));
}
function hideModal(){ $('#modalBackdrop').classList.add('hidden'); $('#modalBody').innerHTML=''; }

function personOptions(excludeId, selected){
  return state.people
    .filter(p => p.id !== excludeId)
    .sort((a,b)=>a.name.localeCompare(b.name))
    .map(p => `<option value="${p.id}" ${p.id===selected?'selected':''}>${esc(p.name)}${lifespan(p)?' ('+lifespan(p)+')':''}</option>`)
    .join('');
}

function openPersonEditor(id){
  const p = id ? byId(id) : null;
  const html = `
    <div class="field"><label>Full name</label>
      <input id="f_name" value="${esc(p?p.name:'')}" placeholder="e.g. Maren Okonkwo"></div>
    <div class="grid2">
      <div class="field"><label>Nickname</label>
        <input id="f_nick" value="${esc(p?p.nickname:'')}"></div>
      <div class="field"><label>Gender / pronouns</label>
        <input id="f_gender" value="${esc(p?p.gender:'')}" placeholder="optional"></div>
    </div>
    <div class="grid2">
      <div class="field"><label>Born</label>
        <input id="f_birth" value="${esc(p?p.birth:'')}" placeholder="1974 or 1974-03-02"></div>
      <div class="field"><label>Died</label>
        <input id="f_death" value="${esc(p?p.death:'')}" placeholder="leave blank if living"></div>
    </div>
    <div class="field"><label>Role / occupation</label>
      <input id="f_occ" value="${esc(p?p.occupation:'')}"></div>
    <div class="field"><label>Notes / biography</label>
      <textarea id="f_bio" placeholder="Anything worth remembering">${esc(p?p.bio:'')}</textarea></div>
    <div class="field"><label>Tags (comma separated)</label>
      <input id="f_tags" value="${esc(p && p.tags ? p.tags.join(', ') : '')}" placeholder="maternal line, founder, adopted"></div>
    <div class="field"><label>Portrait</label>
      <div class="row">
        <button class="btn small ghost" id="f_avatarBtn">Choose image\u2026</button>
        ${p && p.avatar ? '<button class="btn small danger" id="f_avatarClear">Remove</button>' : ''}
        <span class="muted" id="f_avatarName" style="align-self:center;font-size:12px">${p&&p.avatar?'image set':''}</span>
      </div>
    </div>
    <div class="form-actions">
      <button class="btn ghost" id="f_cancel">Cancel</button>
      <button class="btn primary" id="f_save">${p?'Save changes':'Add person'}</button>
    </div>`;

  showModal(p ? 'Edit person' : 'Add person', html, box => {
    let pendingAvatar = p ? p.avatar : '';

    box.querySelector('#f_avatarBtn').addEventListener('click', () => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/*';
      inp.onchange = () => {
        const f = inp.files[0]; if(!f) return;
        readImage(f, 400, dataUrl => {
          pendingAvatar = dataUrl;
          box.querySelector('#f_avatarName').textContent = f.name;
        });
      };
      inp.click();
    });
    const clr = box.querySelector('#f_avatarClear');
    if(clr) clr.addEventListener('click', () => {
      pendingAvatar = '';
      box.querySelector('#f_avatarName').textContent = 'removed';
    });

    box.querySelector('#f_cancel').addEventListener('click', hideModal);
    box.querySelector('#f_save').addEventListener('click', () => {
      const data = {
        name:   box.querySelector('#f_name').value.trim() || 'Unnamed',
        nickname: box.querySelector('#f_nick').value.trim(),
        gender: box.querySelector('#f_gender').value.trim(),
        birth:  box.querySelector('#f_birth').value.trim(),
        death:  box.querySelector('#f_death').value.trim(),
        occupation: box.querySelector('#f_occ').value.trim(),
        bio:    box.querySelector('#f_bio').value.trim(),
        tags:   box.querySelector('#f_tags').value.split(',').map(s=>s.trim()).filter(Boolean),
        avatar: pendingAvatar
      };
      let target;
      if(p){ Object.assign(p, data); save(); target = p.id; }
      else { target = addPerson(data).id; }
      hideModal(); refreshAll(); selectPerson(target);
      toast(p ? 'Saved' : 'Person added');
    });

    setTimeout(()=>box.querySelector('#f_name').focus(), 30);
  });
}

function openFamilyDialog(pid){
  const p = byId(pid);
  const html = `
    <div class="field"><label>Relationship</label>
      <select id="k_kind">
        <option value="parent">\u2191 Add a parent of ${esc(p.name)}</option>
        <option value="child">\u2193 Add a child of ${esc(p.name)}</option>
        <option value="partner">\u2194 Add a partner / spouse</option>
        <option value="sibling">\u2194 Add a sibling</option>
      </select></div>

    <div class="field"><label>Person</label>
      <select id="k_who">
        <option value="__new__">\u2795 Create a new person\u2026</option>
        ${personOptions(pid)}
      </select></div>

    <div class="field hidden" id="k_newwrap"><label>New person's name</label>
      <input id="k_newname" placeholder="Name"></div>

    <div class="field" id="k_uniontypewrap"><label>Union type</label>
      <select id="k_uniontype">
        ${Object.keys(UNION_TYPES).map(k=>`<option value="${k}">${UNION_TYPES[k]}</option>`).join('')}
      </select></div>

    <div class="form-actions">
      <button class="btn ghost" id="k_cancel">Cancel</button>
      <button class="btn primary" id="k_add">Add</button>
    </div>`;

  showModal('Add family relationship', html, box => {
    const kind = box.querySelector('#k_kind');
    const who  = box.querySelector('#k_who');
    const newWrap = box.querySelector('#k_newwrap');
    const utWrap  = box.querySelector('#k_uniontypewrap');

    const sync = () => {
      newWrap.classList.toggle('hidden', who.value !== '__new__');
      utWrap.classList.toggle('hidden', kind.value !== 'partner');
    };
    kind.addEventListener('change', sync);
    who.addEventListener('change', sync);
    sync();

    box.querySelector('#k_cancel').addEventListener('click', hideModal);
    box.querySelector('#k_add').addEventListener('click', () => {
      let otherId = who.value;
      if(otherId === '__new__'){
        const nm = box.querySelector('#k_newname').value.trim();
        if(!nm) return toast('Give the new person a name');
        otherId = addPerson({ name:nm }).id;
      }
      const k = kind.value;
      if(k === 'parent')  addParentTo(pid, otherId);
      if(k === 'child')   addChildTo(pid, otherId);
      if(k === 'partner') linkPartners(pid, otherId, box.querySelector('#k_uniontype').value);
      if(k === 'sibling'){
        const u = parentUnionOf(pid);
        if(u){ if(!u.children.includes(otherId)){ detachParents(otherId); u.children.push(otherId); save(); } }
        else {
          const nu = { id:uid('u'), partners:[null,null], children:[pid, otherId], type:'unknown', start:'', end:'' };
          detachParents(otherId); state.unions.push(nu); save();
        }
      }
      hideModal(); refreshAll(); openPanel(pid); toast('Relationship added');
    });
  });
}

function openLinkDialog(pid){
  const p = byId(pid);
  const html = `
    <div class="field"><label>Type</label>
      <select id="l_type">
        ${Object.keys(LINK_TYPES).map(k=>`<option value="${k}">${esc(LINK_TYPES[k].label)}</option>`).join('')}
      </select></div>

    <div class="field"><label>With</label>
      <select id="l_who">
        <option value="__new__">\u2795 Create a new person\u2026</option>
        ${personOptions(pid)}
      </select></div>

    <div class="field hidden" id="l_newwrap"><label>New person's name</label>
      <input id="l_newname" placeholder="Name"></div>

    <div class="field hidden" id="l_dirwrap"><label>Direction</label>
      <select id="l_dir">
        <option value="out">${esc(p.name)} is the guardian / mentor</option>
        <option value="in">${esc(p.name)} is the ward / student</option>
      </select></div>

    <div class="field"><label>Note (optional)</label>
      <input id="l_label" placeholder="e.g. since the war, estranged 1998"></div>

    <div class="form-actions">
      <button class="btn ghost" id="l_cancel">Cancel</button>
      <button class="btn primary" id="l_add">Add link</button>
    </div>`;

  showModal('Add relationship', html, box => {
    const type = box.querySelector('#l_type');
    const who  = box.querySelector('#l_who');
    const sync = () => {
      box.querySelector('#l_newwrap').classList.toggle('hidden', who.value !== '__new__');
      box.querySelector('#l_dirwrap').classList.toggle('hidden', !LINK_TYPES[type.value].directed);
    };
    type.addEventListener('change', sync);
    who.addEventListener('change', sync);
    sync();

    box.querySelector('#l_cancel').addEventListener('click', hideModal);
    box.querySelector('#l_add').addEventListener('click', () => {
      let otherId = who.value;
      if(otherId === '__new__'){
        const nm = box.querySelector('#l_newname').value.trim();
        if(!nm) return toast('Give the new person a name');
        otherId = addPerson({ name:nm }).id;
      }
      const t = type.value;
      const note = box.querySelector('#l_label').value.trim();
      const inward = LINK_TYPES[t].directed && box.querySelector('#l_dir').value === 'in';
      addLink(inward ? otherId : pid, inward ? pid : otherId, t, note);
      hideModal(); refreshAll(); openPanel(pid); toast('Link added');
    });
  });
}

/* ------------------------------------------------------------------ *
 * 11. Photos & images
 * ------------------------------------------------------------------ */
function readImage(file, maxDim, cb){
  const fr = new FileReader();
  fr.onload = () => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.round(img.width*scale), h = Math.round(img.height*scale);
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      cb(cv.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => cb(fr.result);
    img.src = fr.result;
  };
  fr.readAsDataURL(file);
}

function pickPhotos(pid){
  const inp = $('#filePicker');
  inp.value = '';
  inp.onchange = () => {
    const files = Array.from(inp.files || []);
    if(!files.length) return;
    const p = byId(pid); if(!p) return;
    p.photos = p.photos || [];
    let done = 0;
    files.forEach(f => {
      readImage(f, 1400, src => {
        p.photos.push({ id:uid('ph'), src, caption:f.name.replace(/\.[^.]+$/, '') });
        if(++done === files.length){
          save(); openPanel(pid);
          if(ui.view==='gallery') renderGallery();
          toast(files.length + ' photo' + (files.length===1?'':'s') + ' added');
        }
      });
    });
  };
  inp.click();
}

/* ------------------------------------------------------------------ *
 * 12. Lightbox
 * ------------------------------------------------------------------ */
function openLightbox(list, index, who){
  ui.lightbox = { list, index, who };
  paintLightbox();
  $('#lightbox').classList.remove('hidden');
}
function paintLightbox(){
  const { list, index, who } = ui.lightbox;
  const ph = list[index]; if(!ph) return;
  $('#lbImg').src = ph.src;
  $('#lbCap').textContent = [who, ph.caption, `${index+1} / ${list.length}`].filter(Boolean).join(' \u00b7 ');
}
function stepLightbox(d){
  const L = ui.lightbox;
  if(!L.list || !L.list.length) return;
  L.index = (L.index + d + L.list.length) % L.list.length;
  paintLightbox();
}

/* ------------------------------------------------------------------ *
 * 13. Search
 * ------------------------------------------------------------------ */
function runSearch(q){
  const box = $('#searchResults');
  q = q.trim().toLowerCase();
  if(!q){ box.classList.add('hidden'); return; }
  const hits = state.people.filter(p =>
    p.name.toLowerCase().includes(q) ||
    (p.nickname||'').toLowerCase().includes(q) ||
    (p.occupation||'').toLowerCase().includes(q) ||
    (p.tags||[]).some(t => t.toLowerCase().includes(q))
  ).slice(0, 12);

  if(!hits.length){
    box.innerHTML = '<button disabled style="color:var(--text-faint)">No matches</button>';
  } else {
    box.innerHTML = hits.map(p =>
      `<button data-id="${p.id}">
         <span class="avatar" style="width:26px;height:26px;font-size:11px">${p.avatar?`<img src="${p.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`:esc(initials(p.name))}</span>
         <span style="flex:1">${esc(p.name)}</span>
         <span class="muted" style="font-size:11.5px">${esc(lifespan(p))}</span>
       </button>`).join('');
    box.querySelectorAll('[data-id]').forEach(b =>
      b.addEventListener('click', () => {
        selectPerson(b.dataset.id);
        box.classList.add('hidden');
        $('#search').value = '';
      }));
  }
  box.classList.remove('hidden');
}

/* ------------------------------------------------------------------ *
 * 14. Import / export / sample
 * ------------------------------------------------------------------ */
function exportJSON(){
  const blob = new Blob([JSON.stringify(state, null, 2)], { type:'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'kinweave-' + new Date().toISOString().slice(0,10) + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Exported');
}
function importJSON(){
  const inp = $('#jsonPicker');
  inp.value = '';
  inp.onchange = () => {
    const f = inp.files[0]; if(!f) return;
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const d = JSON.parse(fr.result);
        if(!d.people) throw 0;
        state = {
          people: d.people||[], unions: d.unions||[], links: d.links||[]
        };
        save(); closePanel(); refreshAll(); fitTree(); toast('Imported');
      } catch(e){ toast('That file does not look like a KinWeave export'); }
    };
    fr.readAsText(f);
  };
  inp.click();
}

function loadSample(){
  state = blankState();
  const mk = (name, extra) => addPerson(Object.assign({ name }, extra||{}));

  const ada    = mk('Adaeze Okonkwo',  { birth:'1931', death:'2009', occupation:'Schoolteacher', bio:'Kept every letter the family ever sent her.' });
  const emeka  = mk('Emeka Okonkwo',   { birth:'1928', death:'2001', occupation:'Railway engineer' });
  const rose   = mk('Rosalind Hale',   { birth:'1936', death:'2018', occupation:'Botanist', tags:['maternal line'] });
  const walter = mk('Walter Hale',     { birth:'1933', death:'2011', occupation:'Carpenter' });

  const maren  = mk('Maren Okonkwo',   { birth:'1958', occupation:'Architect', nickname:'Mare', bio:'Designed the family house in 1994.' });
  const tunde  = mk('Tunde Okonkwo',   { birth:'1961', occupation:'Chef' });
  const juno   = mk('Juno Hale',       { birth:'1960', occupation:'Civil rights lawyer', tags:['founder'] });
  const perry  = mk('Perry Hale',      { birth:'1964', death:'1998', occupation:'Photographer' });

  const nia    = mk('Nia Okonkwo-Hale',{ birth:'1989', occupation:'Marine biologist' });
  const kaz    = mk('Kazimir Okonkwo-Hale', { birth:'1992', occupation:'Sound designer', nickname:'Kaz' });
  const soren  = mk('Soren Vale',      { birth:'1990', occupation:'Paramedic' });
  const indra  = mk('Indra Okonkwo',   { birth:'1994', occupation:'Student' });

  const wren   = mk('Wren Okonkwo-Vale',{ birth:'2019' });

  // unions
  const u1 = linkPartners(ada, emeka, 'marriage');
  u1.children = [maren, tunde];
  const u2 = linkPartners(rose, walter, 'marriage');
  u2.children = [juno, perry];
  const u3 = linkPartners(maren, juno, 'marriage');
  u3.children = [nia, kaz];
  const u4 = linkPartners(tunde, null, 'unknown');
  u4.children = [indra];
  const u5 = linkPartners(nia, soren, 'partnership');
  u5.children = [wren];

  // social web
  addLink(kaz, soren, 'best_friend', 'met at university');
  addLink(indra, kaz, 'friend');
  addLink(nia, indra, 'friend', 'cousins and close');
  addLink(juno, perry, 'rival', 'argued over the estate');
  addLink(maren, perry, 'enemy', 'never reconciled');
  addLink(ada, juno, 'mentor', 'taught her to write briefs');
  addLink(rose, nia, 'mentor', 'botany lessons as a child');
  addLink(walter, kaz, 'guardian', 'legal guardian 1998\u20132001');
  addLink(tunde, soren, 'colleague');
  addLink(maren, rose, 'ally', 'co-founded the trust');
  addLink(indra, soren, 'acquaintance');
  addLink(kaz, nia, 'friend', 'siblings who actually get along');

  save();
  closePanel(); refreshAll(); fitTree();
  toast('Sample family loaded');
}

/* ------------------------------------------------------------------ *
 * 15. View switching + global render
 * ------------------------------------------------------------------ */
function setView(v){
  ui.view = v;
  $$('#viewtabs .tab').forEach(t => t.classList.toggle('active', t.dataset.view === v));
  $('#view-tree').classList.toggle('hidden', v !== 'tree');
  $('#view-network').classList.toggle('hidden', v !== 'network');
  $('#view-gallery').classList.toggle('hidden', v !== 'gallery');
  refreshAll();
  if(v === 'tree' && treeLayout === null) fitTree();
}

function refreshAll(){
  if(ui.view === 'tree') renderTree();
  if(ui.view === 'network'){ renderLegend(); renderNetwork(); }
  if(ui.view === 'gallery') renderGallery();
  if(ui.selected && byId(ui.selected)) { /* panel stays as-is */ }
}

/* ------------------------------------------------------------------ *
 * 16. Event wiring
 * ------------------------------------------------------------------ */
function wire(){
  /* view tabs */
  $('#viewtabs').addEventListener('click', e => {
    const t = e.target.closest('.tab'); if(t) setView(t.dataset.view);
  });

  /* top actions */
  $('#btnAddPerson').addEventListener('click', () => openPersonEditor());
  $('#btnMenu').addEventListener('click', e => {
    e.stopPropagation(); $('#menuPop').classList.toggle('hidden');
  });
  $('#menuPop').addEventListener('click', e => {
    const b = e.target.closest('button'); if(!b) return;
    $('#menuPop').classList.add('hidden');
    const a = b.dataset.act;
    if(a === 'sample'){ if(!state.people.length || confirm('Replace current data with the sample family?')) loadSample(); }
    if(a === 'export') exportJSON();
    if(a === 'import') importJSON();
    if(a === 'clear'){
      if(confirm('Delete everything? This cannot be undone.')){
        state = blankState(); save(); closePanel(); treeLayout = null; refreshAll(); toast('Cleared');
      }
    }
  });
  document.addEventListener('click', () => {
    $('#menuPop').classList.add('hidden');
    $('#searchResults').classList.add('hidden');
  });

  /* search */
  $('#search').addEventListener('input', e => runSearch(e.target.value));
  $('#search').addEventListener('click', e => { e.stopPropagation(); runSearch(e.target.value); });
  $('#searchResults').addEventListener('click', e => e.stopPropagation());

  /* panel + modal */
  $('#panelClose').addEventListener('click', closePanel);
  $('#modalClose').addEventListener('click', hideModal);
  $('#modalBackdrop').addEventListener('click', e => { if(e.target.id === 'modalBackdrop') hideModal(); });

  /* tree controls */
  $('#treeZoomIn').addEventListener('click',  () => { ui.tree.k = Math.min(3, ui.tree.k*1.2); applyTreeTransform(); });
  $('#treeZoomOut').addEventListener('click', () => { ui.tree.k = Math.max(0.12, ui.tree.k/1.2); applyTreeTransform(); });
  $('#treeFit').addEventListener('click', fitTree);
  $('#treeShowDates').addEventListener('change', e => { ui.tree.showDates = e.target.checked; renderTree(); });

  /* pan + zoom on tree */
  const svg = $('#treeSvg');
  let drag = null;
  svg.addEventListener('mousedown', e => {
    if(e.target.closest('.node-card')) return;
    drag = { x:e.clientX, y:e.clientY, ox:ui.tree.x, oy:ui.tree.y };
    svg.classList.add('grabbing');
  });
  window.addEventListener('mousemove', e => {
    if(!drag) return;
    ui.tree.x = drag.ox + (e.clientX - drag.x);
    ui.tree.y = drag.oy + (e.clientY - drag.y);
    applyTreeTransform();
  });
  window.addEventListener('mouseup', () => { drag = null; svg.classList.remove('grabbing'); });
  svg.addEventListener('click', e => { if(!e.target.closest('.node-card')) closePanel(); });
  svg.addEventListener('wheel', e => {
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const f = e.deltaY < 0 ? 1.12 : 1/1.12;
    const nk = Math.max(0.12, Math.min(3, ui.tree.k * f));
    ui.tree.x = mx - (mx - ui.tree.x) * (nk/ui.tree.k);
    ui.tree.y = my - (my - ui.tree.y) * (nk/ui.tree.k);
    ui.tree.k = nk;
    applyTreeTransform();
  }, { passive:false });

  /* network controls */
  $('#netShowFamily').addEventListener('change', e => { ui.net.showFamily = e.target.checked; renderNetwork(); });
  $('#netShowLabels').addEventListener('change', e => { ui.net.showLabels = e.target.checked; drawNetworkRefresh(); });
  $('#netReheat').addEventListener('click', () => { netNodes = []; renderNetwork(); });
  $('#netSvg').addEventListener('click', e => { if(!e.target.closest('.net-node')) closePanel(); });

  /* gallery */
  $('#galleryFilter').addEventListener('change', e => { ui.gallery.filter = e.target.value; renderGallery(); });

  /* lightbox */
  $('#lbClose').addEventListener('click', () => $('#lightbox').classList.add('hidden'));
  $('#lbPrev').addEventListener('click',  () => stepLightbox(-1));
  $('#lbNext').addEventListener('click',  () => stepLightbox(1));
  $('#lightbox').addEventListener('click', e => { if(e.target.id === 'lightbox') $('#lightbox').classList.add('hidden'); });

  /* keyboard */
  document.addEventListener('keydown', e => {
    const lbOpen = !$('#lightbox').classList.contains('hidden');
    if(e.key === 'Escape'){
      if(lbOpen) return $('#lightbox').classList.add('hidden');
      if(!$('#modalBackdrop').classList.contains('hidden')) return hideModal();
      closePanel();
    }
    if(lbOpen && e.key === 'ArrowLeft')  stepLightbox(-1);
    if(lbOpen && e.key === 'ArrowRight') stepLightbox(1);
    if(e.key === '/' && document.activeElement !== $('#search')){
      e.preventDefault(); $('#search').focus();
    }
  });

  /* resize */
  let rt;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => { if(ui.view === 'network') renderNetwork(); }, 180);
  });
}

/* ------------------------------------------------------------------ *
 * 17. Boot
 * ------------------------------------------------------------------ */
function init(){
  load();
  wire();
  renderLegend();
  setView('tree');
  if(state.people.length) fitTree();
}

document.addEventListener('DOMContentLoaded', init);

/* public surface used by inline onclick handlers in index.html */
return { openPersonEditor, loadSample, selectPerson, setView, exportJSON, importJSON };

})();

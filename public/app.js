/* Raitu Raksha front end - plain JS, no framework. */
const $ = s => document.querySelector(s);
const view = $('#view');
let session = JSON.parse(localStorage.getItem('raitu_session') || 'null');
let crops = [];

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cap = s => (s || '').charAt(0).toUpperCase() + (s || '').slice(1);
const fmtDate = d => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
const fmtKg = n => (n >= 100 ? Math.round(n) : Math.round(n * 10) / 10) + ' kg';

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

async function api(url, method = 'GET', body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: 'Bearer ' + session.token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && session) { logout(); throw new Error(data.error); }
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

function logout() {
  session = null; localStorage.removeItem('raitu_session');
  location.hash = '#/login'; route();
}
$('#logout').onclick = logout;

/* ---------- routing ---------- */
const farmerNav = [['#/new', 'New recommendation'], ['#/history', 'My history'], ['#/guide', 'Crop guide']];
const adminNav = [['#/admin', 'Knowledge base'], ['#/feedback', 'Feedback'], ['#/guide', 'Crop guide']];

async function route() {
  const hash = location.hash || '#/new';
  const bar = $('#topbar');
  if (!session) { bar.classList.add('hidden'); return hash === '#/register' ? registerView() : loginView(); }

  bar.classList.remove('hidden');
  $('#whoami').textContent = session.user.name + (session.user.role === 'agronomist' ? ' (agronomist)' : '');
  const isAdmin = session.user.role === 'agronomist';
  const items = isAdmin ? adminNav : farmerNav;
  $('#nav').innerHTML = items.map(([h, t]) => `<a href="${h}" class="${hash.startsWith(h) ? 'on' : ''}">${t}</a>`).join('');

  try {
    if (!crops.length) crops = await api('/api/crops');
    if (hash.startsWith('#/rec/')) return recView(hash.split('/')[2]);
    if (hash === '#/history' && !isAdmin) return historyView();
    if (hash === '#/guide') return guideView();
    if (hash === '#/feedback' && isAdmin) return feedbackView();
    if (hash.startsWith('#/admin') && isAdmin) return adminView();
    return isAdmin ? adminView() : newView();
  } catch (e) { view.innerHTML = `<div class="card err">${esc(e.message)}</div>`; }
}
window.addEventListener('hashchange', route);

/* ---------- login / register ---------- */
function loginView() {
  view.innerHTML = `
  <div class="auth card">
    <h1>Raitu Raksha</h1><div class="te">రైతు రక్ష</div>
    <p class="sub">Fertilizer recommendations from your soil test.</p>
    <form id="f">
      <label>Email</label><input name="email" type="email" required>
      <div style="height:10px"></div>
      <label>Password</label><input name="password" type="password" required>
      <div class="err" id="err"></div>
      <div class="actions"><button>Log in</button><a class="btn alt" href="#/register">Create account</a></div>
    </form>
  </div>`;
  $('#f').onsubmit = async e => {
    e.preventDefault();
    try { await startSession('/api/auth/login', Object.fromEntries(new FormData(e.target))); }
    catch (er) { $('#err').textContent = er.message; }
  };
}

function registerView() {
  view.innerHTML = `
  <div class="auth card">
    <h1>Register</h1>
    <p class="sub">Farmer account</p>
    <form id="f">
      <label>Full name</label><input name="name" required>
      <div style="height:10px"></div>
      <label>Email</label><input name="email" type="email" required>
      <div style="height:10px"></div>
      <label>Password <small>(min 6 characters)</small></label><input name="password" type="password" minlength="6" required>
      <div style="height:10px"></div>
      <label>Phone</label><input name="phone" inputmode="numeric" maxlength="10">
      <div style="height:10px"></div>
      <label>Village / district</label><input name="location">
      <div class="err" id="err"></div>
      <div class="actions"><button>Register</button><a class="btn alt" href="#/login">Back to login</a></div>
    </form>
  </div>`;
  $('#f').onsubmit = async e => {
    e.preventDefault();
    try { await startSession('/api/auth/register', Object.fromEntries(new FormData(e.target))); }
    catch (er) { $('#err').textContent = er.message; }
  };
}

async function startSession(url, body) {
  const d = await api(url, 'POST', body);
  session = d; localStorage.setItem('raitu_session', JSON.stringify(d));
  location.hash = d.user.role === 'agronomist' ? '#/admin' : '#/new';
  route();
}

/* ---------- new recommendation ---------- */
function newView() {
  const soilField = (k, label, tip) => `
    <div><label>${label} <span class="tip" title="${tip}">?</span></label>
      <select name="${k}" class="lvl"><option value="">Not known</option><option>low</option><option>medium</option><option>high</option></select>
      <input name="${k}n" class="val hidden" type="number" min="0" step="any" placeholder="kg/ha"></div>`;

  view.innerHTML = `
  <h1>New recommendation</h1>
  <p class="sub">Fill the three steps below. Only crop, stage and area are compulsory, but more soil details give a better result.</p>
  <form id="f">
    <div class="card">
      <div class="step-head"><span class="step-no">1</span><h2>Crop and field</h2></div>
      <div class="grid">
        <div><label>Crop</label>
          <select name="cropId" required><option value="">Select crop</option>${crops.map(c => `<option value="${c.cropId}">${cap(c.cropName)}</option>`).join('')}</select></div>
        <div><label>Growth stage <span class="tip" title="Sowing = basal dose at sowing/transplanting. Vegetative = tillering or branching. Flowering = flower or panicle initiation. Fruiting = fruit, boll or grain set.">?</span></label>
          <select name="stage" required><option value="">Select stage</option><option value="sowing">Sowing</option><option value="vegetative">Vegetative</option><option value="flowering">Flowering</option><option value="fruiting">Fruiting</option></select></div>
        <div><label>Area</label><input name="area" type="number" min="0.001" step="any" required></div>
        <div><label>Unit</label>
          <select name="areaUnit"><option value="acre">Acre</option><option value="hectare">Hectare</option><option value="guntha">Guntha</option><option value="cent">Cent</option><option value="sqm">Square metre</option></select></div>
      </div>
      <div class="help" id="cropHelp"></div>
    </div>

    <div class="card">
      <div class="step-head"><span class="step-no">2</span><h2>Soil test result</h2></div>
      <p class="help" style="margin-top:0">Take the values from your Soil Health Card. If you do not have the numbers, pick low / medium / high instead.</p>
      <label style="font-weight:400"><input type="checkbox" id="numeric" style="width:auto"> I have lab values in kg/ha</label>
      <div style="height:12px"></div>
      <div class="grid">
        <div><label>Soil pH <span class="tip" title="Acidity of the soil. 6.5 to 7.5 suits most crops. Below 5.5 is acidic, above 8.5 is alkaline.">?</span></label>
          <input name="ph" type="number" min="3" max="10" step="0.1" placeholder="e.g. 6.8"></div>
        ${soilField('n', 'Nitrogen (N)', 'Available nitrogen. Low below 280, high above 560 kg/ha.')}
        ${soilField('p', 'Phosphorus (P)', 'Available phosphorus. Low below 11, high above 25 kg/ha.')}
        ${soilField('k', 'Potassium (K)', 'Available potassium. Low below 110, high above 280 kg/ha.')}
      </div>
    </div>

    <div class="card">
      <div class="step-head"><span class="step-no">3</span><h2>Get recommendation</h2></div>
      <button>Calculate</button>
      <div class="err" id="err"></div>
    </div>
  </form>`;

  const f = $('#f');
  f.cropId.onchange = () => {
    const c = crops.find(x => x.cropId == f.cropId.value);
    $('#cropHelp').textContent = c ? `Standard dose for ${c.cropName}: ${c.n} N : ${c.p} P2O5 : ${c.k} K2O kg/ha. ${c.notes || ''}` : '';
  };
  $('#numeric').onchange = e => {
    document.querySelectorAll('.lvl').forEach(x => x.classList.toggle('hidden', e.target.checked));
    document.querySelectorAll('.val').forEach(x => x.classList.toggle('hidden', !e.target.checked));
  };
  f.onsubmit = async e => {
    e.preventDefault();
    const num = $('#numeric').checked;
    const pick = k => (num ? f[k + 'n'].value : f[k].value);
    try {
      const r = await api('/api/recommendations/request', 'POST', {
        cropId: f.cropId.value, stage: f.stage.value, area: f.area.value, areaUnit: f.areaUnit.value,
        soil: { ph: f.ph.value, n: pick('n'), p: pick('p'), k: pick('k') }
      });
      location.hash = '#/rec/' + r.recId;
    } catch (er) { $('#err').textContent = er.message; }
  };
}

/* ---------- result page (also the print view) ---------- */
async function recView(id) {
  const r = await api('/api/recommendations/' + id);
  const lvl = v => v ? `<span class="pill ${v}">${v}</span>` : '<span class="help">not given</span>';
  const rows = r.items.map(i => `
    <tr>
      <td><b>${esc(i.fertilizer)}</b><div class="help">${esc(i.composition)} (N-P2O5-K2O %)</div></td>
      <td class="num">${fmtKg(i.quantityPerHa)}</td>
      <td class="num"><b>${fmtKg(i.quantityForArea)}</b></td>
      <td>${esc(i.timing)}</td>
      <td>${i.precautions.map(p => `<div>${esc(p)}</div>`).join('') || '<span class="help">none</span>'}<div class="help">${esc(i.howToApply || '')}</div></td>
    </tr>`).join('');

  view.innerHTML = `
  <h1>Fertilizer recommendation #${r.recId}</h1>
  <p class="sub">Generated on ${fmtDate(r.generatedAt)} for ${esc(r.farmer)}${r.location ? ', ' + esc(r.location) : ''}</p>
  <div class="card">
    <div class="meta">
      <span><b>Crop</b> ${cap(esc(r.crop))}</span>
      <span><b>Stage</b> ${cap(esc(r.stage))}</span>
      <span><b>Area</b> ${esc(r.areaInput)} (${r.areaHa} ha)</span>
    </div>
    <div class="meta">
      <span><b>pH</b> ${r.soil.ph ?? '<span class="help">not given</span>'}</span>
      <span><b>N</b> ${lvl(r.soil.n)}</span><span><b>P</b> ${lvl(r.soil.p)}</span><span><b>K</b> ${lvl(r.soil.k)}</span>
    </div>
    ${r.items.length ? `<div class="scroll"><table>
      <thead><tr><th>Fertilizer</th><th>Per hectare</th><th>For your area</th><th>Application timing</th><th>Precautions</th></tr></thead>
      <tbody>${rows}</tbody></table></div>` : ''}
    ${r.remarks.map(m => `<div class="notice">${esc(m)}</div>`).join('')}
    <div class="actions">
      <button id="save" ${r.saved ? 'disabled' : ''}>${r.saved ? 'Saved' : 'Save'}</button>
      <button class="alt" onclick="window.print()">Print / save as PDF</button>
      <button class="alt" id="csv">Download CSV</button>
      <a class="btn alt" href="#/new">New request</a>
    </div>
  </div>
  <div class="card noprint">
    <h2>Was this useful?</h2>
    <form id="fb">
      <div class="rating">${[1, 2, 3, 4, 5].map(n => `<label><input type="radio" name="rating" value="${n}" ${r.feedback && r.feedback.rating == n ? 'checked' : ''}>${n}</label>`).join('')}</div>
      <div class="help">1 = not useful, 5 = very useful</div>
      <div style="height:8px"></div>
      <textarea name="comments" rows="2" maxlength="500" placeholder="Anything we got wrong? Local practice, crop variety, previous crop...">${esc(r.feedback?.comments)}</textarea>
      <div class="actions"><button class="alt">Send feedback</button></div>
    </form>
  </div>`;

  $('#save').onclick = async () => { await api(`/api/recommendations/${id}/save`, 'POST'); toast('Saved to your history'); $('#save').textContent = 'Saved'; $('#save').disabled = true; };
  $('#csv').onclick = () => {
    const q = v => '"' + String(v).replace(/"/g, '""') + '"';
    const lines = [['Fertilizer', 'Per hectare (kg)', 'For ' + r.areaInput + ' (kg)', 'Timing', 'Precautions'].map(q).join(',')]
      .concat(r.items.map(i => [i.fertilizer, i.quantityPerHa, i.quantityForArea, i.timing, i.precautions.join(' ')].map(q).join(',')));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    a.download = `recommendation-${r.recId}.csv`; a.click();
  };
  $('#fb').onsubmit = async e => {
    e.preventDefault();
    const rating = e.target.rating.value;
    if (!rating) return toast('Pick a rating first');
    try { await api(`/api/recommendations/${id}/feedback`, 'POST', { rating, comments: e.target.comments.value }); toast('Thanks for the feedback'); }
    catch (er) { toast(er.message); }
  };
}

/* ---------- history ---------- */
async function historyView() {
  const rows = await api('/api/recommendations/user/' + session.user.id);
  view.innerHTML = `<h1>My history</h1><p class="sub">Every recommendation you generated.</p>
  <div class="card scroll">${rows.length ? `<table><thead><tr><th>#</th><th>Date</th><th>Crop</th><th>Stage</th><th>Area</th><th></th></tr></thead><tbody>
    ${rows.map(r => `<tr><td>${r.recId}</td><td>${fmtDate(r.generatedAt)}</td><td>${cap(esc(r.crop))}</td><td>${cap(r.stage)}</td><td>${esc(r.area)}</td>
    <td>${r.saved ? '<span class="pill">saved</span> ' : ''}<a href="#/rec/${r.recId}">Open</a></td></tr>`).join('')}</tbody></table>`
    : '<p>Nothing here yet. <a href="#/new">Make your first recommendation</a>.</p>'}</div>`;
}

/* ---------- crop guide (read-only knowledge base) ---------- */
async function guideView() {
  const kb = await api('/api/kb');
  view.innerHTML = `<h1>Crop guide</h1><p class="sub">Standard doses the rules are built on. Soil test results raise or lower these.</p>
  <div class="card scroll"><h2>Crops</h2><table><thead><tr><th>Crop</th><th>N</th><th>P2O5</th><th>K2O</th><th>Notes</th></tr></thead><tbody>
    ${kb.crops.map(c => `<tr><td><b>${cap(esc(c.crop_name))}</b></td><td>${c.typical_n}</td><td>${c.typical_p}</td><td>${c.typical_k}</td><td>${esc(c.notes)}</td></tr>`).join('')}</tbody></table>
    <div class="help">Nutrient doses in kg per hectare.</div></div>
  <div class="card scroll"><h2>Fertilizers</h2><table><thead><tr><th>Name</th><th>N-P-K %</th><th>Type</th><th>How to use</th></tr></thead><tbody>
    ${kb.fertilizers.map(f => `<tr><td><b>${esc(f.name)}</b></td><td>${+f.n_pct}-${+f.p_pct}-${+f.k_pct}</td><td>${esc(f.type)}</td><td>${esc(f.instructions)}</td></tr>`).join('')}</tbody></table></div>`;
}

/* ---------- agronomist: knowledge base ---------- */
let adminTab = 'rules', ruleFilter = '';

async function adminView() {
  const kb = await api('/api/kb');
  const tabs = [['rules', 'Rules'], ['crops', 'Crops'], ['ferts', 'Fertilizers']];
  view.innerHTML = `<h1>Knowledge base</h1><p class="sub">${kb.rules.length} rules, ${kb.crops.length} crops, ${kb.fertilizers.length} fertilizers. Changes apply to the next recommendation immediately.</p>
  <div class="tabs">${tabs.map(([k, t]) => `<a data-t="${k}" class="${adminTab === k ? 'on' : ''}">${t}</a>`).join('')}</div><div id="tab"></div>`;
  document.querySelectorAll('.tabs a').forEach(a => a.onclick = () => { adminTab = a.dataset.t; adminView(); });
  ({ rules: rulesTab, crops: cropsTab, ferts: fertTab })[adminTab](kb);
}

const opt = (list, val, any) => (any ? `<option value="">${any}</option>` : '') + list.map(([v, t]) => `<option value="${v}" ${String(v) === String(val ?? '') ? 'selected' : ''}>${t}</option>`).join('');
const lvls = [['low', 'low'], ['medium', 'medium'], ['high', 'high']];
const stagesL = [['sowing', 'sowing'], ['vegetative', 'vegetative'], ['flowering', 'flowering'], ['fruiting', 'fruiting']];

function rulesTab(kb, edit = null) {
  const e = edit || {};
  const list = kb.rules.filter(r => !ruleFilter || (ruleFilter === 'all' ? !r.crop_id : r.crop_id == ruleFilter));
  $('#tab').innerHTML = `
  <div class="card">
    <h2>${edit ? 'Edit rule #' + e.rule_id : 'Add rule'}</h2>
    <form id="rf"><div class="grid">
      <div><label>Crop</label><select name="cropId">${opt(kb.crops.map(c => [c.crop_id, cap(c.crop_name)]), e.crop_id, 'All crops')}</select></div>
      <div><label>Growth stage</label><select name="stage">${opt(stagesL, e.growth_stage, 'Any stage')}</select></div>
      <div><label>N level</label><select name="nLevel">${opt(lvls, e.n_level, 'Any')}</select></div>
      <div><label>P level</label><select name="pLevel">${opt(lvls, e.p_level, 'Any')}</select></div>
      <div><label>K level</label><select name="kLevel">${opt(lvls, e.k_level, 'Any')}</select></div>
      <div><label>pH from <small>(&ge;)</small></label><input name="phMin" type="number" step="0.1" value="${e.ph_min ?? ''}"></div>
      <div><label>pH below <small>(&lt;)</small></label><input name="phMax" type="number" step="0.1" value="${e.ph_max ?? ''}"></div>
      <div><label>Fertilizer</label><select name="fertilizerId" required>${opt(kb.fertilizers.map(f => [f.fertilizer_id, f.name]), e.fertilizer_id)}</select></div>
      <div><label>Quantity (kg/ha)</label><input name="quantityPerHa" type="number" step="any" min="0" value="${e.quantity_per_ha ?? ''}" required></div>
    </div>
    <div style="height:12px"></div>
    <label>Application timing</label><input name="timing" value="${esc(e.timing)}" required>
    <div style="height:10px"></div>
    <label>Precaution <small>(optional)</small></label><input name="precaution" value="${esc(e.precaution)}">
    <div class="err" id="err"></div>
    <div class="actions"><button>${edit ? 'Update rule' : 'Add rule'}</button>${edit ? '<button type="button" class="alt" id="cancel">Cancel</button>' : ''}</div>
    </form>
  </div>
  <div class="card scroll">
    <div style="display:flex;gap:12px;align-items:center;margin-bottom:10px"><h2 style="margin:0">Rules</h2>
      <select id="flt" style="width:auto"><option value="">All rules</option><option value="all" ${ruleFilter === 'all' ? 'selected' : ''}>Applies to every crop</option>
        ${kb.crops.map(c => `<option value="${c.crop_id}" ${ruleFilter == c.crop_id ? 'selected' : ''}>${cap(c.crop_name)}</option>`).join('')}</select></div>
    <table><thead><tr><th>#</th><th>Crop</th><th>Stage</th><th>Condition</th><th>Fertilizer</th><th>kg/ha</th><th>Timing</th><th></th></tr></thead><tbody>
    ${list.map(r => `<tr><td>${r.rule_id}</td><td>${r.crop_name ? cap(esc(r.crop_name)) : 'All'}</td><td>${r.growth_stage || 'any'}</td>
      <td>${[r.n_level && 'N ' + r.n_level, r.p_level && 'P ' + r.p_level, r.k_level && 'K ' + r.k_level,
        r.ph_min != null && 'pH \u2265 ' + +r.ph_min, r.ph_max != null && 'pH < ' + +r.ph_max].filter(Boolean).join(', ') || 'always'}</td>
      <td>${esc(r.fertilizer_name)}</td><td class="num">${+r.quantity_per_ha}</td><td>${esc(r.timing)}</td>
      <td class="num"><button class="alt small" data-e="${r.rule_id}">Edit</button> <button class="danger small" data-d="${r.rule_id}">Delete</button></td></tr>`).join('')}
    </tbody></table></div>`;

  $('#flt').onchange = ev => { ruleFilter = ev.target.value; rulesTab(kb); };
  document.querySelectorAll('[data-e]').forEach(b => b.onclick = () => { rulesTab(kb, kb.rules.find(r => r.rule_id == b.dataset.e)); window.scrollTo(0, 0); });
  document.querySelectorAll('[data-d]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete rule #' + b.dataset.d + '?')) return;
    await api('/api/admin/rules/' + b.dataset.d, 'DELETE'); toast('Rule deleted'); adminView();
  });
  if (edit) $('#cancel').onclick = () => rulesTab(kb);
  $('#rf').onsubmit = async ev => {
    ev.preventDefault();
    const body = Object.fromEntries(new FormData(ev.target)); if (edit) body.ruleId = e.rule_id;
    try { await api('/api/admin/rules', edit ? 'PUT' : 'POST', body); toast(edit ? 'Rule updated' : 'Rule added'); adminView(); }
    catch (er) { $('#err').textContent = er.message; }
  };
}

function cropsTab(kb, edit = null) {
  const e = edit || {};
  $('#tab').innerHTML = `
  <div class="card"><h2>${edit ? 'Edit ' + cap(e.crop_name) : 'Add crop'}</h2>
    <form id="cf"><div class="grid">
      <div><label>Crop name</label><input name="cropName" value="${esc(e.crop_name)}" required></div>
      <div><label>N <small>kg/ha</small></label><input name="n" type="number" min="0" value="${e.typical_n ?? ''}" required></div>
      <div><label>P2O5 <small>kg/ha</small></label><input name="p" type="number" min="0" value="${e.typical_p ?? ''}" required></div>
      <div><label>K2O <small>kg/ha</small></label><input name="k" type="number" min="0" value="${e.typical_k ?? ''}" required></div>
    </div><div style="height:10px"></div><label>Notes</label><input name="notes" value="${esc(e.notes)}">
    <div class="err" id="err"></div>
    <div class="actions"><button>${edit ? 'Update crop' : 'Add crop'}</button>${edit ? '<button type="button" class="alt" id="cancel">Cancel</button>' : ''}</div></form></div>
  <div class="card scroll"><table><thead><tr><th>Crop</th><th>N</th><th>P2O5</th><th>K2O</th><th>Rules</th><th></th></tr></thead><tbody>
  ${kb.crops.map(c => `<tr><td><b>${cap(esc(c.crop_name))}</b></td><td>${c.typical_n}</td><td>${c.typical_p}</td><td>${c.typical_k}</td>
    <td>${kb.rules.filter(r => r.crop_id === c.crop_id).length}</td><td class="num"><button class="alt small" data-e="${c.crop_id}">Edit</button></td></tr>`).join('')}</tbody></table></div>`;
  document.querySelectorAll('[data-e]').forEach(b => b.onclick = () => cropsTab(kb, kb.crops.find(c => c.crop_id == b.dataset.e)));
  if (edit) $('#cancel').onclick = () => cropsTab(kb);
  $('#cf').onsubmit = async ev => {
    ev.preventDefault();
    const body = Object.fromEntries(new FormData(ev.target)); if (edit) body.cropId = e.crop_id;
    try { await api('/api/admin/crops', edit ? 'PUT' : 'POST', body); crops = []; toast('Crop saved'); adminView(); }
    catch (er) { $('#err').textContent = er.message; }
  };
}

function fertTab(kb, edit = null) {
  const e = edit || {};
  $('#tab').innerHTML = `
  <div class="card"><h2>${edit ? 'Edit ' + esc(e.name) : 'Add fertilizer'}</h2>
    <form id="ff"><div class="grid">
      <div><label>Name</label><input name="name" value="${esc(e.name)}" required></div>
      <div><label>N %</label><input name="n" type="number" step="any" min="0" value="${e.n_pct ?? 0}"></div>
      <div><label>P2O5 %</label><input name="p" type="number" step="any" min="0" value="${e.p_pct ?? 0}"></div>
      <div><label>K2O %</label><input name="k" type="number" step="any" min="0" value="${e.k_pct ?? 0}"></div>
      <div><label>Type</label><select name="type">${opt(['Straight', 'Complex', 'Organic', 'Amendment', 'Micronutrient'].map(t => [t, t]), e.type)}</select></div>
    </div><div style="height:10px"></div><label>Application instructions</label><input name="instructions" value="${esc(e.instructions)}">
    <div class="err" id="err"></div>
    <div class="actions"><button>${edit ? 'Update' : 'Add fertilizer'}</button>${edit ? '<button type="button" class="alt" id="cancel">Cancel</button>' : ''}</div></form></div>
  <div class="card scroll"><table><thead><tr><th>Name</th><th>N-P-K %</th><th>Type</th><th></th></tr></thead><tbody>
  ${kb.fertilizers.map(f => `<tr><td><b>${esc(f.name)}</b></td><td>${+f.n_pct}-${+f.p_pct}-${+f.k_pct}</td><td>${f.type}</td><td class="num"><button class="alt small" data-e="${f.fertilizer_id}">Edit</button></td></tr>`).join('')}</tbody></table></div>`;
  document.querySelectorAll('[data-e]').forEach(b => b.onclick = () => fertTab(kb, kb.fertilizers.find(f => f.fertilizer_id == b.dataset.e)));
  if (edit) $('#cancel').onclick = () => fertTab(kb);
  $('#ff').onsubmit = async ev => {
    ev.preventDefault();
    const body = Object.fromEntries(new FormData(ev.target)); if (edit) body.fertilizerId = e.fertilizer_id;
    try { await api('/api/admin/fertilizers', edit ? 'PUT' : 'POST', body); toast('Fertilizer saved'); adminView(); }
    catch (er) { $('#err').textContent = er.message; }
  };
}

/* ---------- agronomist: feedback ---------- */
async function feedbackView() {
  const { feedback, byCrop } = await api('/api/admin/feedback');
  view.innerHTML = `<h1>Farmer feedback</h1><p class="sub">Low ratings point to rules that need a second look.</p>
  <div class="card scroll"><h2>Average rating by crop</h2>
    ${byCrop.length ? `<table><thead><tr><th>Crop</th><th>Average (out of 5)</th><th>Responses</th></tr></thead><tbody>
    ${byCrop.map(b => `<tr><td>${cap(esc(b.crop))}</td><td>${b.avgRating}</td><td>${b.responses}</td></tr>`).join('')}</tbody></table>` : '<p>No feedback yet.</p>'}</div>
  <div class="card scroll"><h2>All responses</h2>
    ${feedback.length ? `<table><thead><tr><th>Date</th><th>Farmer</th><th>Crop / stage</th><th>Rating</th><th>Comment</th></tr></thead><tbody>
    ${feedback.map(f => `<tr><td>${fmtDate(f.createdAt)}</td><td>${esc(f.farmer)}</td><td>${cap(esc(f.crop))} / ${f.stage}</td>
      <td><span class="pill ${f.rating <= 2 ? 'low' : ''}">${f.rating}</span></td><td>${esc(f.comments)}</td></tr>`).join('')}</tbody></table>` : '<p>Nothing yet.</p>'}</div>`;
}

route();

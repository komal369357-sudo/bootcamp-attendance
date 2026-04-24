// ── State ─────────────────────────────────────────────────────
let TOKEN = localStorage.getItem('bt_token') || '';
let allParts = [];

// ── API ───────────────────────────────────────────────────────
async function api(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch('/api' + path, opts);
  const data = await res.json();
  if (res.status === 401 || res.status === 403) { doLogout(); throw new Error('Session expired'); }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ── Init ──────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  if (TOKEN) verifyToken();
});

async function verifyToken() {
  try {
    const r = await fetch('/api/auth/verify', { headers: { 'Authorization': 'Bearer ' + TOKEN } });
    if (r.ok) showApp();
    else doLogout();
  } catch { doLogout(); }
}

// ── Login ─────────────────────────────────────────────────────
document.getElementById('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const username = document.getElementById('adminUser').value.trim();
  const password = document.getElementById('adminPass').value;
  const errEl = document.getElementById('loginErr');
  const btn   = document.getElementById('loginBtn');

  errEl.classList.add('hidden');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Logging in…';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error);
    TOKEN = d.token;
    localStorage.setItem('bt_token', TOKEN);
    showApp();
  } catch(err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
    btn.disabled = false;
    btn.innerHTML = 'Login';
  }
});

function showApp() {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('adminApp').classList.remove('hidden');
  loadDashboard();
}

function doLogout() {
  TOKEN = '';
  localStorage.removeItem('bt_token');
  document.getElementById('adminApp').classList.add('hidden');
  document.getElementById('loginScreen').classList.remove('hidden');
}

// ── Tab Nav ───────────────────────────────────────────────────
document.querySelectorAll('[data-atab]').forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();
    const tab = link.dataset.atab;
    document.querySelectorAll('[data-atab]').forEach(l => l.classList.remove('active'));
    document.querySelectorAll('.atab').forEach(t => { t.classList.remove('active'); t.classList.add('hidden'); });
    link.classList.add('active');
    const el = document.getElementById('atab-' + tab);
    el.classList.remove('hidden');
    el.classList.add('active');
    if (tab === 'dashboard')    loadDashboard();
    if (tab === 'participants') loadParticipants();
    if (tab === 'attendance')   { loadAttView(); loadSummary(); }
    if (tab === 'mark')         { loadAllForMark(); }
  });
});

// ── Helpers ───────────────────────────────────────────────────
function fmtDate(s) {
  if (!s) return '—';
  return new Date(s).toLocaleString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
}
function setMsg(id, html, type) {
  const el = document.getElementById(id);
  el.innerHTML = html;
  el.className = 'msg msg-' + type;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 6000);
}

// ── Dashboard ─────────────────────────────────────────────────
async function loadDashboard() {
  try {
    const d = await api('/admin/dashboard');
    document.getElementById('dTotal').textContent   = d.totalParticipants;
    document.getElementById('dRecords').textContent = d.totalAttendance;

    // Use day stats for today approximation
    const maxDay = d.dayStats.reduce((best, ds) =>
      (ds.morning + ds.afternoon > best.morning + best.afternoon) ? ds : best, { morning: 0, afternoon: 0 });
    document.getElementById('dMorning').textContent   = maxDay.morning;
    document.getElementById('dAfternoon').textContent = maxDay.afternoon;

    // Chart
    const maxVal = Math.max(...d.dayStats.flatMap(ds => [ds.morning, ds.afternoon]), 1);
    document.getElementById('dayChart').innerHTML = d.dayStats.map(ds => `
      <div class="bar-row">
        <span class="bar-label">D${ds.day}</span>
        <div class="bar-track">
          <div class="bar-m" style="width:${(ds.morning / maxVal) * 50}%" title="Morning: ${ds.morning}"></div>
          <div class="bar-a" style="width:${(ds.afternoon / maxVal) * 50}%" title="Afternoon: ${ds.afternoon}"></div>
        </div>
        <span class="bar-count">☀️${ds.morning} 🌆${ds.afternoon}</span>
      </div>`).join('');

    // Recent registrations
    document.getElementById('recentRegs').innerHTML = d.recentRegistrations.length
      ? d.recentRegistrations.map(p => `
        <div class="recent-item">
          <div class="avatar">${p.full_name.charAt(0).toUpperCase()}</div>
          <div><div class="recent-name">${p.full_name}</div>
               <div class="recent-sub">${p.college || 'No college'} · ${p.phone}</div></div>
        </div>`).join('')
      : '<p style="color:var(--g400);font-size:14px">No registrations yet.</p>';

    // Day export buttons
    document.getElementById('dayExportBtns').innerHTML =
      [1,2,3,4,5,6].map(d => `
        <button class="btn btn-secondary btn-sm" onclick="exportDay(${d},'morning')">D${d} ☀️</button>
        <button class="btn btn-secondary btn-sm" onclick="exportDay(${d},'afternoon')">D${d} 🌆</button>
      `).join('');
  } catch(err) { console.error(err); }
}

// ── Participants ──────────────────────────────────────────────
async function loadParticipants() {
  try {
    const d = await api('/register');
    allParts = d.participants;
    renderParts(allParts);
    document.getElementById('pCount').textContent = allParts.length;
  } catch(err) {
    document.getElementById('pTbody').innerHTML = '<tr><td colspan="7" class="empty-cell">Error loading data.</td></tr>';
  }
}

function renderParts(list) {
  if (!list.length) {
    document.getElementById('pTbody').innerHTML = '<tr><td colspan="7" class="empty-cell">No participants found.</td></tr>';
    return;
  }
  document.getElementById('pTbody').innerHTML = list.map((p, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><strong>${p.full_name}</strong></td>
      <td>${p.phone}</td>
      <td>${p.email || '—'}</td>
      <td>${p.college || '—'}</td>
      <td style="font-size:12px;color:var(--g500)">${fmtDate(p.registered_at)}</td>
      <td style="display:flex;gap:6px">
        <button class="btn btn-secondary btn-sm" onclick="viewPart(${p.id})">View</button>
        <button class="btn btn-danger btn-sm" onclick="deletePart(${p.id},'${p.full_name.replace(/'/g,"\\'")}')">Del</button>
      </td>
    </tr>`).join('');
}

function filterParticipants() {
  const q = document.getElementById('pSearch').value.toLowerCase();
  renderParts(allParts.filter(p =>
    p.full_name.toLowerCase().includes(q) ||
    p.phone.includes(q) ||
    (p.college || '').toLowerCase().includes(q) ||
    (p.email || '').toLowerCase().includes(q)
  ));
}

async function viewPart(id) {
  try {
    const d = await api('/register/' + id);
    const p = d.participant;
    let rows = d.attendance.map(a =>
      `<tr><td>Day ${a.day}</td><td style="text-transform:capitalize">${a.session}</td><td style="font-size:12px;color:var(--g500)">${fmtDate(a.marked_at)}</td><td style="font-size:12px;color:var(--g400)">${a.marked_by}</td></tr>`
    ).join('') || '<tr><td colspan="4" class="empty-cell">No attendance records yet.</td></tr>';

    const pct = Math.round((d.attendance.length / 12) * 100);
    const pc = pct >= 75 ? 'pct-high' : pct >= 50 ? 'pct-mid' : 'pct-low';
    document.getElementById('modalTitle').textContent = p.full_name;
    document.getElementById('modalBody').innerHTML = `
      <p class="subtitle" style="margin-bottom:16px">${p.college || 'No college'} · ${p.phone}${p.email ? ' · ' + p.email : ''}</p>
      <p style="font-size:14px;margin-bottom:14px">Sessions: <strong>${d.attendance.length}/12</strong> &nbsp;·&nbsp; Attendance: <span class="${pc}">${pct}%</span></p>
      <table class="dtable">
        <thead><tr><th>Day</th><th>Session</th><th>Marked At</th><th>By</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    document.getElementById('modal').classList.remove('hidden');
  } catch(err) { alert('Error: ' + err.message); }
}

function closeModal() { document.getElementById('modal').classList.add('hidden'); }

async function deletePart(id, name) {
  if (!confirm(`Delete "${name}" and all their attendance records?`)) return;
  try {
    await api('/register/' + id, 'DELETE');
    loadParticipants();
    setMsg('markMsg', '✅ ' + name + ' deleted.', 'success');
  } catch(err) { alert('Error: ' + err.message); }
}

// ── Attendance View ───────────────────────────────────────────
async function loadAttView() {
  const day = document.getElementById('dayFilter').value;
  try {
    const d = await api('/attendance/day/' + day);
    document.getElementById('attTbody').innerHTML = !d.records.length
      ? '<tr><td colspan="6" class="empty-cell">No participants.</td></tr>'
      : d.records.map((r, i) => `
        <tr>
          <td>${i + 1}</td>
          <td><strong>${r.full_name}</strong></td>
          <td>${r.phone}</td>
          <td>${r.college || '—'}</td>
          <td class="tc">${r.morning ? '<span class="att-yes">✅</span>' : '<span class="att-no">❌</span>'}</td>
          <td class="tc">${r.afternoon ? '<span class="att-yes">✅</span>' : '<span class="att-no">❌</span>'}</td>
        </tr>`).join('');
  } catch(err) { console.error(err); }
}

async function loadSummary() {
  try {
    const d = await api('/attendance/summary');

    // Build header
    let hdr = '<tr><th>#</th><th>Name</th><th>College</th>';
    for (let i = 1; i <= 6; i++) hdr += `<th class="tc" colspan="2">Day ${i}</th>`;
    hdr += '<th class="tc">Total</th><th class="tc">%</th></tr>';
    hdr += '<tr><th></th><th></th><th></th>';
    for (let i = 0; i < 6; i++) hdr += '<th style="text-align:center;font-size:11px;background:var(--g50)">☀️</th><th style="text-align:center;font-size:11px;background:var(--g50)">🌆</th>';
    hdr += '<th></th><th></th></tr>';
    document.getElementById('summaryHead').innerHTML = hdr;

    document.getElementById('summaryBody').innerHTML = !d.summary.length
      ? '<tr><td colspan="17" class="empty-cell">No data.</td></tr>'
      : d.summary.map((p, i) => {
          let cells = '';
          for (let day = 1; day <= 6; day++) {
            const dd = p.days[String(day)];
            cells += `<td class="tc">${dd.morning ? '✅' : '❌'}</td><td class="tc">${dd.afternoon ? '✅' : '❌'}</td>`;
          }
          const pc = p.attendance_pct >= 75 ? 'pct-high' : p.attendance_pct >= 50 ? 'pct-mid' : 'pct-low';
          return `<tr>
            <td>${i + 1}</td>
            <td><strong>${p.full_name}</strong></td>
            <td style="font-size:13px;color:var(--g500)">${p.college || '—'}</td>
            ${cells}
            <td class="tc"><strong>${p.total_sessions}</strong></td>
            <td class="tc"><span class="${pc}">${p.attendance_pct}%</span></td>
          </tr>`;
        }).join('');
  } catch(err) { console.error(err); }
}

function exportCSV()           { window.open('/api/admin/export/csv', '_blank'); }
function exportDay(day, sess)  { window.open(`/api/admin/export/csv?day=${day}&session=${sess}`, '_blank'); }
function exportDayCSV()        { const day = document.getElementById('dayFilter').value; window.open('/api/admin/export/csv?day=' + day, '_blank'); }

// ── Mark Attendance ───────────────────────────────────────────
async function loadAllForMark() {
  try {
    const d = await api('/register');
    allParts = d.participants;
    renderMarkList(allParts, 'morning');
    renderMarkList(allParts, 'afternoon');
  } catch(err) { console.error(err); }
}

function renderMarkList(list, session) {
  const elId = session === 'morning' ? 'mList' : 'aList';
  const el = document.getElementById(elId);
  if (!list.length) { el.innerHTML = '<p style="color:var(--g400);font-size:13px;padding:8px">No participants found.</p>'; return; }
  el.innerHTML = list.slice(0, 50).map(p => `
    <div class="indiv-item">
      <div>
        <div class="indiv-name">${p.full_name}</div>
        <div class="indiv-sub">${p.phone} · ${p.college || 'No college'}</div>
      </div>
      <button class="btn btn-success btn-sm" onclick="markOne(${p.id},'${session}','${p.full_name.replace(/'/g,"\\'")}')">✓ Mark</button>
    </div>`).join('');
}

function filterMark(session) {
  const q = document.getElementById(session === 'morning' ? 'mSearch' : 'aSearch').value.toLowerCase();
  const filtered = allParts.filter(p => p.full_name.toLowerCase().includes(q) || p.phone.includes(q));
  renderMarkList(filtered, session);
}

async function markOne(pid, session, name) {
  const dayEl = session === 'morning' ? 'morningDay' : 'afternoonDay';
  const day = parseInt(document.getElementById(dayEl).value);
  try {
    const endpoint = session === 'morning' ? '/attendance/morning' : '/attendance/afternoon/admin';
    await api(endpoint, 'POST', { participant_id: pid, day });
    setMsg('markMsg', `✅ ${session} attendance marked for ${name} — Day ${day}`, 'success');
  } catch(err) {
    setMsg('markMsg', '❌ ' + err.message, 'error');
  }
}

async function bulkMorning() {
  const day = parseInt(document.getElementById('morningDay').value);
  if (!allParts.length) { setMsg('markMsg', '❌ No participants loaded yet.', 'error'); return; }
  if (!confirm(`Mark ALL ${allParts.length} participants present for Day ${day} morning?`)) return;
  try {
    const d = await api('/attendance/morning/bulk', 'POST', { day, participant_ids: allParts.map(p => p.id) });
    setMsg('markMsg', '✅ ' + d.message, 'success');
  } catch(err) {
    setMsg('markMsg', '❌ ' + err.message, 'error');
  }
}

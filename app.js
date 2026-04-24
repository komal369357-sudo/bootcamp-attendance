// ── Tabs ─────────────────────────────────────────────────────
document.querySelectorAll('.nav-link[data-tab]').forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();
    document.querySelectorAll('.nav-link[data-tab]').forEach(l => l.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    link.classList.add('active');
    document.getElementById('tab-' + link.dataset.tab).classList.add('active');
  });
});

// ── Helpers ───────────────────────────────────────────────────
async function api(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch('/api' + path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function showMsg(id, html, type) {
  const el = document.getElementById(id);
  el.innerHTML = html;
  el.className = 'msg msg-' + type;
  el.classList.remove('hidden');
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function setBtn(id, loading, text) {
  const b = document.getElementById(id);
  b.disabled = loading;
  if (loading) { b._orig = b.innerHTML; b.innerHTML = '<span class="spinner"></span>' + text; }
  else b.innerHTML = b._orig || text;
}

// ── Registration ──────────────────────────────────────────────
document.getElementById('registerForm').addEventListener('submit', async e => {
  e.preventDefault();
  const name    = document.getElementById('full_name').value.trim();
  const email   = document.getElementById('email').value.trim();
  const phone   = document.getElementById('phone').value.trim();
  const college = document.getElementById('college').value.trim();

  ['err-name','err-email','err-phone'].forEach(id => document.getElementById(id).textContent = '');
  let ok = true;
  if (!name)   { document.getElementById('err-name').textContent = 'Full name is required.'; ok = false; }
  if (!phone || !/^\d{10}$/.test(phone)) { document.getElementById('err-phone').textContent = 'Enter a valid 10-digit phone number.'; ok = false; }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { document.getElementById('err-email').textContent = 'Invalid email address.'; ok = false; }
  if (!ok) return;

  setBtn('registerBtn', true, 'Registering…');
  document.getElementById('registerResult').innerHTML = '';
  try {
    const d = await api('/register', 'POST', { full_name: name, email, phone, college });
    showMsg('registerResult',
      `<strong>✅ ${d.message}</strong><br/><small>Your phone <b>${d.participant.phone}</b> is your unique ID. Keep it safe!</small>`,
      'success');
    document.getElementById('registerForm').reset();
  } catch(err) {
    showMsg('registerResult', '❌ ' + err.message, 'error');
  } finally {
    setBtn('registerBtn', false, 'Register Now');
  }
});

// ── Check Attendance ──────────────────────────────────────────
async function checkMyAttendance() {
  const phone = document.getElementById('checkPhone').value.trim().replace(/\s|-|\+91/g,'');
  if (!/^\d{10}$/.test(phone)) {
    document.getElementById('attendanceStatus').innerHTML = '<div class="msg msg-error">Enter a valid 10-digit phone number.</div>';
    return;
  }
  try {
    const d = await api('/attendance/summary', 'GET');
    const rec = d.summary.find(s => s.phone === phone);
    if (!rec) {
      document.getElementById('attendanceStatus').innerHTML = '<div class="msg msg-error">Phone not found. Please register first.</div>';
      return;
    }
    let rows = '';
    for (let day = 1; day <= 6; day++) {
      const dd = rec.days[String(day)];
      rows += `<tr>
        <td><strong>Day ${day}</strong></td>
        <td class="tc">${dd.morning ? '✅' : '❌'}</td>
        <td class="tc">${dd.afternoon ? '✅' : '❌'}</td>
      </tr>`;
    }
    const pctClass = rec.attendance_pct >= 75 ? 'pct-high' : rec.attendance_pct >= 50 ? 'pct-mid' : 'pct-low';
    document.getElementById('attendanceStatus').innerHTML = `
      <div class="card" style="margin-top:0;padding:20px">
        <div style="margin-bottom:14px">
          <strong style="font-size:16px">${rec.full_name}</strong>
          <div class="subtitle">${rec.college || 'No college'} · ${rec.phone}</div>
        </div>
        <table class="dtable" style="margin-bottom:14px">
          <thead><tr><th>Day</th><th class="tc">☀️ Morning</th><th class="tc">🌆 Afternoon</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div style="font-size:14px">
          Sessions attended: <strong>${rec.total_sessions}/12</strong> &nbsp;·&nbsp;
          Attendance: <span class="${pctClass}">${rec.attendance_pct}%</span>
        </div>
      </div>`;
  } catch(err) {
    document.getElementById('attendanceStatus').innerHTML = '<div class="msg msg-error">Error: ' + err.message + '</div>';
  }
}

// ── OTP Flow ──────────────────────────────────────────────────
let _phone = '', _day = '', _timer = null;

document.getElementById('otpRequestForm').addEventListener('submit', async e => {
  e.preventDefault();
  const phone = document.getElementById('otp_phone').value.trim();
  const day   = document.getElementById('otp_day').value;
  document.getElementById('otpRequestResult').innerHTML = '';

  if (!/^\d{10}$/.test(phone)) {
    showMsg('otpRequestResult', '❌ Enter a valid 10-digit phone number.', 'error'); return;
  }
  if (!day) { showMsg('otpRequestResult', '❌ Please select a day.', 'error'); return; }

  setBtn('sendOtpBtn', true, 'Sending OTP…');
  try {
    const d = await api('/attendance/afternoon/request-otp', 'POST', { phone, day: parseInt(day) });
    _phone = phone; _day = day;
    document.getElementById('step1').classList.add('hidden');
    document.getElementById('step2').classList.remove('hidden');
    document.getElementById('otpInfoBox').innerHTML =
      `📱 ${d.message}<br/><small>Participant: <strong>${d.participant_name}</strong></small>`;

    // Dev mode: auto-fill OTP
    if (d.dev_mode && d.otp) {
      d.otp.toString().split('').forEach((ch, i) => {
        const box = document.getElementById('o' + (i + 1));
        if (box) box.value = ch;
      });
    }
    startTimer(300);
    document.getElementById('o1').focus();
  } catch(err) {
    showMsg('otpRequestResult', '❌ ' + err.message, 'error');
  } finally {
    setBtn('sendOtpBtn', false, 'Send OTP →');
  }
});

// OTP box behaviour
['o1','o2','o3','o4','o5','o6'].forEach((id, i, arr) => {
  const el = document.getElementById(id);
  el.addEventListener('input', () => {
    el.value = el.value.replace(/\D/g, '').slice(-1);
    if (el.value && i < arr.length - 1) document.getElementById(arr[i + 1]).focus();
  });
  el.addEventListener('keydown', ev => {
    if (ev.key === 'Backspace' && !el.value && i > 0) document.getElementById(arr[i - 1]).focus();
  });
  el.addEventListener('paste', ev => {
    ev.preventDefault();
    const txt = (ev.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
    txt.split('').forEach((ch, j) => { const b = document.getElementById(arr[j]); if (b) b.value = ch; });
    const last = document.getElementById(arr[Math.min(txt.length - 1, 5)]);
    if (last) last.focus();
  });
});

function getOtp() {
  return ['o1','o2','o3','o4','o5','o6'].map(id => document.getElementById(id).value).join('');
}

document.getElementById('otpVerifyForm').addEventListener('submit', async e => {
  e.preventDefault();
  const otp = getOtp();
  document.getElementById('otpVerifyResult').innerHTML = '';
  if (otp.length !== 6) { showMsg('otpVerifyResult', '❌ Please enter the complete 6-digit OTP.', 'error'); return; }

  setBtn('verifyBtn', true, 'Verifying…');
  try {
    const d = await api('/attendance/afternoon/verify-otp', 'POST', { phone: _phone, otp, day: parseInt(_day) });
    if (_timer) clearInterval(_timer);
    document.getElementById('step2').classList.add('hidden');
    document.getElementById('step3').classList.remove('hidden');
    document.getElementById('successTitle').textContent = '✅ Attendance Marked!';
    document.getElementById('successMsg').textContent = d.message;
  } catch(err) {
    showMsg('otpVerifyResult', '❌ ' + err.message, 'error');
  } finally {
    setBtn('verifyBtn', false, 'Verify & Mark Attendance ✓');
  }
});

function resetOtp() {
  if (_timer) clearInterval(_timer);
  _phone = ''; _day = '';
  document.getElementById('step1').classList.remove('hidden');
  document.getElementById('step2').classList.add('hidden');
  document.getElementById('step3').classList.add('hidden');
  document.getElementById('otpRequestResult').innerHTML = '';
  document.getElementById('otpVerifyResult').innerHTML = '';
  ['o1','o2','o3','o4','o5','o6'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('otp_phone').value = '';
  document.getElementById('otp_day').value = '';
}

function startTimer(secs) {
  if (_timer) clearInterval(_timer);
  const el = document.getElementById('otpTimer');
  function tick() {
    if (secs <= 0) {
      el.textContent = 'OTP expired. Go back and request a new one.';
      el.style.color = 'var(--danger)';
      clearInterval(_timer);
      return;
    }
    const m = Math.floor(secs / 60), s = secs % 60;
    el.textContent = `OTP expires in ${m}:${String(s).padStart(2, '0')}`;
    el.style.color = '';
    secs--;
  }
  tick();
  _timer = setInterval(tick, 1000);
}

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import sqlite3, os, random, string, time, jwt, datetime, requests, hashlib

app = Flask(__name__, static_folder='public', static_url_path='')
CORS(app)

DB_PATH = os.environ.get('DB_PATH', os.path.join(os.path.dirname(__file__), 'attendance.db'))
JWT_SECRET = os.environ.get('JWT_SECRET', 'bootcamp_secret_2024_change_in_prod')
ADMIN_USER = os.environ.get('ADMIN_USERNAME', 'admin')
ADMIN_PASS = os.environ.get('ADMIN_PASSWORD', 'admin@123')
FAST2SMS_KEY = os.environ.get('FAST2SMS_KEY', '')
OTP_EXPIRY = 300   # 5 minutes
OTP_RATE   = 60    # 60 seconds

# ── DB Setup ──────────────────────────────────────────────────
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

def init_db():
    with get_db() as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS participants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            full_name TEXT NOT NULL,
            email TEXT DEFAULT '',
            phone TEXT UNIQUE NOT NULL,
            college TEXT DEFAULT '',
            registered_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS attendance (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            participant_id INTEGER NOT NULL,
            day INTEGER NOT NULL,
            session TEXT NOT NULL,
            marked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            marked_by TEXT DEFAULT 'admin',
            UNIQUE(participant_id, day, session),
            FOREIGN KEY(participant_id) REFERENCES participants(id)
        );
        CREATE TABLE IF NOT EXISTS otps (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            phone TEXT NOT NULL,
            otp TEXT NOT NULL,
            day INTEGER DEFAULT 0,
            expires_at REAL NOT NULL,
            used INTEGER DEFAULT 0,
            attempts INTEGER DEFAULT 0,
            created_at REAL DEFAULT (unixepoch())
        );
        """)

init_db()

# ── Helpers ───────────────────────────────────────────────────
def row_to_dict(row):
    return dict(row) if row else None

def rows_to_list(rows):
    return [dict(r) for r in rows]

def require_auth(f):
    from functools import wraps
    @wraps(f)
    def decorated(*args, **kwargs):
        token = request.headers.get('Authorization', '').replace('Bearer ', '')
        if not token:
            return jsonify(error='No token'), 401
        try:
            jwt.decode(token, JWT_SECRET, algorithms=['HS256'])
        except:
            return jsonify(error='Invalid or expired token'), 403
        return f(*args, **kwargs)
    return decorated

def send_otp_sms(phone, otp):
    if not FAST2SMS_KEY:
        print(f"\n========================================")
        print(f"[DEV MODE] OTP for {phone}: {otp}")
        print(f"========================================\n")
        return {'success': True, 'dev': True, 'otp': otp}
    try:
        r = requests.get('https://www.fast2sms.com/dev/bulkV2', params={
            'authorization': FAST2SMS_KEY,
            'route': 'otp',
            'variables_values': otp,
            'flash': 0,
            'numbers': phone
        }, headers={'cache-control': 'no-cache'}, timeout=10)
        data = r.json()
        if data.get('return'):
            return {'success': True}
        return {'success': False, 'error': data.get('message', 'SMS failed')}
    except Exception as e:
        print(f"SMS error: {e}")
        return {'success': False, 'error': str(e)}

# ── Static Pages ──────────────────────────────────────────────
@app.route('/')
def index():
    return send_from_directory('public', 'index.html')

@app.route('/admin')
def admin():
    return send_from_directory('public', 'admin.html')

# ── Auth ──────────────────────────────────────────────────────
@app.route('/api/auth/login', methods=['POST'])
def login():
    d = request.json or {}
    if d.get('username') != ADMIN_USER or d.get('password') != ADMIN_PASS:
        return jsonify(error='Invalid credentials'), 401
    token = jwt.encode({
        'username': ADMIN_USER,
        'exp': datetime.datetime.utcnow() + datetime.timedelta(hours=8)
    }, JWT_SECRET, algorithm='HS256')
    return jsonify(success=True, token=token)

@app.route('/api/auth/verify')
def verify():
    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    try:
        jwt.decode(token, JWT_SECRET, algorithms=['HS256'])
        return jsonify(valid=True)
    except:
        return jsonify(valid=False), 403

# ── Registration ──────────────────────────────────────────────
@app.route('/api/register', methods=['POST'])
def register():
    d = request.json or {}
    full_name = (d.get('full_name') or '').strip()
    email     = (d.get('email') or '').strip().lower()
    phone     = (d.get('phone') or '').strip().replace(' ','').replace('-','').replace('+91','')
    college   = (d.get('college') or '').strip()

    if not full_name or not phone:
        return jsonify(error='Full name and phone number are required'), 400
    if len(phone) != 10 or not phone.isdigit():
        return jsonify(error='Invalid phone number. Must be 10 digits'), 400
    if email and ('@' not in email or '.' not in email):
        return jsonify(error='Invalid email address'), 400

    with get_db() as db:
        existing = db.execute('SELECT id, full_name FROM participants WHERE phone=?', (phone,)).fetchone()
        if existing:
            return jsonify(error=f"Phone already registered by {existing['full_name']}"), 409
        cur = db.execute(
            'INSERT INTO participants (full_name, email, phone, college) VALUES (?,?,?,?)',
            (full_name, email, phone, college)
        )
        p = db.execute('SELECT * FROM participants WHERE id=?', (cur.lastrowid,)).fetchone()
    return jsonify(success=True, message=f'{full_name} registered successfully!', participant=row_to_dict(p)), 201

@app.route('/api/register', methods=['GET'])
@require_auth
def get_participants():
    search = request.args.get('search', '')
    college = request.args.get('college', '')
    with get_db() as db:
        if search:
            s = f'%{search}%'
            rows = db.execute(
                "SELECT * FROM participants WHERE full_name LIKE ? OR phone LIKE ? OR email LIKE ? OR college LIKE ? ORDER BY registered_at DESC",
                (s, s, s, s)
            ).fetchall()
        elif college:
            rows = db.execute(
                "SELECT * FROM participants WHERE college LIKE ? ORDER BY registered_at DESC",
                (f'%{college}%',)
            ).fetchall()
        else:
            rows = db.execute('SELECT * FROM participants ORDER BY registered_at DESC').fetchall()
    return jsonify(success=True, count=len(rows), participants=rows_to_list(rows))

@app.route('/api/register/<int:pid>', methods=['GET'])
@require_auth
def get_participant(pid):
    with get_db() as db:
        p = db.execute('SELECT * FROM participants WHERE id=?', (pid,)).fetchone()
        if not p:
            return jsonify(error='Not found'), 404
        att = db.execute(
            'SELECT day, session, marked_at, marked_by FROM attendance WHERE participant_id=? ORDER BY day, session',
            (pid,)
        ).fetchall()
    return jsonify(success=True, participant=row_to_dict(p), attendance=rows_to_list(att))

@app.route('/api/register/<int:pid>', methods=['DELETE'])
@require_auth
def delete_participant(pid):
    with get_db() as db:
        p = db.execute('SELECT * FROM participants WHERE id=?', (pid,)).fetchone()
        if not p:
            return jsonify(error='Not found'), 404
        db.execute('DELETE FROM attendance WHERE participant_id=?', (pid,))
        db.execute('DELETE FROM participants WHERE id=?', (pid,))
    return jsonify(success=True, message=f"{p['full_name']} deleted")

# ── Attendance: Morning ────────────────────────────────────────
@app.route('/api/attendance/morning', methods=['POST'])
@require_auth
def mark_morning():
    d = request.json or {}
    pid = d.get('participant_id')
    day = d.get('day')
    if not pid or not day or not (1 <= int(day) <= 6):
        return jsonify(error='participant_id and day (1-6) required'), 400
    with get_db() as db:
        p = db.execute('SELECT * FROM participants WHERE id=?', (pid,)).fetchone()
        if not p:
            return jsonify(error='Participant not found'), 404
        try:
            db.execute(
                "INSERT INTO attendance (participant_id, day, session, marked_by) VALUES (?,?,'morning','admin')",
                (pid, day)
            )
        except sqlite3.IntegrityError:
            return jsonify(error=f"{p['full_name']} already marked for Day {day} morning"), 409
    return jsonify(success=True, message=f"Morning attendance marked for {p['full_name']} - Day {day}")

@app.route('/api/attendance/morning/bulk', methods=['POST'])
@require_auth
def bulk_morning():
    d = request.json or {}
    day = d.get('day')
    ids = d.get('participant_ids', [])
    if not day or not ids:
        return jsonify(error='day and participant_ids required'), 400
    marked = skipped = 0
    with get_db() as db:
        for pid in ids:
            try:
                db.execute(
                    "INSERT INTO attendance (participant_id, day, session, marked_by) VALUES (?,?,'morning','admin')",
                    (pid, day)
                )
                marked += 1
            except sqlite3.IntegrityError:
                skipped += 1
    return jsonify(success=True, marked=marked, skipped=skipped,
                   message=f"Day {day} morning: {marked} marked, {skipped} already present")

@app.route('/api/attendance/morning', methods=['DELETE'])
@require_auth
def remove_morning():
    d = request.json or {}
    with get_db() as db:
        db.execute("DELETE FROM attendance WHERE participant_id=? AND day=? AND session='morning'",
                   (d.get('participant_id'), d.get('day')))
    return jsonify(success=True, message='Removed')

# ── Attendance: Afternoon OTP ──────────────────────────────────
@app.route('/api/attendance/afternoon/request-otp', methods=['POST'])
def request_otp():
    d = request.json or {}
    phone = (d.get('phone') or '').replace(' ','').replace('-','').replace('+91','').strip()
    day   = d.get('day')
    if not phone or not day:
        return jsonify(error='Phone and day required'), 400
    if len(phone) != 10 or not phone.isdigit():
        return jsonify(error='Invalid phone number'), 400
    if not (1 <= int(day) <= 6):
        return jsonify(error='Day must be 1-6'), 400

    with get_db() as db:
        p = db.execute('SELECT * FROM participants WHERE phone=?', (phone,)).fetchone()
        if not p:
            return jsonify(error='Phone not registered. Please register first.'), 404

        already = db.execute(
            "SELECT id FROM attendance WHERE participant_id=? AND day=? AND session='afternoon'",
            (p['id'], day)
        ).fetchone()
        if already:
            return jsonify(error=f"Afternoon attendance already marked for Day {day}"), 409

        # Rate limiting — per phone+day combination
        recent = db.execute(
            "SELECT created_at FROM otps WHERE phone=? AND day=? AND created_at > ? ORDER BY created_at DESC LIMIT 1",
            (phone, day, time.time() - OTP_RATE)
        ).fetchone()
        if recent:
            wait = max(1, int(OTP_RATE - (time.time() - float(recent['created_at']))))
            return jsonify(error=f'Please wait {wait} seconds before requesting a new OTP'), 429

        otp = ''.join(random.choices(string.digits, k=6))
        db.execute(
            'INSERT INTO otps (phone, otp, expires_at, day) VALUES (?,?,?,?)',
            (phone, otp, time.time() + OTP_EXPIRY, day)
        )

    result = send_otp_sms(phone, otp)
    masked = phone[:2] + 'XXXXXX' + phone[-2:]
    resp = {
        'success': True,
        'participant_name': p['full_name'],
        'message': f"OTP sent to {masked}" if not result.get('dev') else f"[DEV] OTP: {otp} (check server console)",
        'dev_mode': result.get('dev', False)
    }
    if result.get('dev'):
        resp['otp'] = otp
    return jsonify(**resp)

@app.route('/api/attendance/afternoon/verify-otp', methods=['POST'])
def verify_otp():
    d = request.json or {}
    phone = (d.get('phone') or '').replace(' ','').replace('-','').replace('+91','').strip()
    otp   = str(d.get('otp') or '').strip()
    day   = d.get('day')

    if not phone or not otp or not day:
        return jsonify(error='Phone, OTP and day required'), 400

    with get_db() as db:
        p = db.execute('SELECT * FROM participants WHERE phone=?', (phone,)).fetchone()
        if not p:
            return jsonify(error='Participant not found'), 404

        already = db.execute(
            "SELECT id FROM attendance WHERE participant_id=? AND day=? AND session='afternoon'",
            (p['id'], day)
        ).fetchone()
        if already:
            return jsonify(error=f"Afternoon attendance already marked for Day {day}"), 409

        rec = db.execute(
            "SELECT * FROM otps WHERE phone=? AND day=? AND used=0 AND expires_at>? ORDER BY created_at DESC LIMIT 1",
            (phone, day, time.time())
        ).fetchone()
        if not rec:
            return jsonify(error='OTP expired or not found. Please request a new OTP.'), 400

        db.execute('UPDATE otps SET attempts=attempts+1 WHERE id=?', (rec['id'],))

        if rec['attempts'] >= 5:
            db.execute('UPDATE otps SET used=1 WHERE id=?', (rec['id'],))
            return jsonify(error='Too many attempts. Request a new OTP.'), 400

        if rec['otp'] != otp:
            remaining = 5 - (rec['attempts'] + 1)
            return jsonify(error=f"Incorrect OTP. {remaining} attempt(s) remaining."), 400

        db.execute('UPDATE otps SET used=1 WHERE id=?', (rec['id'],))
        db.execute(
            "INSERT INTO attendance (participant_id, day, session, marked_by) VALUES (?,?,'afternoon','otp')",
            (p['id'], day)
        )

    return jsonify(
        success=True,
        message=f"Afternoon attendance marked for {p['full_name']} - Day {day}!",
        participant={'name': p['full_name'], 'college': p['college']}
    )

@app.route('/api/attendance/afternoon/admin', methods=['POST'])
@require_auth
def admin_afternoon():
    d = request.json or {}
    pid = d.get('participant_id')
    day = d.get('day')
    with get_db() as db:
        p = db.execute('SELECT * FROM participants WHERE id=?', (pid,)).fetchone()
        if not p:
            return jsonify(error='Not found'), 404
        try:
            db.execute(
                "INSERT INTO attendance (participant_id, day, session, marked_by) VALUES (?,?,'afternoon','admin')",
                (pid, day)
            )
        except sqlite3.IntegrityError:
            return jsonify(error=f"{p['full_name']} already marked for Day {day} afternoon"), 409
    return jsonify(success=True, message=f"Afternoon marked for {p['full_name']} - Day {day}")

@app.route('/api/attendance/afternoon', methods=['DELETE'])
@require_auth
def remove_afternoon():
    d = request.json or {}
    with get_db() as db:
        db.execute("DELETE FROM attendance WHERE participant_id=? AND day=? AND session='afternoon'",
                   (d.get('participant_id'), d.get('day')))
    return jsonify(success=True, message='Removed')

# ── Attendance Queries ─────────────────────────────────────────
@app.route('/api/attendance/day/<int:day>')
@require_auth
def attendance_by_day(day):
    with get_db() as db:
        rows = db.execute("""
            SELECT p.id, p.full_name, p.phone, p.college,
                MAX(CASE WHEN a.session='morning' THEN 1 ELSE 0 END) as morning,
                MAX(CASE WHEN a.session='afternoon' THEN 1 ELSE 0 END) as afternoon
            FROM participants p
            LEFT JOIN attendance a ON p.id=a.participant_id AND a.day=?
            GROUP BY p.id ORDER BY p.full_name
        """, (day,)).fetchall()
    return jsonify(success=True, day=day, records=rows_to_list(rows))

@app.route('/api/attendance/summary')
@require_auth
def summary():
    with get_db() as db:
        participants = db.execute('SELECT * FROM participants ORDER BY full_name').fetchall()
        result = []
        for p in participants:
            rec = {'id': p['id'], 'full_name': p['full_name'], 'phone': p['phone'],
                   'college': p['college'], 'days': {}}
            total = 0
            for d in range(1, 7):
                m = db.execute(
                    "SELECT id FROM attendance WHERE participant_id=? AND day=? AND session='morning'",
                    (p['id'], d)
                ).fetchone()
                a = db.execute(
                    "SELECT id FROM attendance WHERE participant_id=? AND day=? AND session='afternoon'",
                    (p['id'], d)
                ).fetchone()
                rec['days'][str(d)] = {'morning': bool(m), 'afternoon': bool(a)}
                if m: total += 1
                if a: total += 1
            rec['total_sessions'] = total
            rec['attendance_pct'] = round((total / 12) * 100)
            result.append(rec)
    return jsonify(success=True, summary=result)

@app.route('/api/attendance/stats')
@require_auth
def stats():
    with get_db() as db:
        total = db.execute('SELECT COUNT(*) as c FROM participants').fetchone()['c']
        day_stats = []
        for d in range(1, 7):
            m = db.execute("SELECT COUNT(*) as c FROM attendance WHERE day=? AND session='morning'", (d,)).fetchone()['c']
            a = db.execute("SELECT COUNT(*) as c FROM attendance WHERE day=? AND session='afternoon'", (d,)).fetchone()['c']
            day_stats.append({'day': d, 'morning': m, 'afternoon': a})
    return jsonify(success=True, totalParticipants=total, dayStats=day_stats)

# ── Admin Routes ──────────────────────────────────────────────
@app.route('/api/admin/dashboard')
@require_auth
def dashboard():
    with get_db() as db:
        total = db.execute('SELECT COUNT(*) as c FROM participants').fetchone()['c']
        total_att = db.execute('SELECT COUNT(*) as c FROM attendance').fetchone()['c']
        colleges = db.execute(
            "SELECT college, COUNT(*) as count FROM participants WHERE college!='' GROUP BY college ORDER BY count DESC"
        ).fetchall()
        recent = db.execute(
            "SELECT full_name, phone, college, registered_at FROM participants ORDER BY registered_at DESC LIMIT 5"
        ).fetchall()
        day_stats = []
        for d in range(1, 7):
            m = db.execute("SELECT COUNT(*) as c FROM attendance WHERE day=? AND session='morning'", (d,)).fetchone()['c']
            a = db.execute("SELECT COUNT(*) as c FROM attendance WHERE day=? AND session='afternoon'", (d,)).fetchone()['c']
            day_stats.append({'day': d, 'morning': m, 'afternoon': a})
    return jsonify(
        success=True,
        totalParticipants=total,
        totalAttendance=total_att,
        collegeStats=rows_to_list(colleges),
        recentRegistrations=rows_to_list(recent),
        dayStats=day_stats
    )

@app.route('/api/admin/export/csv')
@require_auth
def export_csv():
    from flask import Response
    day = request.args.get('day')
    session = request.args.get('session')

    with get_db() as db:
        participants = db.execute('SELECT * FROM participants ORDER BY full_name').fetchall()
        rows = ['S.No,Full Name,Phone,Email,College']

        if day and session:
            rows[0] += f',Day {day} {session.title()}'
            for i, p in enumerate(participants):
                att = db.execute(
                    "SELECT id FROM attendance WHERE participant_id=? AND day=? AND session=?",
                    (p['id'], day, session)
                ).fetchone()
                rows.append(f"{i+1},\"{p['full_name']}\",{p['phone']},{p['email'] or ''},\"{p['college'] or ''}\",{'Present' if att else 'Absent'}")
            fname = f"attendance_day{day}_{session}.csv"
        else:
            for d in range(1, 7):
                rows[0] += f',Day{d} Morning,Day{d} Afternoon'
            rows[0] += ',Total Sessions,Attendance %'
            for i, p in enumerate(participants):
                row = [str(i+1), f'"{p["full_name"]}"', p['phone'], p['email'] or '', f'"{p["college"] or ""}"']
                total = 0
                for d in range(1, 7):
                    m = db.execute("SELECT id FROM attendance WHERE participant_id=? AND day=? AND session='morning'", (p['id'], d)).fetchone()
                    a = db.execute("SELECT id FROM attendance WHERE participant_id=? AND day=? AND session='afternoon'", (p['id'], d)).fetchone()
                    row += ['P' if m else 'A', 'P' if a else 'A']
                    if m: total += 1
                    if a: total += 1
                row += [str(total), f"{round((total/12)*100)}%"]
                rows.append(','.join(row))
            fname = 'attendance_full.csv'

    return Response('\n'.join(rows), mimetype='text/csv',
                    headers={'Content-Disposition': f'attachment; filename={fname}'})

@app.route('/api/admin/colleges')
@require_auth
def colleges():
    with get_db() as db:
        rows = db.execute("SELECT DISTINCT college FROM participants WHERE college!='' ORDER BY college").fetchall()
    return jsonify(success=True, colleges=[r['college'] for r in rows])

if __name__ == '__main__':
    app.run(debug=True, port=5000)

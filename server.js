const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const settings = require('./settings');
const pool = require('./db');
const { compressToJpeg } = require('./compress');

const app = express();
app.set('trust proxy', 1);

app.use(express.json());
// Public files (only the upload page lives here)
app.use(express.static(path.join(__dirname, 'public')));

// ======================================================
// PART 1: REGISTER + UPLOAD (public)
// ======================================================

// Register number rule: 4 to 20 letters, numbers, - or /
// (change this line if your college uses a different format)
const REGISTER_NO_RULE = /^[A-Z0-9\-\/]{4,20}$/;

// Make the typed register number tidy: remove spaces, use capital letters
function cleanRegisterNo(value) {
  return String(value || '').trim().toUpperCase();
}

// REGISTER: save the person with the register number they typed
app.post('/register', async function (req, res) {
  try {
    const registerNo = cleanRegisterNo(req.body && req.body.registerNo);
    const personName = String((req.body && req.body.personName) || '').trim();
    const course = String((req.body && req.body.course) || '').trim() || null;
    const yearOfStudy = String((req.body && req.body.yearOfStudy) || '').trim() || null;

    if (!REGISTER_NO_RULE.test(registerNo)) {
      return res.status(400).json({
        error: 'Register number must be 4 to 20 characters (letters, numbers, - or /).'
      });
    }
    if (personName.length < 2 || personName.length > 100) {
      return res.status(400).json({ error: 'Please enter a valid name (2 to 100 characters)' });
    }
    if (!course) {
      return res.status(400).json({ error: 'Please select your course.' });
    }
    if (!yearOfStudy) {
      return res.status(400).json({ error: 'Please select your year of study.' });
    }

    // Is this register number already registered?
    const [existing] = await pool.execute(
      'SELECT person_name, course, year_of_study FROM people WHERE register_no = ?',
      [registerNo]
    );

    if (existing.length > 0) {
      // Same number + same name = the same person coming back
      if (existing[0].person_name.trim().toLowerCase() === personName.toLowerCase()) {
        if (course !== existing[0].course || yearOfStudy !== existing[0].year_of_study) {
          await pool.execute(
            'UPDATE people SET course = ?, year_of_study = ? WHERE register_no = ?',
            [course, yearOfStudy, registerNo]
          );
        }
        return res.json({
          registerNo: registerNo,
          personName: existing[0].person_name,
          course: course || existing[0].course,
          yearOfStudy: yearOfStudy || existing[0].year_of_study,
          existing: true
        });
      }
      // Same number but a different name: not allowed, and it can never be changed
      return res.status(409).json({
        error: 'This register number is already registered with a different name. It cannot be changed.'
      });
    }

    await pool.execute(
      'INSERT INTO people (register_no, person_name, course, year_of_study) VALUES (?, ?, ?, ?)',
      [registerNo, personName, course, yearOfStudy]
    );

    res.json({
      registerNo: registerNo,
      personName: personName,
      course: course,
      yearOfStudy: yearOfStudy,
      existing: false
    });
  } catch (err) {
    // Two people registered the same number at the same moment
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'This register number is already registered.' });
    }
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// multer receives the uploaded file and keeps it in memory
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },        // reject originals over 10MB
  fileFilter: function (req, file, cb) {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// UPLOAD: compress + convert to JPG + save under the person's register number
app.post('/upload', upload.single('file'), async function (req, res) {
  try {
    const docType = req.body.docType;
    const registerNo = cleanRegisterNo(req.body.registerNo);

    if (docType !== 'photo' && docType !== 'signature') {
      return res.status(400).json({ error: 'docType must be photo or signature' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No file was uploaded' });
    }
    if (!REGISTER_NO_RULE.test(registerNo)) {
      return res.status(400).json({ error: 'Please register first.', code: 'NOT_REGISTERED' });
    }

    // The register number must already be registered
    const [people] = await pool.execute(
      'SELECT person_name FROM people WHERE register_no = ?',
      [registerNo]
    );
    if (people.length === 0) {
      return res.status(400).json({
        error: 'Register number not found. Please register again.',
        code: 'NOT_REGISTERED'
      });
    }

    const compressed = await compressToJpeg(req.file.buffer, docType);

    // One photo and one signature per person: a new upload replaces the old one
    await pool.execute(
      `INSERT INTO documents (register_no, doc_type, original_name, original_size, compressed_size, file_data)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         original_name = VALUES(original_name),
         original_size = VALUES(original_size),
         compressed_size = VALUES(compressed_size),
         file_data = VALUES(file_data),
         uploaded_at = CURRENT_TIMESTAMP`,
      [registerNo, docType, req.file.originalname, req.file.size, compressed.length, compressed]
    );

    res.json({
      registerNo: registerNo,
      personName: people[0].person_name,
      originalSizeKB: (req.file.size / 1024).toFixed(1),
      compressedSizeKB: (compressed.length / 1024).toFixed(1),
      // A small preview sent straight back, so the image needs no public link
      previewUrl: 'data:image/jpeg;base64,' + compressed.toString('base64')
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ======================================================
// PART 2: ADMIN (protected by the pass key)
// ======================================================
const sessions = new Map();        // login token -> expiry time
const failedLogins = new Map();    // computer address -> wrong attempts
const SESSION_MS = 2 * 60 * 60 * 1000;   // stay logged in for 2 hours
const LOCK_MS = 15 * 60 * 1000;          // lock for 15 minutes after 5 wrong tries

// Read one cookie value from the request
function getCookie(req, name) {
  const parts = (req.headers.cookie || '').split(';');
  for (const part of parts) {
    const pieces = part.trim().split('=');
    if (pieces[0] === name) return decodeURIComponent(pieces.slice(1).join('='));
  }
  return null;
}

// Is this browser logged in as admin?
function isAdmin(req) {
  const token = getCookie(req, 'admin_session');
  if (!token) return false;
  const expiry = sessions.get(token);
  if (!expiry) return false;
  if (Date.now() > expiry) {
    sessions.delete(token);
    return false;
  }
  return true;
}

// Guard: only lets logged-in admins through
function requireAdmin(req, res, next) {
  res.set('Cache-Control', 'no-store');
  if (isAdmin(req)) return next();
  res.status(401).json({ error: 'Admin login required' });
}

// Compare the typed key with the real key safely
function keyMatches(typedKey) {
  const a = crypto.createHash('sha256').update(String(typedKey || '')).digest();
  const b = crypto.createHash('sha256').update(String(settings.ADMIN_KEY)).digest();
  return crypto.timingSafeEqual(a, b);
}

function adminKeyIsSet() {
  return settings.ADMIN_KEY &&
         settings.ADMIN_KEY.length >= 8 &&
         settings.ADMIN_KEY !== 'CHANGE_THIS_TO_YOUR_OWN_PASSKEY';
}

// The admin page: shows the login screen, or the dashboard if logged in
app.get('/admin', function (req, res) {
  res.set('Cache-Control', 'no-store');
  const file = isAdmin(req) ? 'dashboard.html' : 'login.html';
  res.sendFile(path.join(__dirname, 'admin', file));
});

// Login with the pass key
app.post('/admin/login', function (req, res) {
  if (!adminKeyIsSet()) {
    return res.status(500).json({ error: 'Admin pass key is not set in settings.js' });
  }

  const ip = req.ip;
  const record = failedLogins.get(ip) || { count: 0, lockedUntil: 0 };

  if (Date.now() < record.lockedUntil) {
    const mins = Math.ceil((record.lockedUntil - Date.now()) / 60000);
    return res.status(429).json({ error: 'Too many wrong attempts. Try again in ' + mins + ' minute(s).' });
  }

  if (!keyMatches(req.body && req.body.key)) {
    record.count += 1;
    if (record.count >= 5) {
      record.lockedUntil = Date.now() + LOCK_MS;
      record.count = 0;
    }
    failedLogins.set(ip, record);
    return res.status(401).json({ error: 'Wrong pass key' });
  }

  failedLogins.delete(ip);
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + SESSION_MS);
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie',
    'admin_session=' + token + '; HttpOnly; SameSite=Lax; Path=/; Max-Age=' + (SESSION_MS / 1000) + (isHttps ? '; Secure' : ''));
  res.json({ ok: true });
});

// Logout
app.post('/admin/logout', function (req, res) {
  const token = getCookie(req, 'admin_session');
  if (token) sessions.delete(token);
  res.setHeader('Set-Cookie', 'admin_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ ok: true });
});

// Admin only: list of students and their documents, searchable by name, register number, course, or year
app.get('/admin/api/documents', requireAdmin, async function (req, res) {
  try {
    const term = '%' + (req.query.name || '') + '%';
    const [rows] = await pool.execute(
      `SELECT p.register_no,
              p.person_name,
              p.course,
              p.year_of_study,
              p.registered_at,
              d.id AS doc_id,
              d.doc_type,
              d.original_name,
              d.compressed_size,
              d.uploaded_at
       FROM people p
       LEFT JOIN documents d ON d.register_no = p.register_no
       WHERE p.person_name LIKE ? OR p.register_no LIKE ? OR COALESCE(p.course, '') LIKE ? OR COALESCE(p.year_of_study, '') LIKE ?
       ORDER BY p.registered_at DESC, p.register_no ASC, d.doc_type ASC`,
      [term, term, term, term]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Admin only: edit student details (name, course, year of study)
app.put('/admin/api/students/:registerNo', requireAdmin, async function (req, res) {
  try {
    const registerNo = cleanRegisterNo(req.params.registerNo);
    const personName = String((req.body && req.body.personName) || '').trim();
    const course = String((req.body && req.body.course) || '').trim() || null;
    const yearOfStudy = String((req.body && req.body.yearOfStudy) || '').trim() || null;

    if (personName.length < 2 || personName.length > 100) {
      return res.status(400).json({ error: 'Please enter a valid name (2 to 100 characters)' });
    }

    const [result] = await pool.execute(
      'UPDATE people SET person_name = ?, course = ?, year_of_study = ? WHERE register_no = ?',
      [personName, course, yearOfStudy, registerNo]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Student not found.' });
    }

    res.json({ ok: true, registerNo, personName, course, yearOfStudy });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Admin only: delete a selective student and their documents
app.delete('/admin/api/students/:registerNo', requireAdmin, async function (req, res) {
  try {
    const registerNo = cleanRegisterNo(req.params.registerNo);
    await pool.execute('DELETE FROM documents WHERE register_no = ?', [registerNo]);
    const [result] = await pool.execute('DELETE FROM people WHERE register_no = ?', [registerNo]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Student not found.' });
    }

    res.json({ ok: true, message: 'Student and uploaded documents deleted successfully.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Admin only: delete multiple selected students
app.post('/admin/api/students/delete-multiple', requireAdmin, async function (req, res) {
  try {
    const registerNos = Array.isArray(req.body.registerNos)
      ? req.body.registerNos.map(cleanRegisterNo).filter(Boolean)
      : [];

    if (registerNos.length === 0) {
      return res.status(400).json({ error: 'No students selected for deletion.' });
    }

    const placeholders = registerNos.map(() => '?').join(',');
    await pool.execute(`DELETE FROM documents WHERE register_no IN (${placeholders})`, registerNos);
    const [result] = await pool.execute(`DELETE FROM people WHERE register_no IN (${placeholders})`, registerNos);

    res.json({ ok: true, deletedCount: result.affectedRows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Admin only: delete all data (whole data deletion)
app.post('/admin/api/students/delete-all', requireAdmin, async function (req, res) {
  try {
    await pool.execute('DELETE FROM documents');
    await pool.execute('DELETE FROM people');
    res.json({ ok: true, message: 'All student records and uploaded documents have been deleted.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Admin only: delete an individual document (photo or signature)
app.delete('/admin/api/documents/:id', requireAdmin, async function (req, res) {
  try {
    const [result] = await pool.execute('DELETE FROM documents WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Document not found.' });
    }
    res.json({ ok: true, message: 'Document deleted successfully.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Admin only: view/download one image
app.get('/admin/document/:id', requireAdmin, async function (req, res) {
  try {
    const [rows] = await pool.execute(
      'SELECT file_data FROM documents WHERE id = ?',
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).send('Not found');
    }
    res.set('Content-Type', 'image/jpeg');
    res.send(rows[0].file_data);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

// ======================================================
// Errors and startup
// ======================================================
app.use(function (err, req, res, next) {
  res.status(400).json({ error: err.message });
});

// Ensure database has the course and year_of_study columns
async function ensureSchema() {
  try {
    const [courseCols] = await pool.query("SHOW COLUMNS FROM people LIKE 'course'");
    if (courseCols.length === 0) {
      await pool.query("ALTER TABLE people ADD COLUMN course VARCHAR(100) DEFAULT NULL AFTER person_name");
      console.log("Schema auto-migration: Added 'course' column to people table.");
    }
    const [yearCols] = await pool.query("SHOW COLUMNS FROM people LIKE 'year_of_study'");
    if (yearCols.length === 0) {
      await pool.query("ALTER TABLE people ADD COLUMN year_of_study VARCHAR(20) DEFAULT NULL AFTER course");
      console.log("Schema auto-migration: Added 'year_of_study' column to people table.");
    }
  } catch (err) {
    console.warn("Schema auto-migration check note:", err.message);
  }
}

app.listen(settings.PORT, async function () {
  console.log('Server started. Open http://localhost:' + settings.PORT);
  console.log('Admin page:     http://localhost:' + settings.PORT + '/admin');
  if (!adminKeyIsSet()) {
    console.log('WARNING: set ADMIN_KEY in settings.js (at least 8 characters) or the admin login is disabled.');
  }
  try {
    await pool.query('SELECT 1');
    console.log('Connected to MySQL successfully.');
    await ensureSchema();
  } catch (err) {
    console.log('COULD NOT CONNECT TO MYSQL: ' + err.message);
    console.log('Check the password in settings.js and make sure MySQL is running.');
  }
});
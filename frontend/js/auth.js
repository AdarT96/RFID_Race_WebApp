// =====================================================
//  auth.js — loaded as type="module" after firebase-config.js
//  FIREBASE_CONFIG and APP_CONFIG are globals from firebase-config.js
// =====================================================

import { initializeApp }              from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword,
         signInWithEmailAndPassword, signOut,
         onAuthStateChanged }          from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";
import { getFirestore, doc, setDoc,
         getDoc, serverTimestamp }     from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

const fbApp  = initializeApp(window.FIREBASE_CONFIG);
const auth   = getAuth(fbApp);
const db     = getFirestore(fbApp);

// ── Helpers ──────────────────────────────────────────
const $  = id => document.getElementById(id);
const val = id => ($( id)?.value?.trim() ?? '');

function showMsg(id, msg, type = 'danger') {
  const el = $(id);
  if (!el) return;
  el.className = `alert alert-${type}`;
  el.textContent = msg;
  el.style.display = '';
}

function setLoading(btnId, loading) {
  const btn = $(btnId);
  if (!btn) return;
  if (loading) { btn.dataset.label = btn.dataset.label || btn.textContent; }
  btn.disabled   = loading;
  btn.innerHTML  = loading ? '<span class="spinner"></span> Please wait…' : btn.dataset.label;
}

function firebaseErrMsg(code) {
  return ({
    'auth/email-already-in-use': 'This email is already registered.',
    'auth/invalid-email':        'Invalid email address.',
    'auth/weak-password':        'Password is too weak (min 8 chars).',
    'auth/user-not-found':       'No account found with this email.',
    'auth/wrong-password':       'Incorrect password.',
    'auth/invalid-credential':   'Incorrect email or password.',
    'auth/too-many-requests':    'Too many attempts. Try again later.',
    'auth/network-request-failed': 'Network error. Check your connection.',
  })[code] || `Error (${code})`;
}

// ── Registration ──────────────────────────────────────
async function registerUser() {
  const name  = val('reg-name');
  const email = val('reg-email');
  const pass  = val('reg-pass');
  const pass2 = val('reg-pass2');
  const role  = val('reg-role');

  if (!name || !email || !pass || !role)
    return showMsg('reg-msg', 'Please fill in all fields.');
  if (pass.length < 8)
    return showMsg('reg-msg', 'Password must be at least 8 characters.');
  if (pass !== pass2)
    return showMsg('reg-msg', 'Passwords do not match.');

  setLoading('reg-btn', true);
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    await setDoc(doc(db, 'users', cred.user.uid), {
      uid:       cred.user.uid,
      name,
      email,
      role,
      approved:  false,
      createdAt: serverTimestamp()
    });
    $('reg-form').style.display = 'none';
    showMsg('reg-msg', '✅ Account created! Waiting for admin approval.', 'success');
    await signOut(auth);
  } catch(err) {
    showMsg('reg-msg', firebaseErrMsg(err.code));
  } finally {
    setLoading('reg-btn', false);
  }
}

// ── Login ─────────────────────────────────────────────
async function loginUser() {
  const email = val('login-email');
  const pass  = val('login-pass');
  if (!email || !pass) return showMsg('login-msg', 'Please enter email and password.');

  setLoading('login-btn', true);
  try {
    const cred = await signInWithEmailAndPassword(auth, email, pass);
    const snap = await getDoc(doc(db, 'users', cred.user.uid));

    if (!snap.exists()) {
      await signOut(auth);
      return showMsg('login-msg', 'User record not found. Contact admin.');
    }

    const data = snap.data();
    if (!data.approved && data.role !== 'admin') {
      await signOut(auth);
      return showMsg('login-msg', '⏳ Account pending admin approval.', 'warning');
    }

    window.location.href = data.role === 'admin' ? 'admin.html' : 'app.html';
  } catch(err) {
    showMsg('login-msg', firebaseErrMsg(err.code));
  } finally {
    setLoading('login-btn', false);
  }
}

// ── Tab Init ──────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.style.display = 'none');
    btn.classList.add('active');
    const pane = document.getElementById(target);
    if (pane) pane.style.display = '';
  });
});

// Expose to inline onclick handlers
window.registerUser = registerUser;
window.loginUser    = loginUser;
// Reset or bootstrap a staff account's password and/or PIN in Firestore.
//
// Usage:
//   cd functions && npm run build
//   STAFF_PASSWORD="..." STAFF_PIN="123456" node scripts/reset-staff-credentials.js --username admin --role admin
//   node scripts/reset-staff-credentials.js --username staff1 --pin 654321
//
// Auth: GOOGLE_APPLICATION_CREDENTIALS (service account) or gcloud ADC.
const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { hashPasswordAsync, verifyPasswordAsync } = require('../lib/util/security');

const USERNAME_RE = /^[a-z0-9._-]{2,64}$/;
const PIN_RE = /^[0-9]{4,8}$/;
const MAX_ACCOUNTS = 50;

/**
 * The staff account already using `pin`, or null. PIN sign-in scans accounts
 * and signs in as the first match, so a PIN shared with another account can
 * hand a staffer the admin session. `updateStaffPin` enforces uniqueness; this
 * script is the other way credentials get set, so it must too.
 */
async function findPinOwner(db, pin, exceptUsername) {
  const snap = await db.collection('staff_accounts').select('pinHash').limit(MAX_ACCOUNTS).get();
  for (const doc of snap.docs) {
    if (doc.id === exceptUsername) continue;
    const hash = doc.get('pinHash');
    if (typeof hash !== 'string' || hash.length === 0) continue;
    if ((await verifyPasswordAsync(pin, hash)) !== 'bad') return doc.id;
  }
  return null;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--username' || arg === '--role' || arg === '--password' || arg === '--pin') {
      out[arg.slice(2)] = argv[i + 1];
      i += 1;
    }
  }
  return out;
}

async function resetStaffCredentials(db, { username: rawUsername, role, password, pin }) {
  const username = typeof rawUsername === 'string' ? rawUsername.trim().toLowerCase() : '';
  if (!USERNAME_RE.test(username)) {
    throw new Error('Invalid --username (must match /^[a-z0-9._-]{2,64}$/ after lowercasing)');
  }
  if (role !== undefined && role !== 'admin' && role !== 'staff') {
    throw new Error('Invalid --role (must be "admin" or "staff")');
  }
  if (password !== undefined && (typeof password !== 'string' || password.length < 8)) {
    throw new Error('Invalid password (must be at least 8 characters)');
  }
  if (pin !== undefined && (typeof pin !== 'string' || !PIN_RE.test(pin))) {
    throw new Error('Invalid PIN (must be 4-8 digits)');
  }
  if (password === undefined && pin === undefined) {
    throw new Error('Provide at least one of --password / STAFF_PASSWORD or --pin / STAFF_PIN');
  }
  if (pin !== undefined) {
    const owner = await findPinOwner(db, pin, username);
    if (owner) {
      throw new Error(`PIN is already used by staff account "${owner}"; choose a different PIN`);
    }
  }

  const update = {
    username,
    updatedAt: Timestamp.now(),
  };
  if (role !== undefined) update.role = role;
  if (password !== undefined) update.passwordHash = await hashPasswordAsync(password);
  if (pin !== undefined) update.pinHash = await hashPasswordAsync(pin);

  await db.collection('staff_accounts').doc(username).set(update, { merge: true });
  return {
    username,
    role: role ?? null,
    passwordUpdated: password !== undefined,
    pinUpdated: pin !== undefined,
  };
}

module.exports = { resetStaffCredentials, parseArgs, findPinOwner };

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  const password = args.password ?? process.env.STAFF_PASSWORD;
  const pin = args.pin ?? process.env.STAFF_PIN;
  if (!getApps().length) initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'lunaexpress' });
  resetStaffCredentials(getFirestore(), {
    username: args.username,
    role: args.role,
    password,
    pin,
  })
    .then((res) => {
      console.log(JSON.stringify(res));
      process.exit(0);
    })
    .catch((e) => {
      console.error(e.message || e);
      process.exit(1);
    });
}

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
const { hashPasswordAsync } = require('../lib/util/security');

const USERNAME_RE = /^[a-z0-9._-]{2,64}$/;
const PIN_RE = /^[0-9]{4,8}$/;

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

module.exports = { resetStaffCredentials, parseArgs };

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

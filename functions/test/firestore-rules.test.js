// Firestore security rules regression tests. Run with: npm run test:rules
// (executes against the Firestore emulator; never touches production).
const { describe, test, before, after, beforeEach } = require('node:test');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require('@firebase/rules-unit-testing');
const {
  Timestamp,
  doc,
  collection,
  addDoc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
} = require('firebase/firestore');

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('Run via `npm run test:rules` (needs the Firestore emulator).');
}

let testEnv;
before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'lunaexpress-test',
    firestore: {
      rules: readFileSync(
        process.env.FIRESTORE_RULES_FILE || resolve(__dirname, '../../firestore.rules'),
        'utf8',
      ),
    },
  });
});
after(() => testEnv.cleanup());
beforeEach(() => testEnv.clearFirestore());

const anon = () => testEnv.unauthenticatedContext().firestore();
const user = (uid, claims = {}) => testEnv.authenticatedContext(uid, claims).firestore();
const seed = (path, data) =>
  testEnv.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), path), data));

const order = (over = {}) => ({
  customerName: 'Ana',
  items: [{ name: 'Shawarma Wrap', price: 99, quantity: 1 }],
  totalAmount: 99,
  ...over,
});

describe('orders: kiosk can only create (validated)', () => {
  test('anon can create a valid order', async () => {
    await assertSucceeds(addDoc(collection(anon(), 'orders'), order()));
  });
  test('anon can create the complete checkout payload', async () => {
    const payload = JSON.parse(readFileSync(
      process.env.ORDER_PAYLOAD_FILE || resolve(__dirname, 'fixtures/order-create.json'),
      'utf8',
    ));
    payload.timestamp = Timestamp.fromDate(new Date(payload.timestamp));
    await assertSucceeds(addDoc(collection(anon(), 'orders'), payload));
  });
  test('create rejects telegramSent (the field that broke checkout)', async () => {
    const payload = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/order-create.json'), 'utf8'));
    payload.timestamp = Timestamp.fromDate(new Date(payload.timestamp));
    await assertFails(addDoc(collection(anon(), 'orders'), { ...payload, telegramSent: false }));
  });
  test('create rejects missing/junk/oversized/forged fields', async () => {
    const { customerName: _d, ...noName } = order();
    await assertFails(addDoc(collection(anon(), 'orders'), noName));
    await assertFails(addDoc(collection(anon(), 'orders'), order({ items: [] })));
    await assertFails(addDoc(collection(anon(), 'orders'), order({ totalAmount: -5 })));
    await assertFails(addDoc(collection(anon(), 'orders'), order({ injected: true })));
    await assertFails(addDoc(collection(anon(), 'orders'), order({ paymentStatus: 'PAID' })));
    await assertFails(addDoc(collection(anon(), 'orders'), order({ status: 'Completed' })));
    await assertFails(addDoc(collection(anon(), 'orders'), order({ entryType: 'Staff' })));
  });
  test('nobody can read/update/delete via client', async () => {
    await seed('orders/o1', order());
    const ref = doc(anon(), 'orders/o1');
    await assertFails(getDoc(ref));
    await assertFails(updateDoc(ref, { totalAmount: 1 }));
    await assertFails(deleteDoc(ref));
    await assertFails(getDoc(doc(user('u1', { role: 'staff' }), 'orders/o1')));
  });
});

// Fixtures are the exact writes checkout makes, produced by
// test/order_service_test.dart. If one fails here, real orders fail in production.
describe('orders: every checkout combination saves', () => {
  const dir = resolve(__dirname, 'fixtures/checkout');
  const load = (name) => {
    const payload = JSON.parse(readFileSync(resolve(dir, `${name}.json`), 'utf8'));
    payload.timestamp = Timestamp.fromDate(new Date(payload.timestamp));
    return payload;
  };
  const staff = () => user('staff_ana', { role: 'staff' });
  const admin = () => user('staff_admin', { role: 'admin' });

  for (const name of ['kiosk-cash', 'kiosk-gcash']) {
    test(`${name}: a signed-out customer can place it`, async () => {
      await assertSucceeds(addDoc(collection(anon(), 'orders'), load(name)));
    });
    test(`${name}: a signed-in non-staff user can place it`, async () => {
      await assertSucceeds(addDoc(collection(user('rider1'), 'orders'), load(name)));
    });
    test(`${name}: staff can place it`, async () => {
      await assertSucceeds(addDoc(collection(staff(), 'orders'), load(name)));
    });
  }

  for (const name of ['staff-cash', 'staff-gcash']) {
    test(`${name}: staff and admin can place it`, async () => {
      await assertSucceeds(addDoc(collection(staff(), 'orders'), load(name)));
      await assertSucceeds(addDoc(collection(admin(), 'orders'), load(name)));
    });
    test(`${name}: rejected without a staff role claim`, async () => {
      await assertFails(addDoc(collection(anon(), 'orders'), load(name)));
      await assertFails(addDoc(collection(user('staff_ana'), 'orders'), load(name)));
      await assertFails(addDoc(collection(user('rider1', { role: 'rider' }), 'orders'), load(name)));
    });
  }

  test('the limits checkout enforces match the rules', async () => {
    const base = load('kiosk-cash');
    const line = base.items[0];
    await assertSucceeds(addDoc(collection(anon(), 'orders'), { ...base, customerName: 'a'.repeat(100) }));
    await assertFails(addDoc(collection(anon(), 'orders'), { ...base, customerName: 'a'.repeat(101) }));
    await assertSucceeds(addDoc(collection(anon(), 'orders'), { ...base, items: Array(50).fill(line) }));
    await assertFails(addDoc(collection(anon(), 'orders'), { ...base, items: Array(51).fill(line) }));
  });
});

describe('kds_orders: staff read the kitchen mirror, nobody writes', () => {
  const mirror = { orderNumber: 'LU-1', status: 'Pending', ts: Timestamp.now() };
  test('staff and admin can get and list', async () => {
    await seed('kds_orders/o1', mirror);
    for (const role of ['staff', 'admin']) {
      const db = user(`staff_${role}`, { role });
      await assertSucceeds(getDoc(doc(db, 'kds_orders/o1')));
      await assertSucceeds(getDocs(collection(db, 'kds_orders')));
    }
  });
  test('anon, customers and riders cannot read', async () => {
    await seed('kds_orders/o1', mirror);
    for (const db of [anon(), user('cust1'), user('rider1', { riderStatus: 'approved' }), user('x', { role: 'rider' })]) {
      await assertFails(getDoc(doc(db, 'kds_orders/o1')));
      await assertFails(getDocs(collection(db, 'kds_orders')));
    }
  });
  test('even admins cannot write the mirror', async () => {
    await seed('kds_orders/o1', mirror);
    const db = user('staff_admin', { role: 'admin' });
    await assertFails(setDoc(doc(db, 'kds_orders/o2'), mirror));
    await assertFails(updateDoc(doc(db, 'kds_orders/o1'), { status: 'Ready' }));
    await assertFails(deleteDoc(doc(db, 'kds_orders/o1')));
  });
  test('derived stats collections stay server-only', async () => {
    const db = user('staff_admin', { role: 'admin' });
    for (const path of ['dailyStats/2026-11-15', 'stats_events/e1', 'stats_meta/dailyStats']) {
      await seed(path, { orders: 1 });
      await assertFails(getDoc(doc(db, path)));
      await assertFails(setDoc(doc(db, path), { orders: 2 }));
    }
  });
});

describe('config: public read-only', () => {
  test('anon can read, cannot write', async () => {
    await seed('config/app', { open: true });
    await assertSucceeds(getDoc(doc(anon(), 'config/app')));
    await assertFails(setDoc(doc(anon(), 'config/hack'), { open: false }));
    await assertFails(updateDoc(doc(anon(), 'config/app'), { open: false }));
  });
});

describe('staff_accounts + login_attempts: server only', () => {
  test('everyone denied, even staff', async () => {
    await seed('staff_accounts/boss', { pin: 'x' });
    await assertFails(getDoc(doc(anon(), 'staff_accounts/boss')));
    await assertFails(getDoc(doc(user('u1', { role: 'staff' }), 'staff_accounts/boss')));
    await assertFails(setDoc(doc(anon(), 'login_attempts/k'), { fails: 1 }));
    await assertFails(getDoc(doc(user('u1'), 'login_attempts/k')));
  });
});

describe('default deny', () => {
  test('unknown collections denied', async () => {
    await assertFails(getDoc(doc(anon(), 'whatever/w1')));
    await assertFails(setDoc(doc(anon(), 'whatever/w1'), { a: 1 }));
  });
});

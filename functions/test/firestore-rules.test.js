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

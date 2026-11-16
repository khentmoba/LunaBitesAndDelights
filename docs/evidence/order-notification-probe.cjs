const { createRequire } = require('module');
const requireProject = createRequire(process.cwd() + '/functions/package.json');
const assert = require('node:assert/strict');
const fs = require('node:fs');
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Emulator required');
process.env.TELEGRAM_CHAT_ID = 'fixture-recipient';
const { sendOrderNotification } = requireProject('./lib/index');
const { getFirestore } = requireProject('firebase-admin/firestore');
const { setBot } = requireProject('./lib/telegram_api');
(async () => {
 const db = getFirestore();
 const payload = JSON.parse(fs.readFileSync('functions/test/fixtures/order-create.json', 'utf8'));
 const ref = db.collection('orders').doc('notificationRegression');
 await ref.set(payload);
 const data = {
  ...payload, orderDocId: ref.id, orderNumber: payload.orderId,
  total: payload.totalAmount, orderType: payload.type,
 };
 setBot({sendMessage: async () => ({message_id:1})});
 assert.deepEqual(await sendOrderNotification.run({data}), {success:true});
 assert.equal((await ref.get()).data().telegramSent, true);
 console.log('PASS: notification function adds telegramSent=true to an order created without that field');
 setBot({sendMessage: async () => {throw new Error('Simulated transport failure');}});
 assert.deepEqual(await sendOrderNotification.run({data}), {success:true, alreadySent:true});
 const failRef = db.collection('orders').doc('notificationRegressionFail');
 await failRef.set(payload);
 const failData = { ...data, orderDocId: failRef.id };
 await assert.rejects(sendOrderNotification.run({data: failData}));
 const saved = (await failRef.get()).data();
 assert.equal(saved.telegramSent, false);
 assert.equal(saved.totalAmount, payload.totalAmount);
 assert.equal(saved.orderId, payload.orderId);
 console.log('PASS: notification failure adds telegramSent=false and preserves the order');
 await requireProject('firebase-admin/app').deleteApp(requireProject('firebase-admin/app').getApp());
})().catch(e=>{console.error(e);process.exitCode=1});

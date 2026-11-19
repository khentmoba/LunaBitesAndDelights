const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { escapeMd, sendToAll, sendPhotoToAll, setBot, stripMarkdownV2, isMarkdownParseError } = require('../lib/telegram_api');
const {
  itemLines,
  formatOrderNotification,
  formatDeliverySummaryCaption,
  getGoogleStaticMapUrl,
  getMapTilerStaticMapUrl,
  getGoogleMapsNavigationUrl,
} = require('../lib/orders/send_notification');

// Comprehensive MarkdownV2 validator that simulates Telegram Bot API's entity parser
function validateMarkdownV2(text) {
  const errors = [];
  const reserved = new Set(['_', '*', '[', ']', '(', ')', '~', '`', '>', '#', '+', '-', '=', '|', '{', '}', '.', '!']);
  
  let i = 0;
  const stack = [];
  
  while (i < text.length) {
    const char = text[i];
    
    if (char === '\\') {
      // Escaped character - skip next character
      i += 2;
      continue;
    }
    
    if (text.startsWith('```', i)) {
      const end = text.indexOf('```', i + 3);
      if (end === -1) {
        errors.push(`Unclosed code block at index ${i}`);
        break;
      }
      i = end + 3;
      continue;
    }
    
    if (char === '`') {
      const end = text.indexOf('`', i + 1);
      if (end === -1) {
        errors.push(`Unclosed inline code at index ${i}`);
        break;
      }
      i = end + 1;
      continue;
    }
    
    if (char === '[') {
      let j = i + 1;
      let depth = 1;
      while (j < text.length) {
        if (text[j] === '\\') { j += 2; continue; }
        if (text[j] === '[') depth++;
        if (text[j] === ']') {
          depth--;
          if (depth === 0) break;
        }
        j++;
      }
      if (depth !== 0 || text[j + 1] !== '(') {
        errors.push(`Character '[' is reserved and must be escaped at offset ${i}`);
        i++;
        continue;
      }
      let k = j + 2;
      while (k < text.length) {
        if (text[k] === '\\') { k += 2; continue; }
        if (text[k] === ')') break;
        k++;
      }
      if (k >= text.length || text[k] !== ')') {
        errors.push(`Unclosed link URL at offset ${j + 1}`);
        i = j + 1;
        continue;
      }
      const linkTextErrors = validateMarkdownV2(text.slice(i + 1, j));
      errors.push(...linkTextErrors);
      i = k + 1;
      continue;
    }
    
    if (char === '*' || char === '_' || char === '~' || text.startsWith('||', i)) {
      const tag = text.startsWith('||', i) ? '||' : char;
      const tagLen = tag.length;
      if (stack.length > 0 && stack[stack.length - 1].tag === tag) {
        stack.pop();
      } else {
        stack.push({ tag, index: i });
      }
      i += tagLen;
      continue;
    }
    
    if (reserved.has(char)) {
      errors.push(`Character '${char}' is reserved and must be escaped at offset ${i} (context: "${text.slice(Math.max(0, i - 15), Math.min(text.length, i + 15))}")`);
    }
    
    i++;
  }
  
  while (stack.length > 0) {
    const unclosed = stack.pop();
    errors.push(`Unclosed entity '${unclosed.tag}' starting at offset ${unclosed.index}`);
  }
  
  return errors;
}

describe('Telegram MarkdownV2 escaping and order notifications', () => {
  test('escapeMd escapes all Telegram MarkdownV2 reserved characters', () => {
    const allReserved = '_*[]()~`>#+-=|{}.!\\';
    const escaped = escapeMd(allReserved);
    for (const ch of allReserved) {
      assert.ok(escaped.includes('\\' + ch), `Expected \\${ch} in escaped output`);
    }
  });

  test('escapeMd handles numbers, null, and undefined without throwing', () => {
    assert.equal(escapeMd(null), '');
    assert.equal(escapeMd(undefined), '');
    assert.equal(escapeMd(12345), '12345');
    assert.equal(escapeMd(99.5), '99\\.5');
  });

  test('item line with variant must have escaped parentheses in MarkdownV2', () => {
    assert.equal(typeof itemLines, 'function', 'itemLines should be exported function');
    const itemWithVariant = { name: 'French Fries', variant: 'Cheese', price: 50, quantity: 2 };
    const line = itemLines([itemWithVariant]);
    const errors = validateMarkdownV2(line);
    assert.deepEqual(errors, [], `itemLines produced invalid MarkdownV2: ${errors.join(', ')}`);
    assert.ok(line.includes('\\(Cheese\\)'), `Expected escaped parentheses \\(Cheese\\), but got: ${line}`);
  });

  test('full order notification messages must be valid MarkdownV2', () => {
    assert.equal(typeof formatOrderNotification, 'function', 'formatOrderNotification should be exported function');
    const testCases = [
      {
        desc: 'Delivery with variants and map coordinates',
        data: {
          orderNumber: 'LU-10001',
          customerName: 'Juan Dela Cruz',
          customerAddress: 'Purok 1, Brgy. Libertad, Butuan City',
          customerPhone: '09123456789',
          items: [
            { name: 'French Fries', variant: 'Cheese', price: 50, quantity: 1 },
            { name: 'Coolers', variant: 'Purple Taro', price: 39, quantity: 2 },
          ],
          total: 128,
          timeStr: '2026-09-28  14:30',
          orderType: 'Delivery',
          deliveryFee: 50,
          paymentMethod: 'Cash',
          paymentStatus: 'NOT PAID',
          lat: 8.95,
          lng: 125.53,
        },
      },
      {
        desc: 'Pickup order with GCash awaiting payment',
        data: {
          orderNumber: 'LU-10002',
          customerName: 'Maria Santos',
          customerPhone: '09987654321',
          items: [
            { name: 'Shawarma Wrap', variant: 'Buy 1 Take 1', price: 99, quantity: 1 },
          ],
          total: 99,
          timeStr: '2026-09-28  15:00',
          orderType: 'Pickup',
          deliveryFee: 0,
          paymentMethod: 'GCash',
          paymentStatus: 'AWAITING_PAYMENT',
        },
      },
      {
        desc: 'Walk-in order with variant and paid status',
        data: {
          orderNumber: 'LU-10003',
          customerName: 'Walk-in Customer',
          customerPhone: 'N/A',
          items: [
            { name: 'Burger', variant: 'Solo', price: 60, quantity: 1 },
          ],
          total: 60,
          timeStr: '2026-09-28  15:15',
          orderType: 'Walk-In',
          paymentMethod: 'Cash',
          paymentStatus: 'PAID',
        },
      },
    ];

    for (const tc of testCases) {
      const msg = formatOrderNotification(tc.data);
      if (tc.data.orderType === 'Delivery') {
        assert.ok(msg.includes('Delivery Fee:* Confirmed by rider; charged separately'));
        assert.ok(msg.includes('*FOOD TOTAL:*'));
        assert.ok(!msg.includes('Delivery Fee:* ₱'));
      } else {
        assert.ok(!msg.includes('Delivery Fee:'));
      }
      const errors = validateMarkdownV2(msg);
      assert.deepEqual(errors, [], `${tc.desc} failed MarkdownV2 validation:\n${errors.join('\n')}\n\nMessage:\n${msg}`);
    }
  });

  test('stripMarkdownV2 removes backslash escapes cleanly for plain-text fallback', () => {
    const { stripMarkdownV2 } = require('../lib/telegram_api');
    assert.equal(typeof stripMarkdownV2, 'function', 'stripMarkdownV2 should be exported function');
    const escaped = '🔔 *NEW ORDER — LU\\-12345*\n  • 1x French Fries \\(Cheese\\) — ₱50\n✅ _Please prepare this order\\!_';
    const stripped = stripMarkdownV2(escaped);
    assert.ok(!stripped.includes('\\-'), 'Expected \\- to become -');
    assert.ok(!stripped.includes('\\('), 'Expected \\( to become (');
    assert.ok(!stripped.includes('\\)'), 'Expected \\) to become )');
    assert.ok(!stripped.includes('\\!'), 'Expected \\! to become !');
    assert.equal(stripped, '🔔 *NEW ORDER — LU-12345*\n  • 1x French Fries (Cheese) — ₱50\n✅ _Please prepare this order!_');
  });

  test('sendToAll falls back to plain text when Telegram rejects entity parsing', async () => {
    process.env.TELEGRAM_CHAT_ID = '111,222';
    const { sendToAll, setBot } = require('../lib/telegram_api');

    const sentCalls = [];
    const mockBot = {
      sendMessage: async (chatId, text, opts) => {
        sentCalls.push({ chatId, text, opts });
        if (opts.parse_mode === 'MarkdownV2') {
          // Simulate Telegram 400 Bad Request entity parsing error
          const err = new Error("ETELEGRAM: 400 Bad Request: can't parse entities: Character '(' is reserved");
          err.response = { body: { description: "Bad Request: can't parse entities: Character '(' is reserved" } };
          throw err;
        }
        return { message_id: 1, chat: { id: chatId } };
      },
    };

    setBot(mockBot);

    const testMsg = '🔔 *NEW ORDER — LU\\-12345*\n  • 1x French Fries \\(Cheese\\) — ₱50';
    const results = await sendToAll(testMsg);

    assert.equal(results.length, 2);
    assert.equal(results[0].status, 'fulfilled');
    assert.equal(results[1].status, 'fulfilled');

    // Each chat should have had 1 failed MarkdownV2 attempt and 1 successful plain-text fallback attempt
    assert.equal(sentCalls.length, 4);
    const mdCalls = sentCalls.filter(c => c.opts.parse_mode === 'MarkdownV2');
    const fallbackCalls = sentCalls.filter(c => c.opts.parse_mode === undefined);
    assert.equal(mdCalls.length, 2);
    assert.equal(fallbackCalls.length, 2);
    assert.equal(fallbackCalls[0].text, '🔔 *NEW ORDER — LU-12345*\n  • 1x French Fries (Cheese) — ₱50');
  });

  test('map URL helpers generate valid Google and MapTiler URLs', () => {
    const lat = 8.95;
    const lng = 125.53;

    const navUrl = getGoogleMapsNavigationUrl(lat, lng);
    assert.equal(navUrl, 'https://www.google.com/maps/dir/?api=1&destination=8.95,125.53');

    const gmapUrl = getGoogleStaticMapUrl(lat, lng, 'AIzaSyFakeKey123');
    assert.ok(gmapUrl.startsWith('https://maps.googleapis.com/maps/api/staticmap?'));
    assert.ok(gmapUrl.includes('center=8.95%2C125.53'));
    assert.ok(gmapUrl.includes('zoom=17'));
    assert.ok(gmapUrl.includes('size=600x400'));
    assert.ok(gmapUrl.includes('scale=2'));
    assert.ok(gmapUrl.includes('maptype=hybrid'));
    assert.ok(gmapUrl.includes('markers=color%3Ared%7C8.95%2C125.53'));
    assert.ok(gmapUrl.includes('key=AIzaSyFakeKey123'));

    const maptilerUrl = getMapTilerStaticMapUrl(lat, lng, 'maptilerKeyXYZ');
    assert.equal(
      maptilerUrl,
      'https://api.maptiler.com/maps/streets-v2/static/125.53,8.95,17/600x400@2x.png?key=maptilerKeyXYZ&markers=125.53,8.95'
    );
  });

  test('formatDeliverySummaryCaption generates valid MarkdownV2 under 1024 chars', () => {
    const summary = formatDeliverySummaryCaption({
      orderNumber: 'LU-260928-120000',
      customerName: 'Khent Dela Cruz',
      customerAddress: 'Purok 5, Poblacion Magallanes, Agusan del Norte',
      customerPhone: '09123456789',
      items: [],
      total: 540,
      timeStr: '2026-09-28 12:00',
      orderType: 'Delivery',
      paymentMethod: 'GCash',
      paymentStatus: 'PAID',
      lat: 8.95,
      lng: 125.53,
    });

    const errors = validateMarkdownV2(summary);
    assert.deepEqual(errors, [], `formatDeliverySummaryCaption failed MarkdownV2 validation: ${errors.join(', ')}`);
    assert.ok(summary.length <= 1024, `Summary caption length ${summary.length} exceeds 1024 char limit`);
    assert.ok(summary.includes('NEW DELIVERY'));
    assert.ok(summary.includes('Full itemized list sent below'));
  });

  test('sendPhotoToAll sends photo with caption and reply_markup, and falls back to plain text on entity parse error', async () => {
    process.env.TELEGRAM_CHAT_ID = '333,444';
    const sentPhotoCalls = [];
    const mockBot = {
      sendPhoto: async (chatId, photo, opts, fileOpts) => {
        sentPhotoCalls.push({ chatId, photo, opts, fileOpts });
        if (opts.parse_mode === 'MarkdownV2') {
          const err = new Error("ETELEGRAM: 400 Bad Request: can't parse entities");
          err.response = { body: { description: "Bad Request: can't parse entities" } };
          throw err;
        }
        return { message_id: 2, chat: { id: chatId } };
      },
    };

    setBot(mockBot);

    const fakeBuffer = Buffer.from('fake-image-bytes');
    const caption = '🔔 *NEW DELIVERY — LU\\-999*\n📍 Address: Purok 5';
    const replyMarkup = {
      inline_keyboard: [[{ text: '📍 Open in Google Maps 🧭', url: 'https://www.google.com/maps/dir/?api=1&destination=8.95,125.53' }]],
    };

    const results = await sendPhotoToAll(fakeBuffer, caption, { reply_markup: replyMarkup });

    assert.equal(results.length, 2);
    assert.equal(results[0].status, 'fulfilled');
    assert.equal(results[1].status, 'fulfilled');

    // Both chats had 1 failed MarkdownV2 call and 1 successful plain-text fallback call
    assert.equal(sentPhotoCalls.length, 4);
    const mdCalls = sentPhotoCalls.filter(c => c.opts.parse_mode === 'MarkdownV2');
    const fallbackCalls = sentPhotoCalls.filter(c => c.opts.parse_mode === undefined);
    assert.equal(mdCalls.length, 2);
    assert.equal(fallbackCalls.length, 2);

    assert.equal(fallbackCalls[0].photo, fakeBuffer);
    assert.deepEqual(fallbackCalls[0].opts.reply_markup, replyMarkup);
    assert.equal(fallbackCalls[0].fileOpts.filename, 'delivery_map.png');
    assert.equal(fallbackCalls[0].opts.caption, '🔔 *NEW DELIVERY — LU-999*\n📍 Address: Purok 5');
  });

  test('isMarkdownParseError matches Telegram entity parse errors without false-matching plain 400 text', () => {
    assert.equal(isMarkdownParseError({ message: "Bad Request: can't parse entities" }), true);
    assert.equal(isMarkdownParseError({ response: { statusCode: 400, body: { description: 'Character must be escaped' } } }), true);
    assert.equal(isMarkdownParseError({ message: 'chat_id 40012345 not found' }), false);
    assert.equal(isMarkdownParseError({ response: { statusCode: 400, body: { description: 'Bad Request: chat not found' } } }), false);
  });

  test('sendToAll and sendPhotoToAll fail cleanly when unconfigured or all recipients reject', async () => {
    process.env.TELEGRAM_CHAT_ID = ' , ';
    await assert.rejects(() => sendToAll('hello'), /TELEGRAM_CHAT_ID is not configured/);
    await assert.rejects(() => sendPhotoToAll(Buffer.from('x'), 'cap'), /TELEGRAM_CHAT_ID is not configured/);

    process.env.TELEGRAM_CHAT_ID = '111,222';
    setBot({
      sendMessage: async () => { throw new Error('network down'); },
      sendPhoto: async () => { throw new Error('network down'); },
    });
    await assert.rejects(() => sendToAll('hello'), /All 2 Telegram messages failed/);
    await assert.rejects(() => sendPhotoToAll(Buffer.from('x'), 'cap'), /All 2 Telegram photo messages failed/);
  });

  test('notificationDataFromOrder builds payload strictly from authoritative Firestore order doc', () => {
    const { notificationDataFromOrder } = require('../lib/orders/send_notification');
    const data = notificationDataFromOrder(
      {
        orderId: 'LU-261119-120000-ABC',
        customerName: 'Maria',
        customerAddress: 'Purok 5',
        customerPhone: '09171234567',
        items: [{ name: 'Shawarma Wrap', variant: 'Solo', price: 60, quantity: 2 }],
        totalAmount: 120,
        type: 'Delivery',
        paymentMethod: 'Cash',
        paymentStatus: 'NOT PAID',
        lat: 9.02,
        lng: 125.51,
      },
      'doc123',
      '2026-11-19  12:00',
    );
    assert.equal(data.orderNumber, 'LU-261119-120000-ABC');
    assert.equal(data.total, 120);
    assert.equal(data.paymentStatus, 'NOT PAID');
    assert.equal(data.items.length, 1);
    assert.equal(data.lat, 9.02);
  });

  test('native fetch Telegram client sends JSON messages without node-telegram-bot-api', async () => {
    process.env.TELEGRAM_TOKEN = 'test-token-123';
    process.env.TELEGRAM_CHAT_ID = '555';
    setBot(null);
    const origFetch = global.fetch;
    const calls = [];
    try {
      global.fetch = async (url, init) => {
        calls.push({ url, init });
        return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 9 } }) };
      };
      const results = await sendToAll('hello');
      assert.equal(results.length, 1);
      assert.equal(results[0].status, 'fulfilled');
      assert.equal(calls[0].url, 'https://api.telegram.org/bottest-token-123/sendMessage');
      const payload = JSON.parse(calls[0].init.body);
      assert.equal(payload.chat_id, '555');
      assert.equal(payload.text, 'hello');
    } finally {
      global.fetch = origFetch;
      setBot(null);
    }
  });
});

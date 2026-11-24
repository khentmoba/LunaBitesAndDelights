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

  test('isPermanentTelegramError distinguishes permanent 4xx from transient 429/5xx', () => {
    const { isPermanentTelegramError } = require('../lib/telegram_api');
    assert.equal(isPermanentTelegramError({ response: { statusCode: 400 } }), true);
    assert.equal(isPermanentTelegramError({ response: { statusCode: 403 } }), true);
    assert.equal(isPermanentTelegramError({ response: { statusCode: 429 } }), false);
    assert.equal(isPermanentTelegramError({ response: { statusCode: 408 } }), false);
    assert.equal(isPermanentTelegramError({ response: { statusCode: 502 } }), false);
    assert.equal(isPermanentTelegramError(new Error('ECONNRESET')), false);
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

  test('evaluateNotificationClaim distinguishes in-flight leases from already-sent and recovers stale claims', () => {
    const {
      evaluateNotificationClaim,
      canClaimNotification,
      TELEGRAM_CLAIM_TTL_MS,
    } = require('../lib/orders/send_notification');
    const now = 1_700_000_000_000;
    assert.equal(evaluateNotificationClaim(undefined, now), 'missing');
    assert.equal(evaluateNotificationClaim({ telegramSent: true }, now), 'already-sent');
    assert.equal(evaluateNotificationClaim({ telegramStatus: 'failed' }, now), 'claimed');
    assert.equal(
      evaluateNotificationClaim({ telegramStatus: 'sending', telegramClaimedAt: now - 10_000 }, now),
      'in-flight',
      'fresh in-flight claim must be distinguished so retryable triggers can retry instead of marking sent',
    );
    assert.equal(
      canClaimNotification({ telegramStatus: 'sending', telegramClaimedAt: now - 10_000 }, now),
      false,
    );
    assert.equal(
      evaluateNotificationClaim({ telegramStatus: 'sending', telegramClaimedAt: now - TELEGRAM_CLAIM_TTL_MS }, now),
      'claimed',
      'expired claim must be reclaimable after crash/timeout',
    );
    assert.equal(
      evaluateNotificationClaim({ telegramStatus: 'sending' }, now),
      'claimed',
      'legacy sending doc without timestamp must be reclaimable',
    );
  });

  test('splitTelegramMessage chunks >3800-char messages on newlines without splitting escapes', () => {
    const { splitTelegramMessage } = require('../lib/telegram_api');
    const line = '• 1x *Shawarma Wrap* \\(Buy 1 Take 1\\) — ₱99\n';
    const big = line.repeat(120);
    assert.ok(big.length > 4096);
    const chunks = splitTelegramMessage(big, 3800);
    assert.ok(chunks.length >= 2);
    for (const c of chunks) {
      assert.ok(c.length <= 3800, `chunk exceeded limit: ${c.length}`);
      assert.ok(!c.endsWith('\\'), 'chunk must not end with stray escape backslash');
    }
    assert.equal(chunks.join('\n').trimEnd().replace(/\n+/g, '\n'), big.trimEnd().replace(/\n+/g, '\n'));
  });

  test('formatDeliverySummaryCaption stays within Telegram 1024-char photo caption limit', () => {
    const { formatDeliverySummaryCaption } = require('../lib/orders/send_notification');
    const caption = formatDeliverySummaryCaption({
      orderNumber: 'LU-261121-170000-ABC',
      customerName: 'A.'.repeat(50),
      customerAddress: 'Purok 5, Brgy. Poblacion (Near 7-Eleven) - '.repeat(10),
      customerPhone: '09171234567',
      items: [],
      total: 12345,
      timeStr: '2026-11-21  17:00',
      orderType: 'Delivery',
      deliveryFee: 0,
      paymentMethod: 'Cash',
      paymentStatus: 'NOT PAID',
      lat: 9.02,
      lng: 125.51,
    });
    assert.ok(caption.length <= 1024, `caption exceeded 1024 chars: ${caption.length}`);
  });

  test('fetchMapImage rejects non-image content types and oversized payloads', async () => {
    const { fetchMapImage } = require('../lib/orders/send_notification');
    const origFetch = global.fetch;
    try {
      global.fetch = async () => ({
        ok: true,
        headers: new Headers({ 'content-type': 'text/html' }),
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      });
      assert.equal(await fetchMapImage('https://example.com/bad'), null);

      global.fetch = async () => ({
        ok: true,
        headers: new Headers({ 'content-type': 'image/png', 'content-length': String(6 * 1024 * 1024) }),
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      });
      assert.equal(await fetchMapImage('https://example.com/huge'), null);

      global.fetch = async () => ({
        ok: true,
        headers: new Headers({ 'content-type': 'image/png', 'content-length': '3' }),
        arrayBuffer: async () => new Uint8Array([137, 80, 78]).buffer,
      });
      const ok = await fetchMapImage('https://example.com/ok.png');
      assert.ok(Buffer.isBuffer(ok) && ok.length === 3);
    } finally {
      global.fetch = origFetch;
    }
  });

  test('sendToAll retries transient 5xx/network errors with exponential backoff and succeeds', async () => {
    const { sendToAll, setBot, setTelegramRetryConfig } = require('../lib/telegram_api');
    process.env.TELEGRAM_CHAT_ID = '-100123456';
    const sleeps = [];
    setTelegramRetryConfig({
      maxAttempts: 3,
      baseDelayMs: 500,
      sleep: async (ms) => { sleeps.push(ms); },
    });
    let attempts = 0;
    setBot({
      sendMessage: async () => {
        attempts++;
        if (attempts < 3) {
          const err = new Error('ETELEGRAM: 503 Service Unavailable');
          err.response = { statusCode: 503, body: { description: 'Service Unavailable' } };
          throw err;
        }
        return { message_id: 42 };
      },
      sendPhoto: async () => ({ message_id: 43 }),
    });
    try {
      const res = await sendToAll('hello');
      assert.equal(attempts, 3);
      assert.deepEqual(sleeps, [500, 1000]);
      assert.deepEqual(res.deliveredChatIds, ['-100123456']);
    } finally {
      setBot(null);
      setTelegramRetryConfig(null);
    }
  });

  test('sendToAll respects 429 retry_after within cap and defers long cooldowns to outer retry', async () => {
    const { sendToAll, setBot, setTelegramRetryConfig } = require('../lib/telegram_api');
    process.env.TELEGRAM_CHAT_ID = '-100123456';
    const sleeps = [];
    setTelegramRetryConfig({
      maxAttempts: 3,
      baseDelayMs: 500,
      maxRetryAfterMs: 5000,
      sleep: async (ms) => { sleeps.push(ms); },
    });

    // Short retry_after (2s) retries in-process and succeeds.
    let calls = 0;
    setBot({
      sendMessage: async () => {
        calls++;
        if (calls === 1) {
          const err = new Error('ETELEGRAM: 429 Too Many Requests');
          err.response = { statusCode: 429, body: { ok: false, parameters: { retry_after: 2 } } };
          throw err;
        }
        return { message_id: 1 };
      },
      sendPhoto: async () => ({ message_id: 1 }),
    });
    try {
      await sendToAll('short-429');
      assert.equal(calls, 2);
      assert.deepEqual(sleeps, [2000]);

      // Long retry_after (30s > 5s cap) does not block; rejects as non-permanent.
      sleeps.length = 0;
      calls = 0;
      setBot({
        sendMessage: async () => {
          calls++;
          const err = new Error('ETELEGRAM: 429 Too Many Requests');
          err.response = { statusCode: 429, body: { ok: false, parameters: { retry_after: 30 } } };
          throw err;
        },
        sendPhoto: async () => ({ message_id: 1 }),
      });
      await assert.rejects(
        () => sendToAll('long-429'),
        (err) => err.permanent === false && calls === 1 && sleeps.length === 0,
      );
    } finally {
      setBot(null);
      setTelegramRetryConfig(null);
    }
  });

  test('sendToAll automatically retries supergroup migrate_to_chat_id and does not classify it as permanent', async () => {
    const { sendToAll, setBot, isPermanentTelegramError, getMigratedChatId } = require('../lib/telegram_api');
    process.env.TELEGRAM_CHAT_ID = '-12345';
    const migrationErr = new Error('ETELEGRAM: 400 Bad Request: group chat was upgraded to a supergroup chat');
    migrationErr.response = {
      statusCode: 400,
      body: { ok: false, parameters: { migrate_to_chat_id: -100999888 } },
    };
    assert.equal(getMigratedChatId(migrationErr), '-100999888');
    assert.equal(isPermanentTelegramError(migrationErr), false);

    const targeted = [];
    setBot({
      sendMessage: async (chatId) => {
        targeted.push(chatId);
        if (chatId === '-12345') throw migrationErr;
        return { message_id: 77 };
      },
      sendPhoto: async () => ({ message_id: 78 }),
    });
    try {
      const res = await sendToAll('migrated-order');
      assert.deepEqual(targeted, ['-12345', '-100999888']);
      assert.deepEqual(res.deliveredChatIds, ['-12345', '-100999888']);

      // After updating TELEGRAM_CHAT_ID to the migrated ID, resuming with skipChatIds skips it.
      targeted.length = 0;
      process.env.TELEGRAM_CHAT_ID = '-100999888, other-chat';
      const resumed = await sendToAll('migrated-order', { skipChatIds: res.deliveredChatIds });
      assert.deepEqual(targeted, ['other-chat']);
      assert.deepEqual(resumed.deliveredChatIds, ['other-chat']);
    } finally {
      setBot(null);
    }
  });

  test('split-mode delivery photo partial failure still sends full itemized text to all chats', async () => {
    const { setBot, setTelegramRetryConfig } = require('../lib/telegram_api');
    const { sendDeliveryNotification } = require('../lib/orders/send_notification');
    process.env.TELEGRAM_CHAT_ID = 'owner, gc';
    process.env.GOOGLE_MAPS_API_KEY = 'fake-map-key';
    setTelegramRetryConfig({ maxAttempts: 1, sleep: async () => {} });

    const origFetch = global.fetch;
    const photoTargets = [];
    const textTargets = [];
    setBot({
      sendPhoto: async (chatId) => {
        photoTargets.push(chatId);
        if (chatId === 'gc') {
          const err = new Error('ETELEGRAM: 502 Bad Gateway');
          err.response = { statusCode: 502 };
          throw err;
        }
        return { message_id: 10 };
      },
      sendMessage: async (chatId) => {
        textTargets.push(chatId);
        return { message_id: 11 };
      },
    });
    global.fetch = async () => ({
      ok: true,
      headers: { get: () => 'image/png' },
      arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer,
    });
    try {
      const longMessage = 'Itemized list:\n' + 'x'.repeat(1100);
      const delivered = await sendDeliveryNotification(
        {
          orderNumber: 'LU-SPLIT-1',
          customerName: 'Ana',
          orderType: 'Delivery',
          items: [{ name: 'Burger', variant: '', price: 100, quantity: 1 }],
          total: 100,
          paymentMethod: 'Cash',
          timeStr: '2026-11-22 18:00',
          deliveryAddress: 'Purok 5',
        },
        longMessage,
        9.01,
        125.52,
      );
      assert.deepEqual(photoTargets, ['owner', 'gc']);
      assert.deepEqual(textTargets, ['owner', 'gc'], 'owner received only summary caption so it must still receive full text');
      assert.deepEqual(delivered, ['owner', 'gc']);
    } finally {
      global.fetch = origFetch;
      delete process.env.GOOGLE_MAPS_API_KEY;
      setBot(null);
      setTelegramRetryConfig(null);
    }
  });

  test('partial multi-chat transient failure throws with deliveredChatIds and skipChatIds resumes without duplicates', async () => {
    const { sendToAll, setBot, setTelegramRetryConfig } = require('../lib/telegram_api');
    process.env.TELEGRAM_CHAT_ID = 'owner, gc, owner';
    setTelegramRetryConfig({ maxAttempts: 1, sleep: async () => {} });

    const sentTo = [];
    let gcFails = true;
    setBot({
      sendMessage: async (chatId) => {
        sentTo.push(chatId);
        if (chatId === 'gc' && gcFails) {
          const err = new Error('ETELEGRAM: 502 Bad Gateway');
          err.response = { statusCode: 502 };
          throw err;
        }
        return { message_id: 1 };
      },
      sendPhoto: async () => ({ message_id: 1 }),
    });
    try {
      let caught = null;
      try {
        await sendToAll('order-1');
      } catch (e) {
        caught = e;
      }
      assert.ok(caught, 'partial transient failure must reject so GC is retried');
      assert.equal(caught.permanent, false);
      assert.deepEqual(caught.deliveredChatIds, ['owner']);
      assert.deepEqual(caught.failedChatIds, ['gc']);
      assert.deepEqual(sentTo, ['owner', 'gc'], 'duplicate chat IDs in env must be deduplicated');

      // Resume with skipChatIds — only GC is retried, owner is not spammed.
      sentTo.length = 0;
      gcFails = false;
      const resumed = await sendToAll('order-1', { skipChatIds: caught.deliveredChatIds });
      assert.deepEqual(sentTo, ['gc']);
      assert.deepEqual(resumed.deliveredChatIds, ['gc']);
    } finally {
      setBot(null);
      setTelegramRetryConfig(null);
    }
  });

  test('permanent failure on one dead chat does not fail delivery when active GC succeeds', async () => {
    const { sendToAll, setBot, setTelegramRetryConfig } = require('../lib/telegram_api');
    process.env.TELEGRAM_CHAT_ID = 'dead-chat, active-gc';
    setTelegramRetryConfig({ maxAttempts: 2, sleep: async () => {} });

    const attemptsByChat = { 'dead-chat': 0, 'active-gc': 0 };
    setBot({
      sendMessage: async (chatId) => {
        attemptsByChat[chatId]++;
        if (chatId === 'dead-chat') {
          const err = new Error('ETELEGRAM: 403 Forbidden: bot was kicked');
          err.response = { statusCode: 403 };
          throw err;
        }
        return { message_id: 9 };
      },
      sendPhoto: async () => ({ message_id: 9 }),
    });
    try {
      const res = await sendToAll('order-2');
      assert.equal(attemptsByChat['dead-chat'], 1, 'permanent 403 must not retry');
      assert.equal(attemptsByChat['active-gc'], 1);
      assert.deepEqual(res.deliveredChatIds, ['active-gc']);
    } finally {
      setBot(null);
      setTelegramRetryConfig(null);
    }
  });

  test('getBot trims whitespace/newlines from TELEGRAM_TOKEN and evaluateNotificationClaim recognizes failed_permanent', async () => {
    const { sendToAll, setBot } = require('../lib/telegram_api');
    const { evaluateNotificationClaim, canClaimNotification } = require('../lib/orders/send_notification');
    assert.equal(evaluateNotificationClaim({ telegramStatus: 'failed_permanent' }), 'failed-permanent');
    assert.equal(canClaimNotification({ telegramStatus: 'failed_permanent' }), false);

    process.env.TELEGRAM_TOKEN = '  trimmed-tok-999\n ';
    process.env.TELEGRAM_CHAT_ID = '555';
    setBot(null);
    const origFetch = global.fetch;
    const urls = [];
    try {
      global.fetch = async (url) => {
        urls.push(url);
        return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }) };
      };
      await sendToAll('trimmed');
      assert.equal(urls[0], 'https://api.telegram.org/bottrimmed-tok-999/sendMessage');
    } finally {
      global.fetch = origFetch;
      setBot(null);
    }
  });

  test('reconcileMissedPaymentNotifications skips fresh payments within minAgeMs and reuses supplied paidDocs', async () => {
    const { reconcileMissedPaymentNotifications } = require('../lib/orders/send_notification');
    process.env.TELEGRAM_TOKEN = 'test-token';
    process.env.TELEGRAM_CHAT_ID = '555';

    const nowMs = 1_700_000_000_000;
    let queriedOrders = false;
    let getAllCalled = false;
    const fakeDb = {
      collection(name) {
        if (name === 'orders') queriedOrders = true;
        throw new Error(`Unexpected collection query: ${name}`);
      },
      async getAll() {
        getAllCalled = true;
        return [];
      },
    };
    const freshPaidDoc = {
      id: 'ord_fresh_paid',
      data: () => ({
        paymentMethod: 'GCash',
        paymentStatus: 'PAID',
        paidAt: new Date(nowMs - 5_000).toISOString(),
      }),
    };

    const summary = await reconcileMissedPaymentNotifications(fakeDb, {
      nowMs,
      paidDocs: [freshPaidDoc],
    });
    assert.equal(queriedOrders, false, 'should reuse caller-supplied paidDocs without re-querying orders');
    assert.equal(getAllCalled, false, 'should not inspect notification docs when all paid orders are within minAgeMs');
    assert.deepEqual(summary, { checked: 0, retried: 0, sent: 0, failed: 0 });
  });

  test('runOrderNotificationReconciliation runs order and payment passes sequentially with shared paidDocs', async () => {
    const { runOrderNotificationReconciliation } = require('../lib/orders/send_notification');
    const sharedDocs = [{ id: 'ord_1' }];
    let queryCount = 0;
    const fakeDb = {
      collection(name) {
        assert.equal(name, 'orders');
        return {
          where() { return this; },
          orderBy() { return this; },
          limit() { return this; },
          async get() {
            queryCount++;
            return { docs: sharedDocs };
          },
        };
      },
    };

    const trace = [];
    const result = await runOrderNotificationReconciliation(fakeDb, {
      nowMs: 1_700_000_000_000,
      async runOrders(_db, opts) {
        trace.push('orders:start');
        assert.strictEqual(opts.paidDocs, sharedDocs);
        await new Promise((r) => setTimeout(r, 15));
        trace.push('orders:end');
        return { checked: 1, retried: 1, sent: 1, failed: 0 };
      },
      async runPayments(_db, opts) {
        trace.push('payments:start');
        assert.strictEqual(opts.paidDocs, sharedDocs);
        trace.push('payments:end');
        return { checked: 1, retried: 1, sent: 1, failed: 0 };
      },
    });

    assert.equal(queryCount, 1, 'paid orders query should run once and be shared');
    assert.deepEqual(trace, ['orders:start', 'orders:end', 'payments:start', 'payments:end']);
    assert.equal(result.orders.sent, 1);
    assert.equal(result.payments.sent, 1);
  });

  test('runOrderNotificationReconciliation still runs payments pass when orders pass throws', async () => {
    const { runOrderNotificationReconciliation } = require('../lib/orders/send_notification');
    const sharedDocs = [{ id: 'ord_2' }];
    const fakeDb = {
      collection() {
        return {
          where() { return this; },
          orderBy() { return this; },
          limit() { return this; },
          async get() { return { docs: sharedDocs }; },
        };
      },
    };

    let paymentsRan = false;
    const result = await runOrderNotificationReconciliation(fakeDb, {
      nowMs: 1_700_000_000_000,
      async runOrders() {
        throw new Error('transient Firestore read failure');
      },
      async runPayments(_db, opts) {
        paymentsRan = true;
        assert.strictEqual(opts.paidDocs, sharedDocs);
        return { checked: 1, retried: 1, sent: 1, failed: 0 };
      },
    });

    assert.equal(paymentsRan, true);
    assert.deepEqual(result.orders, { checked: 0, retried: 0, sent: 0, failed: 0 });
    assert.equal(result.payments.sent, 1);
  });
});

import { defineSecret } from 'firebase-functions/params';

// Secrets (NOT params): values stay out of config/logs. Set via:
//   firebase functions:secrets:set TELEGRAM_TOKEN
//   firebase functions:secrets:set TELEGRAM_CHAT_ID
//   firebase functions:secrets:set PAYMONGO_SECRET_KEY
//   firebase functions:secrets:set GOOGLE_MAPS_API_KEY
export const telegramToken = defineSecret('TELEGRAM_TOKEN');
export const telegramChatIds = defineSecret('TELEGRAM_CHAT_ID');
export const paymongoSecret = defineSecret('PAYMONGO_SECRET_KEY');
export const paymongoWebhookSecret = defineSecret('PAYMONGO_WEBHOOK_SECRET');
export const googleMapsApiKey = defineSecret('GOOGLE_MAPS_API_KEY');

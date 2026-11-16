import { initializeApp } from 'firebase-admin/app';

initializeApp();

export { telegramToken, telegramChatIds, paymongoSecret, googleMapsApiKey } from './secrets';

export { dailySalesReport } from './reporting/daily_report';
export { triggerManualReport } from './reporting/manual_report';
export { verifyStaff, updateStaffPin } from './auth/verify_staff';
export { sendOrderNotification } from './orders/send_notification';
export { getActiveOrders, updateOrderStatus } from './orders/kds';
export { onOrderWritten } from './orders/derived';
export { getSalesAnalytics } from './reporting/analytics';
export { getLifetimeSalesReport } from './reporting/lifetime_report';
export { createCheckoutSession } from './payments/create_checkout';
export { verifyCheckoutPayment } from './payments/verify_payment';
export { paymongoWebhook } from './payments/webhook';

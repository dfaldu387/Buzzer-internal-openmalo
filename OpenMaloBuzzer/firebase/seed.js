/**
 * Seed script — run once to initialize Firestore with default data.
 *
 * Usage:
 *   1. Set GOOGLE_APPLICATION_CREDENTIALS to your service account key
 *   2. node seed.js
 */
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

// Simple PIN hash (must match the app's hashPin function)
function hashPin(pin) {
  let hash = 0;
  const str = `buzzer_${pin}_salt`;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return hash.toString(36);
}

async function seed() {
  // Seed owner user
  await db.collection('users').add({
    name: 'Denish',
    phone: '9999999999',
    pin_hash: hashPin('1234'),
    role: 'owner',
    fcm_token: '',
    last_seen_at: 0,
    is_active: true,
  });
  console.log('✓ Owner user created (Denish / 9999999999 / PIN: 1234)');

  // Seed manager
  await db.collection('users').add({
    name: 'Office Manager',
    phone: '8888888888',
    pin_hash: hashPin('1234'),
    role: 'manager',
    fcm_token: '',
    last_seen_at: 0,
    is_active: true,
  });
  console.log('✓ Manager user created');

  // Seed default reasons
  const reasons = [
    'Guest at reception',
    'Urgent client call',
    'Client on hold',
    'Need you at my desk',
    'Come to cabin',
    'Urgent — call me now',
  ];

  for (let i = 0; i < reasons.length; i++) {
    await db.collection('reasons').add({
      label: reasons[i],
      sort_order: i,
      is_active: true,
    });
  }
  console.log(`✓ ${reasons.length} default reasons created`);

  console.log('\nDone! Default PIN for all users is: 1234');
}

seed().catch(console.error);

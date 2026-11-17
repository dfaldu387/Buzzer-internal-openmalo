import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, getDocs } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyA1RD_G1LgivaWCT8DyGIOCZc-AFAQ9BRY',
  projectId: 'buzzer-5936f',
  storageBucket: 'buzzer-5936f.firebasestorage.app',
  messagingSenderId: '757981698802',
  appId: '1:757981698802:android:27932ef30736a8eba44e6b',
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

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
  // Check if already seeded
  const usersSnap = await getDocs(collection(db, 'users'));
  if (!usersSnap.empty) {
    console.log(`Database already has ${usersSnap.size} users. Skipping seed.`);
    process.exit(0);
  }

  const users = [
    { name: 'Denish', phone: '9999999999', role: 'owner' },
    { name: 'Heena', phone: '9016642910', role: 'manager' },
    { name: 'Priya', phone: '8888888888', role: 'manager' },
    { name: 'Rahul', phone: '7777777777', role: 'member' },
    { name: 'Sneha', phone: '6666666666', role: 'member' },
    { name: 'Amit', phone: '5555555555', role: 'member' },
    { name: 'Kavita', phone: '4444444444', role: 'member' },
    { name: 'Vikram', phone: '3333333333', role: 'member' },
    { name: 'Meena', phone: '2222222222', role: 'member' },
  ];

  for (const u of users) {
    await addDoc(collection(db, 'users'), {
      name: u.name,
      phone: u.phone,
      pin_hash: hashPin('1234'),
      role: u.role,
      fcm_token: '',
      last_seen_at: 0,
      is_active: true,
    });
    console.log(`  + User: ${u.name} (${u.phone}) [${u.role}]`);
  }

  const reasons = [
    'Guest at reception',
    'Urgent client call',
    'Client on hold',
    'Need you at my desk',
    'Come to cabin',
    'Urgent — call me now',
  ];

  for (let i = 0; i < reasons.length; i++) {
    await addDoc(collection(db, 'reasons'), {
      label: reasons[i],
      sort_order: i,
      is_active: true,
    });
    console.log(`  + Reason: ${reasons[i]}`);
  }

  console.log('\nDone! All users have PIN: 1234');
  process.exit(0);
}

seed().catch(err => { console.error('Seed failed:', err); process.exit(1); });

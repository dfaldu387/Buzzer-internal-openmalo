import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc } from 'firebase/firestore';

const app = initializeApp({
  apiKey: 'AIzaSyA1RD_G1LgivaWCT8DyGIOCZc-AFAQ9BRY',
  projectId: 'buzzer-5936f',
  storageBucket: 'buzzer-5936f.firebasestorage.app',
  messagingSenderId: '757981698802',
  appId: '1:757981698802:android:27932ef30736a8eba44e6b',
});

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

await addDoc(collection(db, 'users'), {
  name: 'Kishan',
  phone: '7990785964',
  pin_hash: hashPin('1234'),
  role: 'member',
  fcm_token: '',
  last_seen_at: 0,
  is_active: true,
});
console.log('+ User: Kishan (7990785964) [member] added');
process.exit(0);

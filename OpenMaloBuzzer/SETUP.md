# Buzzer — Setup Guide

## Prerequisites
- Node.js 18+
- React Native CLI (`npx @react-native-community/cli`)
- Android Studio with SDK 34+
- Firebase project

## 1. Firebase Setup

### Create Firebase Project
1. Go to [Firebase Console](https://console.firebase.google.com)
2. Create a new project called "Buzzer"
3. Enable **Firestore Database** (start in test mode)
4. Enable **Cloud Messaging (FCM)**

### Add Android App
1. In Firebase Console → Project Settings → Add App → Android
2. Package name: `com.buzzerapp`
3. Download `google-services.json`
4. Place it in: `android/app/google-services.json`

### Deploy Cloud Functions
```bash
cd firebase/functions
npm install
cd ..
firebase deploy --only functions,firestore:rules
```

### Seed Initial Data
```bash
cd firebase
export GOOGLE_APPLICATION_CREDENTIALS="path/to/your-service-account-key.json"
node seed.js
```

This creates:
- **Owner**: Denish (phone: 9999999999, PIN: 1234)
- **Manager**: Office Manager (phone: 8888888888, PIN: 1234)
- 6 default buzz reasons

## 2. Run the App

```bash
# Install dependencies (already done)
npm install

# Start Metro bundler
npx react-native start

# Run on Android device/emulator
npx react-native run-android
```

## 3. Custom Buzz Sound

Place your alarm sound file at:
```
android/app/src/main/res/raw/buzz_alarm.mp3
```
- Keep it short (~3 seconds)
- It will loop up to 15 seconds until answered
- Use a distinct, alarm-style sound

## 4. Battery Optimization (Critical for Indian OEM devices)

The app prompts users on first launch to disable battery optimization.
For Xiaomi/Redmi/Vivo/Oppo/Realme, users must also:

1. Go to Settings → Apps → Buzzer → Battery → Unrestricted
2. On MIUI: Settings → Battery → App Battery Saver → Buzzer → No Restrictions
3. On Vivo/Oppo: Settings → Battery → High Power Consumption → Enable for Buzzer

## 5. Testing Checklist

Per the spec (Section 8), verify:
- [ ] Buzz in 2 taps from app open
- [ ] Phone buzzes within 3 seconds, on alarm stream, phone on silent, screen locked
- [ ] Response reaches sender within 2 seconds
- [ ] 60s no-response triggers re-buzz; 120s shows "No response" + Call button
- [ ] Works after overnight Doze mode (battery optimization disabled)
- [ ] Cold start to home grid under 2 seconds

Test on: Xiaomi/Redmi, Samsung, Realme/Vivo

## Project Structure

```
Buzzer/
├── App.tsx                      # Main app entry + screen routing
├── index.js                     # RN registration + background handlers
├── src/
│   ├── types/index.ts           # TypeScript types (User, Buzz, Reason)
│   ├── constants/index.ts       # Config constants
│   ├── hooks/
│   │   ├── useAuth.ts           # Auth state + presence
│   │   ├── useUsers.ts          # Real-time user list
│   │   └── useReasons.ts        # Real-time reason list
│   ├── services/
│   │   ├── firebase.ts          # All Firestore + FCM operations
│   │   ├── auth.ts              # Login/logout/PIN hashing
│   │   ├── notification.ts      # Notifee channel + display
│   │   ├── backgroundHandler.ts # FCM background + notification actions
│   │   └── batteryOptimization.ts
│   └── screens/
│       ├── LoginScreen.tsx      # Phone + PIN login
│       ├── HomeScreen.tsx       # People grid + recent strip
│       ├── BuzzSheet.tsx        # Reason selection + send + live status
│       ├── IncomingBuzzScreen.tsx # Full-screen buzz with Ack/5min/Busy
│       ├── SettingsScreen.tsx   # User mgmt + reason editing (owner only)
│       └── HistoryScreen.tsx    # 7-day buzz log (owner/manager)
├── firebase/
│   ├── functions/index.js       # Cloud Functions (FCM send + re-buzz)
│   ├── firestore.rules          # Security rules
│   └── seed.js                  # Initial data seeder
└── android/                     # Native Android config
```

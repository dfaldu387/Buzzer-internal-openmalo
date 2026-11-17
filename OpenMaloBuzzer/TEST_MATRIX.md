# Buzzer — App State & Dormancy Test Matrix

## App-Specific Assumptions (derived from codebase audit)

| Subsystem | Implementation detail relevant to testing |
|---|---|
| **Auth** | Phone+PIN login. User JSON stored in AsyncStorage (`@buzzer_user`). Supabase client uses `persistSession: false` / `autoRefreshToken: false` — there is **no session token or JWT that expires**. The Supabase anon key is hard-coded. Auth is effectively permanent once stored. |
| **FCM push** | FCM token saved in `user_tokens` table. Refreshed on every foreground resume (`useAuth`), on token rotation (`onTokenRefresh`), and every 1 h by `BuzzerService`. A `TokenRefreshWorker` (WorkManager, every 6 h) is the last-resort background refresh. |
| **Polling** | Android `BuzzerService` polls Supabase REST every 10 s for pending buzzes. This is the fallback when FCM doesn't arrive. |
| **Service lifecycle** | `BuzzerService` is `START_STICKY`, `stopWithTask=false`. On task-removed or destroy it schedules an `AlarmManager` restart. `BootReceiver` restarts it after reboot. |
| **Realtime** | Supabase Realtime websocket for live buzz subscription (foreground only). |
| **Local cache** | Module-level caches in `useUsers`, `useReasons`, `useGroups` hooks — survive navigating between screens but **not** process death. |
| **Notification channels** | `buzzer_visual` (heads-up, no sound), `buzzer_alerts` (alarm sound for notifee fallback), `buzzer_voicemail`. Created by `BuzzerService.onCreate()`. |
| **Dedup** | `seenBuzzIds` persisted to SharedPreferences; cleaned up after 5 min. |

---

## Risk-Tier Legend

| Tier | Meaning |
|---|---|
| **P0** | Critical — silent failure means the user **misses a buzz entirely** |
| **P1** | High — degraded experience (delayed alarm, missing notification, stale data) |
| **P2** | Medium — cosmetic or recoverable (loading spinner, cached name wrong) |
| **P3** | Low — unlikely edge case or self-healing |

---

## SECTION 1 — App State Matrix (duration-independent)

### 1.1 Foreground (app active, screen on)

| ID | Test Case | Precondition | Steps | Expected Result | Pass/Fail Criteria | Priority | Platform Note |
|---|---|---|---|---|---|---|---|
| FG-01 | Receive personal buzz while using app | Logged in, HomeScreen visible | Sender sends a buzz to this user | 1. Alarm sound + vibration start within 2 s  2. IncomingBuzzScreen overlay appears  3. Heads-up notification posted | All three within 2 s of FCM receipt | P0 | Android: BuzzerService.showBuzz via onMessage. iOS: notifee + react-native-sound |
| FG-02 | Receive group buzz while using app | Same as FG-01 | Sender sends group buzz to a group containing this user | Same as FG-01 | Same as FG-01 | P0 | — |
| FG-03 | Respond to buzz (Ack) | IncomingBuzzScreen visible | Tap "Ack" | 1. Alarm stops  2. IncomingBuzzScreen dismisses  3. Supabase `buzzes.response` updated to `ack`  4. Sender sees "Coming" within 3 s | Response visible on sender within 3 s (Realtime or poll) | P0 | — |
| FG-04 | Supabase Realtime reconnect | App was backgrounded briefly (< 30 s), now back | Switch to another app then back | Realtime subscription reestablishes; new buzzes still fire INSERT callback | No missed buzz when Realtime reconnects | P1 | — |
| FG-05 | Network loss during active use | App active, Wi-Fi/data toggled off | 1. Toggle airplane mode  2. Sender sends buzz  3. Toggle airplane off after 10 s | Buzz arrives via next poll cycle (≤ 10 s) or queued FCM | Buzz delivered within 20 s of connectivity restore | P1 | — |
| FG-06 | DND mode active | Android DND enabled | Receive buzz | Alarm still plays (AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE, bypassDnd channel) | Sound and vibration override DND | P0 | Android only. iOS: `interruptionLevel: timeSensitive` |

### 1.2 Background (app in memory, screen may be off)

| ID | Test Case | Precondition | Steps | Expected Result | Pass/Fail Criteria | Priority | Platform Note |
|---|---|---|---|---|---|---|---|
| BG-01 | Receive buzz while backgrounded | App backgrounded < 1 min ago | Sender sends buzz | 1. FCM background handler fires  2. BuzzerService.showBuzz starts alarm  3. Heads-up notification + fullScreenIntent | Alarm audible within 3 s | P0 | Android: native BuzzerService. iOS: notifee fallback |
| BG-02 | Receive buzz with screen locked | Screen off, app in background | Sender sends buzz | 1. Screen wakes (FULL_WAKE_LOCK + ACQUIRE_CAUSES_WAKEUP)  2. Full-screen incoming-buzz activity launches  3. Alarm plays | Screen turns on, notification visible on lock screen | P0 | Android: showWhenLocked + turnScreenOn on MainActivity. iOS: fullScreenAction |
| BG-03 | Respond from notification action | Buzz notification showing, app backgrounded | Tap "Ack" action button on notification | 1. BuzzerService ACTION_RESPOND fires  2. Alarm stops  3. Supabase updated | Response recorded, no app crash | P0 | Android: PendingIntent to service. iOS: notifee onBackgroundEvent |
| BG-04 | Multiple buzzes while backgrounded | App backgrounded | Receive 3 buzzes from different senders, 5 s apart | 1. Each gets its own notification  2. Only the latest alarm plays  3. seenBuzzIds dedup prevents double-processing | Exactly 3 notifications, no duplicate alarms | P1 | — |
| BG-05 | Battery saver / Doze mode active | Android Doze engaged (screen off > 30 min) | Sender sends buzz | FCM high-priority message wakes device; BuzzerService alarm fires | Buzz delivered despite Doze | P0 | Android only. FCM `priority: "high"` + `ttl: "0s"` |
| BG-06 | OEM battery restriction (MIUI, One UI, etc.) | App NOT exempted from battery optimization | Sender sends buzz | BuzzerService may have been killed by OEM. TokenRefreshWorker (6 h) should restart it. Meanwhile FCM background handler + notifee fallback delivers. | Buzz delivered via notifee fallback path | P0 | Android OEM-specific. Test on Xiaomi, Samsung, Vivo |
| BG-07 | App swiped from recents | User swipes app from recent apps (≠ force stop) | Sender sends buzz 30 s later | 1. onTaskRemoved schedules restart via AlarmManager  2. BuzzerService restarts within 3-60 s  3. Buzz arrives via FCM or next poll | Alarm fires | P0 | Android: stopWithTask=false + scheduleRestartAlarm. iOS: process suspended, FCM wakes |

### 1.3 Killed (force-stopped or OS-terminated)

| ID | Test Case | Precondition | Steps | Expected Result | Pass/Fail Criteria | Priority | Platform Note |
|---|---|---|---|---|---|---|---|
| KL-01 | Force-stop then receive buzz | Settings → Force Stop app | Sender sends buzz | **Android: FCM will NOT be delivered** (platform restriction). Buzz missed until user manually reopens app. **iOS: APNs still delivers** the notification. | Android: EXPECTED FAILURE — document as known limitation. iOS: notification shown | P0 | This is a known Android platform limitation. Cannot be fixed. |
| KL-02 | OS kills app for memory | Low-memory kill while backgrounded | Simulate via `adb shell am kill com.buzzerapp` | 1. BuzzerService.onDestroy schedules AlarmManager restart  2. Service restarts  3. FCM background handler still registered | Service self-heals within 60 s | P0 | Android: AlarmManager + START_STICKY. iOS: no equivalent, relies on APNs |
| KL-03 | Cold start after kill — pending buzz exists | App was killed, unresponded buzz exists in DB | User opens app manually | 1. App loads  2. `getPendingBuzz()` checks for pending buzzes  3. IncomingBuzzScreen shows if buzz < 2 min old | Pending buzz shown on launch | P1 | — |
| KL-04 | Cold start — auth restoration | App killed, user was logged in | Open app | `getStoredUser()` reads AsyncStorage → user restored without re-login | No login screen shown | P0 | AsyncStorage survives process death on both platforms |
| KL-05 | Cold start — BuzzerService recovery | App killed, then reopened | Open app | `BuzzerService.startService(userId)` called from App.tsx useEffect. Polling and FCM token refresh resume. | Service running, heartbeat updating | P1 | — |
| KL-06 | Reboot device | Phone powered off and on | Boot completes | BootReceiver fires → BuzzerService.ACTION_START with saved userId → service running | Service active after boot | P0 | Android: BOOT_COMPLETED + QUICKBOOT. iOS: no boot receiver, app must be opened |

---

## SECTION 2 — Dormancy Duration Matrix

### 2.1 After 1 Day

| ID | Test Case | What may have changed | Steps | Expected Result | Priority |
|---|---|---|---|---|---|
| D1-01 | Auth still valid | Nothing — AsyncStorage persists, no JWT expiry | Open app | User auto-logged-in, HomeScreen shown | P0 |
| D1-02 | FCM token still valid | Token < 1 day old — no rotation expected | Send buzz | FCM delivered normally | P0 |
| D1-03 | BuzzerService still alive (Android) | OEM may have killed it overnight | Open app → `checkAndRecoverService()` | Service restarted if dead; health check succeeds after restart | P1 |
| D1-04 | Cached users/reasons stale | Module-level caches lost (process likely killed overnight) | Open app → navigate to People tab | Loading spinner briefly, then fresh data | P2 |
| D1-05 | Supabase Realtime reconnect | Websocket certainly dead | Open app, wait for buzz | Realtime subscription recreated on mount; buzz delivered via Realtime or poll | P1 |

### 2.2 After 1 Week

| ID | Test Case | What may have changed | Steps | Expected Result | Priority |
|---|---|---|---|---|---|
| D7-01 | Auth still valid | Same as 1-day — no expiry mechanism | Open app | Auto-login | P0 |
| D7-02 | FCM token may have rotated | Firebase rotates tokens periodically (days-weeks) | Open app | `useAuth` calls `refreshFcmToken` → new token upserted to `user_tokens` | P0 |
| D7-03 | `user_tokens.fcm_token_stale` set | If token rotated while app was dormant, sender's push bounced and marked stale | Send buzz to this user from another device | 1. Push fails (stale token)  2. User opens app → token refreshed → stale cleared  3. Next buzz works | P0 |
| D7-04 | BuzzerService dead, TokenRefreshWorker running | WorkManager should have run every 6 h | Check via `adb shell dumpsys jobscheduler` | Worker ran, token refreshed, service restarted if dead | P1 |
| D7-05 | SharedPreferences `seenBuzzIds` stale | All entries > 5 min are purged on poll cycle | Open app | Clean seenBuzzIds — no false dedup | P3 |
| D7-06 | Battery exemption revoked by user | User changed battery settings during the week | Open app | `promptBatteryOptimization()` fires on login, prompts again | P1 |

### 2.3 After 1 Month

| ID | Test Case | What may have changed | Steps | Expected Result | Priority |
|---|---|---|---|---|---|
| D30-01 | Auth still valid | AsyncStorage still persists | Open app | Auto-login | P0 |
| D30-02 | Android app hibernation (API 31+) | OS may have auto-hibernated the app: permissions revoked, jobs cancelled, cached data cleared | Open app | 1. POST_NOTIFICATIONS permission may need re-grant  2. SCHEDULE_EXACT_ALARM may be revoked  3. App must re-request permissions | P0 |
| D30-03 | FCM token expired | Firebase may have invalidated the token after ~4 weeks of inactivity | Open app | `refreshFcmToken` gets a new token, upserts it. Old push attempts already marked stale. | P0 |
| D30-04 | WorkManager jobs cancelled | Hibernation cancels periodic work | Open app | `TokenRefreshWorker` re-enqueued via normal app startup path? **RISK: No code re-enqueues it on cold start.** | P0 |
| D30-05 | Notification channels reset | Some OEMs clear channels on hibernation | Open app | `BuzzerService.onCreate()` calls `createBuzzChannel()`, `createBuzzVisualChannel()`, `createVoiceMailChannel()` — recreated | P1 |
| D30-06 | OS update occurred during dormancy | Android or iOS major version upgrade | Open app | App should still function; manifest permissions and service declarations still valid | P1 |
| D30-07 | User data changed server-side | Other users added/removed, reasons changed | Open app | Fresh fetch from Supabase replaces empty caches | P2 |

### 2.4 After 1 Year

| ID | Test Case | What may have changed | Steps | Expected Result | Priority |
|---|---|---|---|---|---|
| D365-01 | Auth still valid | AsyncStorage persists across OS updates | Open app | Auto-login — **unless app was uninstalled or data cleared by OS** | P1 |
| D365-02 | FCM token completely expired | Google invalidates tokens after extended inactivity | Open app → receive buzz | New token issued on `getToken()`, upserted. Previous token was stale for months. | P0 |
| D365-03 | App version mismatch | New version released on Play Store / App Store | Open app (old version) | If Supabase schema changed, old queries may fail. **No schema migration or version-check mechanism exists in the codebase.** | P0 |
| D365-04 | Supabase API key rotated | Anon key may have been rotated server-side | Open app | All Supabase calls fail with 401. User sees errors. **No fallback or re-auth mechanism.** | P0 |
| D365-05 | User account deactivated server-side | Admin set `is_active: false` | Open app | `getStoredUser()` returns cached (stale) user. App tries to operate but buzzes won't be sent to this user. **No server-side validation on stored auth.** | P1 |
| D365-06 | Android auto-app-archive | Android 15+ may archive unused apps | Tap icon | App re-downloads, data may or may not persist (depends on `allowBackup` — currently `false`) | P1 |

### 2.5 Extended Long-Term (> 1 Year)

| ID | Test Case | What may have changed | Steps | Expected Result | Priority |
|---|---|---|---|---|---|
| DLT-01 | PIN hash migration | Legacy DJB2 hashes may still be in DB | User tries to login | `auth.ts` login checks for `v2:` prefix, auto-migrates to SHA-256 on success | P2 |
| DLT-02 | React Native version incompatibility | RN 0.87 may be obsolete; native APIs changed | Open app on latest OS | Runtime crashes possible if deprecated APIs removed by new OS version | P1 |
| DLT-03 | Supabase Realtime protocol change | Realtime v2 endpoint may be deprecated | Open app | Websocket connection fails silently. Polling fallback (10 s) still works. | P1 |
| DLT-04 | APNs/FCM certificate expiry | Push certs on server expired | Receive buzz | Push silently fails. Android: polling still works. iOS: no buzz delivery until cert renewed. | P0 |

---

## SECTION 3 — Cross-Cutting Edge Cases

| ID | Test Case | Precondition | Steps | Expected Result | Priority | Platform |
|---|---|---|---|---|---|---|
| EC-01 | Network unavailable on cold start | Airplane mode on | Open app | 1. `getStoredUser()` succeeds (local)  2. BuzzerService starts  3. Polling fails silently  4. UI shows cached data or empty states  5. No crash | P1 | Both |
| EC-02 | Network restored mid-session | App open in airplane mode | Toggle airplane off | 1. Realtime reconnects  2. Polling resumes  3. Any queued FCM delivered | P1 | Both |
| EC-03 | App update during dormancy (Android) | User had v1.0, auto-updated to v2.0 while app unused | Open app | 1. AsyncStorage data intact  2. SharedPreferences intact  3. New notification channels created  4. Old channels migrated if needed | P1 | Android |
| EC-04 | App update during dormancy (iOS) | Same | Open app | 1. AsyncStorage data intact  2. Keychain data intact  3. Push token may need refresh | P1 | iOS |
| EC-05 | Low storage — AsyncStorage write fails | Device storage full | Login attempt | `storeUser()` throws → login appears to succeed but user won't persist. Next cold start shows login screen. | P2 | Both |
| EC-06 | Time zone change | User traveled to different timezone | Open app | `Date.now()` still correct (UTC). Buzz `created_at` comparisons (120 s timeout) unaffected. | P3 | Both |
| EC-07 | Duplicate FCM delivery | FCM delivers same message twice | Receive same buzz_id twice | `isBuzzSeen()` returns true on second delivery → no duplicate alarm or notification | P1 | Both |
| EC-08 | BuzzerService crash loop | Service crashes repeatedly | Service restarts via AlarmManager with exponential backoff (3s, 10s, 30s, 60s) | Restart attempts cap at 60 s delay. No device battery drain from tight loop. | P1 | Android |
| EC-09 | Notification permission revoked | User revoked POST_NOTIFICATIONS in Settings | Receive buzz | Android: alarm still plays (MediaPlayer doesn't need notification permission), but no visual notification. User confused. | P1 | Android 13+ |
| EC-10 | Full-screen intent permission revoked | Android 14+ can revoke USE_FULL_SCREEN_INTENT | Receive buzz while screen locked | Full-screen intent degrades to heads-up (which works on `buzzer_visual` channel) | P1 | Android 14+ |

---

## SECTION 4 — State × Duration Risk Heat Map

Rows = app state when buzz is sent. Columns = time since last app open.

| | 1 Day | 1 Week | 1 Month | 1 Year | Long-Term |
|---|---|---|---|---|---|
| **Foreground** | P2 (cache cold) | N/A (can't be FG for a week) | N/A | N/A | N/A |
| **Background** | P1 (OEM kill overnight) | P0 (FCM token rotation) | P0 (hibernation) | N/A (OS killed long ago) | N/A |
| **Killed — OS** | P1 (self-heals via AlarmManager) | P0 (token stale, no WorkManager) | P0 (hibernated, perms revoked) | P0 (token dead, possible schema drift) | P0 (certs expired, RN deprecated) |
| **Killed — Force Stop** | P0 (no FCM until reopen) | P0 (no FCM, token stale) | P0 (no FCM, hibernated) | P0 (everything broken) | P0 (everything broken) |

**Highest-risk scenarios (immediate attention):**

1. **D30-04** — `TokenRefreshWorker` is NOT re-enqueued on cold start. If Android hibernation cancels the periodic work, it stays cancelled until the code that originally enqueued it runs again — but that code only runs once. After 1 month of dormancy, the worker is gone and the service has no periodic revival mechanism.

2. **KL-01** — Force-stop completely blocks FCM on Android. No workaround exists at the app level. This must be documented to users.

3. **D365-03 / D365-04** — No app version check or API key rotation handling. A breaking Supabase schema change or key rotation will silently break every dormant client.

4. **D30-02** — Android 12+ auto-hibernation revokes permissions. The app re-requests `POST_NOTIFICATIONS` on start, but does NOT re-request `SCHEDULE_EXACT_ALARM` or check if battery exemption was revoked.

5. **D365-05** — Stale local auth after server-side account deactivation. `getStoredUser()` trusts AsyncStorage with no server validation, so a deactivated user appears logged in.

---

## SECTION 5 — Reproducibility Guide

### How to simulate each app state

| State | Android | iOS |
|---|---|---|
| Foreground | App visibly open | App visibly open |
| Background | Press Home or switch apps | Press Home or switch apps |
| Killed — OS | `adb shell am kill com.buzzerapp` | Xcode → Debug → Simulate Memory Warning, then background |
| Killed — Force Stop | Settings → Apps → Force Stop | Swipe up from app switcher |
| Killed — after reboot | `adb reboot` | Power off/on |

### How to simulate dormancy durations

| Duration | Technique |
|---|---|
| 1 day | Set device clock forward 24 h. Or: actually wait 24 h with device idle on a shelf. |
| 1 week | Set clock forward 7 days. Verify FCM token age via `adb logcat -s BuzzerService TokenRefreshWorker`. |
| 1 month | Set clock forward 30 days. On Android 12+, also run: `adb shell cmd app_hibernation set-state com.buzzerapp true` to simulate hibernation. |
| 1 year | Set clock forward 365 days. Revoke permissions manually. Clear FCM token from Supabase `user_tokens` to simulate expiry. |
| Long-term | Combine 1-year simulation with: Supabase schema change, API key rotation, OS upgrade (test on next major version emulator). |

### ADB commands for verification

```bash
# Check BuzzerService health
adb shell dumpsys activity services com.buzzerapp/.BuzzerService

# Check SharedPreferences
adb shell run-as com.buzzerapp cat /data/data/com.buzzerapp/shared_prefs/buzzer_prefs.xml

# Check WorkManager jobs
adb shell dumpsys jobscheduler | grep -A 5 buzzerapp

# Check notification channels
adb shell dumpsys notification | grep -A 3 openmalo

# Check battery optimization status
adb shell dumpsys deviceidle whitelist | grep buzzerapp

# Check if app is hibernated (Android 12+)
adb shell cmd app_hibernation get-state com.buzzerapp

# Simulate low memory kill
adb shell am kill com.buzzerapp

# Check FCM token staleness (via Logcat)
adb logcat -s BuzzerService:D TokenRefreshWorker:D | grep -i token
```

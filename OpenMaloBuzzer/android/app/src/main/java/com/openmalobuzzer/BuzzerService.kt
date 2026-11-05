package com.openmalobuzzer

import android.app.*
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.net.ConnectivityManager
import android.net.Network
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.text.SpannableString
import android.text.style.ForegroundColorSpan
import android.util.Log
import androidx.core.app.NotificationCompat
import com.google.firebase.messaging.FirebaseMessaging
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

class BuzzerService : Service() {

    companion object {
        const val TAG = "BuzzerService"
        const val CHANNEL_ID = "buzzer_service_channel"
        const val NOTIFICATION_ID = 1001
        const val RESTART_REQUEST_CODE = 9999
        const val ACTION_START = "com.openmalobuzzer.START_SERVICE"
        const val ACTION_STOP = "com.openmalobuzzer.STOP_SERVICE"
        const val ACTION_STOP_ALARM = "com.openmalobuzzer.STOP_ALARM"
        const val ACTION_RESPOND = "com.openmalobuzzer.RESPOND"
        const val ACTION_SHOW_BUZZ = "com.openmalobuzzer.SHOW_BUZZ"
        const val EXTRA_USER_ID = "user_id"
        const val EXTRA_BUZZ_ID = "buzz_id"
        const val EXTRA_RESPONSE = "response"
        const val EXTRA_FROM_USER_ID = "from_user_id"
        const val EXTRA_FROM_USER_NAME = "from_user_name"
        const val EXTRA_REASON = "reason"
        const val EXTRA_NOTE = "note"
        const val EXTRA_SOUND_ID = "sound_id"
        const val BUZZ_CHANNEL_ID = "openmalo_buzz"
        const val BUZZ_VISUAL_CHANNEL_ID = "openmalo_buzz_visual"
        const val VOICEMAIL_CHANNEL_ID = "openmalo_voicemail"
        const val PREFS_NAME = "buzzer_prefs"
        const val PREF_USER_ID = "active_user_id"
        const val PREF_LAST_HEARTBEAT = "last_heartbeat"
        const val PREF_ACTIVE_BUZZ_ID = "active_buzz_id"
        const val PREF_ACTIVE_BUZZ_FROM = "active_buzz_from"
        const val PREF_ACTIVE_BUZZ_REASON = "active_buzz_reason"
        const val PREF_ACTIVE_BUZZ_NOTE = "active_buzz_note"
        const val PREF_ACTIVE_BUZZ_SOUND = "active_buzz_sound"
        const val POLL_INTERVAL_MS = 10000L
        const val FCM_TOKEN_REFRESH_MS = 3600000L
        const val WATCHDOG_INTERVAL_MS = 15 * 60 * 1000L // 15 minutes
        const val WATCHDOG_REQUEST_CODE = 9998
        val RESTART_RETRY_DELAYS = longArrayOf(3000L, 10000L, 30000L, 60000L)

        /** Check if service has been alive recently (heartbeat within last 30s). */
        fun isServiceHealthy(context: Context): Boolean {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val lastHeartbeat = prefs.getLong(PREF_LAST_HEARTBEAT, 0)
            return System.currentTimeMillis() - lastHeartbeat < 30000
        }
    }

    private var wakeLock: PowerManager.WakeLock? = null
    private var alarmWakeLock: PowerManager.WakeLock? = null
    private var mediaPlayer: MediaPlayer? = null
    private var fallbackMediaPlayer: MediaPlayer? = null // STREAM_MUSIC fallback for DND bypass
    private var vibrator: Vibrator? = null
    private var isAlarming = false
    private var originalAlarmVolume: Int = -1
    private var originalMusicVolume: Int = -1
    private var originalRingerMode: Int = -1
    private var originalDndMode: Int = -1
    private var audioFocusRequest: Any? = null // AudioFocusRequest on O+
    private var activeBuzzId: String? = null
    private var activeSoundId: String = "buzz_alarm"
    private val seenBuzzIds = java.util.Collections.synchronizedSet(mutableSetOf<String>())
    private val seenLock = Object() // guards atomic check-then-mark to prevent race duplicates
    private val handler = Handler(Looper.getMainLooper())
    private var connectivityCallback: ConnectivityManager.NetworkCallback? = null
    private var networkWasLost = false
    private var lastNetworkAvailableMs: Long = System.currentTimeMillis()

    // Persistent dedup: survives process restart. Key = buzzId, value = timestamp when seen.
    // Cleaned up on every poll cycle to avoid unbounded growth.
    private fun markBuzzSeen(buzzId: String) {
        seenBuzzIds.add(buzzId)
        try {
            val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val json = prefs.getString("seen_buzz_ids", "{}") ?: "{}"
            val map = JSONObject(json)
            map.put(buzzId, System.currentTimeMillis())
            prefs.edit().putString("seen_buzz_ids", map.toString()).apply()
        } catch (e: Exception) {
            Log.w(TAG, "Failed to persist seen buzzId: ${e.message}")
        }
    }

    private fun isBuzzSeen(buzzId: String): Boolean {
        if (seenBuzzIds.contains(buzzId)) return true
        try {
            val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val json = prefs.getString("seen_buzz_ids", "{}") ?: "{}"
            val map = JSONObject(json)
            if (map.has(buzzId)) {
                seenBuzzIds.add(buzzId) // re-hydrate in-memory set
                return true
            }
        } catch (_: Exception) {}
        return false
    }

    private fun cleanupOldSeenBuzzIds() {
        try {
            val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val json = prefs.getString("seen_buzz_ids", "{}") ?: "{}"
            val map = JSONObject(json)
            val cutoff = System.currentTimeMillis() - 300000 // 5 minutes
            val keysToRemove = mutableListOf<String>()
            val keys = map.keys()
            while (keys.hasNext()) {
                val key = keys.next()
                if (map.optLong(key, 0) < cutoff) keysToRemove.add(key)
            }
            keysToRemove.forEach { map.remove(it) }
            if (keysToRemove.isNotEmpty()) {
                prefs.edit().putString("seen_buzz_ids", map.toString()).apply()
            }
        } catch (_: Exception) {}
    }
    private var currentUserId: String? = null
    private var restartAttempt = 0
    private val userNameCache = mutableMapOf<String, String>()

    private var watchdogCounter = 0
    private val pollRunnable = object : Runnable {
        override fun run() {
            currentUserId?.let { pollForBuzzes(it) }
            // Write heartbeat so the app can detect if the service was killed by OEM
            getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit().putLong(PREF_LAST_HEARTBEAT, System.currentTimeMillis()).apply()
            // Re-schedule watchdog every ~5 minutes (every 30 poll cycles) to keep the
            // alarm chain alive even if the service is about to be killed.
            watchdogCounter++
            if (watchdogCounter >= 30) {
                watchdogCounter = 0
                scheduleWatchdog()
            }
            handler.postDelayed(this, POLL_INTERVAL_MS)
        }
    }

    private val fcmTokenRefreshRunnable = object : Runnable {
        override fun run() {
            currentUserId?.let { refreshFcmToken(it) }
            handler.postDelayed(this, FCM_TOKEN_REFRESH_MS)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createServiceChannel()
        createBuzzChannel()
        createBuzzVisualChannel()
        createVoiceMailChannel()
        acquireWakeLock()
        registerNetworkCallback()
        vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val vm = getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
            vm.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action

        if (action == ACTION_STOP) {
            stopAlarm()
            cancelActiveBuzzNotification()
            stopPolling()
            clearSavedUserId()
            cancelRestartAlarm()
            cancelWatchdog()
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }

        if (action == ACTION_STOP_ALARM) {
            stopAlarm()
            cancelActiveBuzzNotification()
            activeBuzzId = null
            clearActiveBuzz()
            return START_STICKY
        }

        if (action == ACTION_RESPOND) {
            val buzzId = intent?.getStringExtra(EXTRA_BUZZ_ID)
            val response = intent?.getStringExtra(EXTRA_RESPONSE)
            if (buzzId != null && response != null) {
                Log.d(TAG, "Responding to $buzzId with $response")
                stopAlarm()
                respondToBuzzSupabase(buzzId, response)
                cancelAllNotificationsForBuzz(buzzId)
                if (activeBuzzId == buzzId) activeBuzzId = null
                clearActiveBuzz()
            }
            return START_STICKY
        }

        if (action == ACTION_SHOW_BUZZ) {
            // Ensure service is in foreground (needed if service was just started from dead state)
            acquireWakeLock()
            val fgNotification = buildNotification()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                startForeground(NOTIFICATION_ID, fgNotification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
            } else {
                startForeground(NOTIFICATION_ID, fgNotification)
            }

            // Start polling if not already running
            val savedUserId = getSavedUserId()
            if (savedUserId != null && currentUserId != savedUserId) {
                Log.d(TAG, "Starting polling from SHOW_BUZZ for userId: $savedUserId")
                currentUserId = savedUserId
                preloadUserNames()
                startPolling()
                cancelRestartAlarm()
            }

            val buzzId = intent?.getStringExtra(EXTRA_BUZZ_ID)
            val fromUserId = intent?.getStringExtra(EXTRA_FROM_USER_ID) ?: ""
            val fromUserName = intent?.getStringExtra(EXTRA_FROM_USER_NAME)
            val reason = intent?.getStringExtra(EXTRA_REASON) ?: ""
            val note = intent?.getStringExtra(EXTRA_NOTE)?.let { if (it.isEmpty() || it == "null") null else it }
            val soundId = intent?.getStringExtra(EXTRA_SOUND_ID) ?: "buzz_alarm"
            val firstSeen = if (buzzId != null) synchronized(seenLock) {
                if (isBuzzSeen(buzzId)) false else { markBuzzSeen(buzzId); true }
            } else false
            if (buzzId != null && firstSeen) {
                val t7 = System.currentTimeMillis()
                Log.d(TAG, "[T7] Buzz processing start: $buzzId at $t7")
                // Cache sender name from FCM data so notification shows instantly
                if (!fromUserName.isNullOrEmpty() && fromUserName != "User") {
                    userNameCache[fromUserId] = fromUserName
                }
                stopAlarm()
                activeBuzzId = buzzId
                activeSoundId = soundId
                saveActiveBuzz(buzzId, fromUserId, reason, note)
                showBuzzNotification(buzzId, fromUserId, reason, note)
                Log.d(TAG, "[T9] Notification posted: $buzzId at ${System.currentTimeMillis()} (+${System.currentTimeMillis() - t7}ms)")
                startAlarm()
                Log.d(TAG, "[T8] Alarm started: $buzzId at ${System.currentTimeMillis()} (+${System.currentTimeMillis() - t7}ms)")
                handler.postDelayed({
                    if (activeBuzzId == buzzId) {
                        Log.d(TAG, "Auto-dismissing buzz $buzzId after 2 min timeout")
                        stopAlarm()
                        cancelAllNotificationsForBuzz(buzzId)
                        activeBuzzId = null
                        clearActiveBuzz()
                        respondToBuzzSupabase(buzzId, "dismissed")
                    }
                }, 120000)
            }
            return START_STICKY
        }

        val userId = intent?.getStringExtra(EXTRA_USER_ID) ?: getSavedUserId()
        if (userId == null) {
            stopSelf()
            return START_NOT_STICKY
        }

        if (action == ACTION_START) {
            saveUserId(userId)
            restartAttempt = 0
        }

        // Re-acquire WakeLock on every start to ensure polling stays alive
        acquireWakeLock()

        val notification = buildNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }

        if (currentUserId != userId) {
            Log.d(TAG, "Starting polling for userId: $userId")
            currentUserId = userId
            seenBuzzIds.clear()
            preloadUserNames()
            startPolling()
            refreshFcmToken(userId)
            cancelRestartAlarm()
            scheduleWatchdog()
        }

        // Recover active buzz after process death — re-trigger alarm if the
        // buzz was still active when the service was killed.
        if (activeBuzzId == null) {
            val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val savedBuzzId = prefs.getString(PREF_ACTIVE_BUZZ_ID, null)
            if (savedBuzzId != null) {
                val savedFrom = prefs.getString(PREF_ACTIVE_BUZZ_FROM, "") ?: ""
                val savedReason = prefs.getString(PREF_ACTIVE_BUZZ_REASON, "") ?: ""
                val savedNote = prefs.getString(PREF_ACTIVE_BUZZ_NOTE, null)
                val savedSound = prefs.getString(PREF_ACTIVE_BUZZ_SOUND, "buzz_alarm") ?: "buzz_alarm"
                activeSoundId = savedSound
                Log.d(TAG, "Recovering active buzz after restart: $savedBuzzId (sound=$savedSound)")
                // Verify the buzz is still unanswered on the server before
                // replaying. Without this check, a buzz that was already
                // responded to (but process killed before clearActiveBuzz)
                // would alarm again for up to 2 minutes.
                Thread {
                    try {
                        val json = supabaseGet("buzzes?id=eq.$savedBuzzId&select=response")
                        if (json == null) {
                            // Network failed — replay anyway, same as catch block
                            Log.w(TAG, "Network unavailable for recovered buzz verification — replaying $savedBuzzId")
                            handler.post {
                                seenBuzzIds.remove(savedBuzzId)
                                activeBuzzId = savedBuzzId
                                showBuzzNotification(savedBuzzId, savedFrom, savedReason, savedNote)
                                startAlarm()
                                handler.postDelayed({
                                    if (activeBuzzId == savedBuzzId) {
                                        Log.d(TAG, "Auto-dismissing recovered buzz $savedBuzzId after 2 min timeout")
                                        stopAlarm()
                                        cancelAllNotificationsForBuzz(savedBuzzId)
                                        activeBuzzId = null
                                        clearActiveBuzz()
                                        respondToBuzzSupabase(savedBuzzId, "dismissed")
                                    }
                                }, 120000)
                            }
                            return@Thread
                        }
                        val arr = JSONArray(json)
                        if (arr.length() > 0) {
                            val response = arr.getJSONObject(0).optString("response", "none")
                            if (response != "none") {
                                Log.d(TAG, "Recovered buzz $savedBuzzId already has response=$response — skipping alarm")
                                handler.post { clearActiveBuzz() }
                                return@Thread
                            }
                        }
                        // Buzz is still unanswered — replay the alarm
                        handler.post {
                            seenBuzzIds.remove(savedBuzzId)
                            activeBuzzId = savedBuzzId
                            showBuzzNotification(savedBuzzId, savedFrom, savedReason, savedNote)
                            startAlarm()
                            handler.postDelayed({
                                if (activeBuzzId == savedBuzzId) {
                                    Log.d(TAG, "Auto-dismissing recovered buzz $savedBuzzId after 2 min timeout")
                                    stopAlarm()
                                    cancelAllNotificationsForBuzz(savedBuzzId)
                                    activeBuzzId = null
                                    clearActiveBuzz()
                                    respondToBuzzSupabase(savedBuzzId, "dismissed")
                                }
                            }, 120000)
                        }
                    } catch (e: Exception) {
                        Log.e(TAG, "Failed to verify recovered buzz: ${e.message}")
                        // On network failure, replay anyway — better to alarm
                        // for an answered buzz than to miss an unanswered one.
                        handler.post {
                            seenBuzzIds.remove(savedBuzzId)
                            activeBuzzId = savedBuzzId
                            showBuzzNotification(savedBuzzId, savedFrom, savedReason, savedNote)
                            startAlarm()
                            handler.postDelayed({
                                if (activeBuzzId == savedBuzzId) {
                                    Log.d(TAG, "Auto-dismissing recovered buzz $savedBuzzId after 2 min timeout")
                                    stopAlarm()
                                    cancelAllNotificationsForBuzz(savedBuzzId)
                                    activeBuzzId = null
                                    clearActiveBuzz()
                                    respondToBuzzSupabase(savedBuzzId, "dismissed")
                                }
                            }, 120000)
                        }
                    }
                }.start()
            }
        }

        return START_STICKY
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        Log.d(TAG, "Task removed — scheduling restart")
        scheduleRestartAlarm()
        super.onTaskRemoved(rootIntent)
    }

    /** Safely parse created_at — handles both epoch ms (Long) and ISO 8601 strings. */
    private fun parseCreatedAt(buzz: JSONObject): Long {
        return try {
            buzz.getLong("created_at")
        } catch (_: Exception) {
            try {
                val str = buzz.optString("created_at", "")
                if (str.isNotEmpty()) {
                    java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", java.util.Locale.US).apply {
                        timeZone = java.util.TimeZone.getTimeZone("UTC")
                    }.parse(str.replace("Z", "").substringBefore("+").substringBefore(".").let { it })?.time ?: 0L
                } else 0L
            } catch (_: Exception) { 0L }
        }
    }

    // ─── Supabase REST API helpers ─────────────────────────
    private fun supabaseGet(path: String): String? {
        var conn: HttpURLConnection? = null
        try {
            val url = URL("${SupabaseConfig.URL}/rest/v1/$path")
            conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "GET"
            conn.setRequestProperty("apikey", SupabaseConfig.ANON_KEY)
            conn.setRequestProperty("Authorization", "Bearer ${SupabaseConfig.ANON_KEY}")
            conn.connectTimeout = 15000
            conn.readTimeout = 15000

            if (conn.responseCode == 200) {
                val reader = BufferedReader(InputStreamReader(conn.inputStream))
                val response = reader.readText()
                reader.close()
                return response
            }
        } catch (e: Exception) {
            Log.e(TAG, "Supabase GET error: ${e.message}")
        } finally {
            conn?.disconnect()
        }
        return null
    }

    private fun supabasePatch(path: String, body: JSONObject) {
        Thread {
            var conn: HttpURLConnection? = null
            try {
                val url = URL("${SupabaseConfig.URL}/rest/v1/$path")
                conn = url.openConnection() as HttpURLConnection
                conn.requestMethod = "PATCH"
                conn.setRequestProperty("apikey", SupabaseConfig.ANON_KEY)
                conn.setRequestProperty("Authorization", "Bearer ${SupabaseConfig.ANON_KEY}")
                conn.setRequestProperty("Content-Type", "application/json")
                conn.setRequestProperty("Prefer", "return=minimal")
                conn.doOutput = true
                val writer = OutputStreamWriter(conn.outputStream)
                writer.write(body.toString())
                writer.flush()
                writer.close()
                conn.responseCode // trigger the request
            } catch (e: Exception) {
                Log.e(TAG, "Supabase PATCH error: ${e.message}")
            } finally {
                conn?.disconnect()
            }
        }.start()
    }

    private fun supabaseUpsert(table: String, body: JSONObject) {
        Thread {
            var conn: HttpURLConnection? = null
            try {
                val url = URL("${SupabaseConfig.URL}/rest/v1/$table")
                conn = url.openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.setRequestProperty("apikey", SupabaseConfig.ANON_KEY)
                conn.setRequestProperty("Authorization", "Bearer ${SupabaseConfig.ANON_KEY}")
                conn.setRequestProperty("Content-Type", "application/json")
                conn.setRequestProperty("Prefer", "resolution=merge-duplicates,return=minimal")
                conn.doOutput = true
                val writer = OutputStreamWriter(conn.outputStream)
                writer.write(body.toString())
                writer.flush()
                writer.close()
                conn.responseCode
            } catch (e: Exception) {
                Log.e(TAG, "Supabase upsert error: ${e.message}")
            } finally {
                conn?.disconnect()
            }
        }.start()
    }

    // ─── Buzz operations ───────────────────────────────────
    private fun respondToBuzzSupabase(buzzId: String, response: String) {
        val body = JSONObject().apply {
            put("response", response)
            put("responded_at", System.currentTimeMillis())
        }
        supabasePatch("buzzes?id=eq.$buzzId", body)
    }

    private fun pollForBuzzes(userId: String, maxAgeMs: Long = 120000L) {
        Thread {
            try {
                val json = supabaseGet("buzzes?to_user_id=eq.$userId&response=eq.none&select=*") ?: return@Thread
                val arr = JSONArray(json)
                for (i in 0 until arr.length()) {
                    val buzz = arr.getJSONObject(i)
                    val buzzId = buzz.getString("id")
                    val createdAt = parseCreatedAt(buzz)
                    if (createdAt > 0 && System.currentTimeMillis() - createdAt < maxAgeMs) {
                        // Atomic check-then-mark to prevent race with ACTION_SHOW_BUZZ on main thread
                        val firstSeen = synchronized(seenLock) {
                            if (isBuzzSeen(buzzId)) false
                            else { markBuzzSeen(buzzId); true }
                        }
                        if (!firstSeen) continue
                        Log.d(TAG, "[POLL] New buzz detected via poll: $buzzId (age=${System.currentTimeMillis() - createdAt}ms)")
                        val pollFromUserId = buzz.optString("from_user_id", "")
                        val pollReason = buzz.optString("reason", "")
                        val pollNote = buzz.optString("note", null).let { if (it == "null") null else it }
                        val pollSoundId = buzz.optString("sound_id", "buzz_alarm").let { if (it == "null" || it.isEmpty()) "buzz_alarm" else it }
                        handler.post {
                            stopAlarm()
                            activeBuzzId = buzzId
                            activeSoundId = pollSoundId
                            saveActiveBuzz(buzzId, pollFromUserId, pollReason, pollNote)
                            showBuzzNotification(
                                buzzId = buzzId,
                                fromUserId = pollFromUserId,
                                reason = pollReason,
                                note = pollNote
                            )
                            startAlarm()
                            // Auto-stop alarm after 2 minutes and mark as dismissed
                            handler.postDelayed({
                                if (activeBuzzId == buzzId) {
                                    Log.d(TAG, "Auto-dismissing buzz $buzzId after 2 min timeout")
                                    stopAlarm()
                                    cancelAllNotificationsForBuzz(buzzId)
                                    activeBuzzId = null
                                    clearActiveBuzz()
                                    respondToBuzzSupabase(buzzId, "dismissed")
                                }
                            }, 120000)
                        }
                    }
                }
                // Check for responses to active buzzes (cancellation) — only check last 5 minutes
                val since = System.currentTimeMillis() - 300000
                val activeJson = supabaseGet("buzzes?to_user_id=eq.$userId&response=neq.none&created_at=gte.$since&select=id,response,from_user_id") ?: return@Thread
                val activeArr = JSONArray(activeJson)
                for (i in 0 until activeArr.length()) {
                    val buzz = activeArr.getJSONObject(i)
                    val buzzId = buzz.getString("id")
                    val response = buzz.getString("response")
                    if (seenBuzzIds.contains(buzzId)) {
                        val fromUserId = buzz.optString("from_user_id", "")
                        seenBuzzIds.remove(buzzId) // Remove so we don't process again
                        handler.post {
                            stopAlarm()
                            cancelAllNotificationsForBuzz(buzzId)
                            if (activeBuzzId == buzzId) {
                                activeBuzzId = null
                                clearActiveBuzz()
                            }
                            if (response == "cancelled") {
                                showCancelledNotification(buzzId, fromUserId)
                            }
                        }
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Poll failed: ${e.message}")
            }
            if (seenBuzzIds.size > 50) seenBuzzIds.clear()
            cleanupOldSeenBuzzIds()
        }.start()
    }

    private fun preloadUserNames() {
        Thread {
            try {
                val json = supabaseGet("users?is_active=eq.true&select=id,name") ?: return@Thread
                val arr = JSONArray(json)
                for (i in 0 until arr.length()) {
                    val user = arr.getJSONObject(i)
                    userNameCache[user.getString("id")] = user.getString("name")
                }
                Log.d(TAG, "Preloaded ${userNameCache.size} user names")
            } catch (e: Exception) {
                Log.e(TAG, "Failed to preload user names: ${e.message}")
            }
        }.start()
    }

    private fun refreshFcmToken(userId: String) {
        try {
            FirebaseMessaging.getInstance().token
                .addOnSuccessListener { token ->
                    if (token.isNullOrEmpty()) return@addOnSuccessListener
                    Log.d(TAG, "FCM token refreshed, saving to Supabase")
                    val body = JSONObject().apply {
                        put("user_id", userId)
                        put("fcm_token", token)
                        put("fcm_token_stale", false)
                    }
                    supabaseUpsert("user_tokens", body)
                }
                .addOnFailureListener { e ->
                    Log.e(TAG, "Failed to get FCM token: ${e.message}")
                }
        } catch (e: Exception) {
            Log.e(TAG, "refreshFcmToken error: ${e.message}")
        }
    }

    // ─── Polling management ────────────────────────────────
    private fun startPolling() {
        handler.removeCallbacks(pollRunnable)
        handler.post(pollRunnable)
        handler.removeCallbacks(fcmTokenRefreshRunnable)
        handler.postDelayed(fcmTokenRefreshRunnable, FCM_TOKEN_REFRESH_MS)
    }

    private fun stopPolling() {
        handler.removeCallbacks(pollRunnable)
        handler.removeCallbacks(fcmTokenRefreshRunnable)
        currentUserId = null
    }

    // ─── Restart management ────────────────────────────────
    private fun scheduleRestartAlarm() {
        try {
            val userId = getSavedUserId() ?: return
            val delayIndex = restartAttempt.coerceAtMost(RESTART_RETRY_DELAYS.size - 1)
            val delay = RESTART_RETRY_DELAYS[delayIndex]
            restartAttempt++

            val restartIntent = Intent(this, BuzzerService::class.java).apply {
                action = ACTION_START
                putExtra(EXTRA_USER_ID, userId)
            }
            val pendingIntent = PendingIntent.getService(
                this, RESTART_REQUEST_CODE, restartIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            val alarmManager = getSystemService(Context.ALARM_SERVICE) as AlarmManager
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !alarmManager.canScheduleExactAlarms()) {
                alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, System.currentTimeMillis() + delay, pendingIntent)
            } else {
                alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, System.currentTimeMillis() + delay, pendingIntent)
            }
            Log.d(TAG, "Restart scheduled in ${delay}ms (attempt $restartAttempt)")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to schedule restart: ${e.message}")
        }
    }

    private fun cancelRestartAlarm() {
        val restartIntent = Intent(this, BuzzerService::class.java).apply { action = ACTION_START }
        val pendingIntent = PendingIntent.getService(
            this, RESTART_REQUEST_CODE, restartIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_NO_CREATE
        )
        if (pendingIntent != null) {
            (getSystemService(Context.ALARM_SERVICE) as AlarmManager).cancel(pendingIntent)
        }
    }

    /**
     * Periodic watchdog alarm that fires every 15 minutes independently of the service.
     * If the service is dead when it fires, it restarts it. This survives OEM kills
     * because AlarmManager (especially setAndAllowWhileIdle) is more resilient than
     * the service process itself. Each alarm re-schedules the next one, creating a chain.
     */
    private fun scheduleWatchdog() {
        try {
            val userId = getSavedUserId() ?: return
            val watchdogIntent = Intent(this, BuzzerService::class.java).apply {
                action = ACTION_START
                putExtra(EXTRA_USER_ID, userId)
            }
            val pendingIntent = PendingIntent.getService(
                this, WATCHDOG_REQUEST_CODE, watchdogIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            val alarmManager = getSystemService(Context.ALARM_SERVICE) as AlarmManager
            // Use setAndAllowWhileIdle (inexact) — it's allowed without special permissions
            // and is not subject to the exact alarm restrictions on Android 12+.
            // On Android 14+ this has a minimum period of ~15 min which matches our interval.
            alarmManager.setAndAllowWhileIdle(
                AlarmManager.RTC_WAKEUP,
                System.currentTimeMillis() + WATCHDOG_INTERVAL_MS,
                pendingIntent
            )
            Log.d(TAG, "Watchdog alarm scheduled in ${WATCHDOG_INTERVAL_MS / 60000} min")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to schedule watchdog: ${e.message}")
        }
    }

    private fun cancelWatchdog() {
        val watchdogIntent = Intent(this, BuzzerService::class.java).apply { action = ACTION_START }
        val pendingIntent = PendingIntent.getService(
            this, WATCHDOG_REQUEST_CODE, watchdogIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_NO_CREATE
        )
        if (pendingIntent != null) {
            (getSystemService(Context.ALARM_SERVICE) as AlarmManager).cancel(pendingIntent)
        }
    }

    // ─── Network monitoring ────────────────────────────────
    /**
     * Monitors connectivity changes so we can immediately poll for missed buzzes
     * when the device comes back online (e.g., after airplane mode).
     * The normal 2-minute age filter would drop buzzes sent while offline;
     * the recovery poll uses a wider 10-minute window to catch them.
     */
    private fun registerNetworkCallback() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            try {
                val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
                val callback = object : ConnectivityManager.NetworkCallback() {
                    override fun onAvailable(network: Network) {
                        Log.d(TAG, "Network available — wasLost=$networkWasLost")
                        if (networkWasLost) {
                            networkWasLost = false
                            val offlineDurationMs = System.currentTimeMillis() - lastNetworkAvailableMs
                            Log.d(TAG, "Network restored after ${offlineDurationMs / 1000}s offline — triggering recovery poll")
                            // Recovery window: offline duration + 1 min buffer, capped at 10 min
                            val recoveryWindowMs = (offlineDurationMs + 60000L).coerceAtMost(600000L).coerceAtLeast(120000L)
                            handler.post {
                                currentUserId?.let { userId ->
                                    pollForBuzzes(userId, recoveryWindowMs)
                                }
                            }
                        }
                        lastNetworkAvailableMs = System.currentTimeMillis()
                    }

                    override fun onLost(network: Network) {
                        Log.d(TAG, "Network lost (airplane mode / connectivity drop)")
                        networkWasLost = true
                    }
                }
                cm.registerDefaultNetworkCallback(callback)
                connectivityCallback = callback
                Log.d(TAG, "Network callback registered")
            } catch (e: Exception) {
                Log.w(TAG, "Failed to register network callback: ${e.message}")
            }
        }
    }

    private fun unregisterNetworkCallback() {
        connectivityCallback?.let { callback ->
            try {
                val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
                cm.unregisterNetworkCallback(callback)
            } catch (_: Exception) {}
        }
        connectivityCallback = null
    }

    private fun saveUserId(userId: String) {
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit().putString(PREF_USER_ID, userId).apply()
    }

    private fun getSavedUserId(): String? =
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).getString(PREF_USER_ID, null)

    private fun clearSavedUserId() {
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit().remove(PREF_USER_ID).apply()
    }

    private fun saveActiveBuzz(buzzId: String, fromUserId: String, reason: String, note: String?) {
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
            .putString(PREF_ACTIVE_BUZZ_ID, buzzId)
            .putString(PREF_ACTIVE_BUZZ_FROM, fromUserId)
            .putString(PREF_ACTIVE_BUZZ_REASON, reason)
            .putString(PREF_ACTIVE_BUZZ_NOTE, note)
            .putString(PREF_ACTIVE_BUZZ_SOUND, activeSoundId)
            .apply()
    }

    private fun clearActiveBuzz() {
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
            .remove(PREF_ACTIVE_BUZZ_ID)
            .remove(PREF_ACTIVE_BUZZ_FROM)
            .remove(PREF_ACTIVE_BUZZ_REASON)
            .remove(PREF_ACTIVE_BUZZ_NOTE)
            .remove(PREF_ACTIVE_BUZZ_SOUND)
            .apply()
    }

    // ─── Alarm ─────────────────────────────────────────────
    private fun startAlarm() {
        if (isAlarming) return
        isAlarming = true
        Log.d(TAG, "startAlarm: beginning alarm sequence")

        // 1. Wake up the screen so the user sees the buzz
        try {
            val pm = getSystemService(POWER_SERVICE) as PowerManager
            alarmWakeLock?.let { if (it.isHeld) it.release() }
            @Suppress("DEPRECATION")
            alarmWakeLock = pm.newWakeLock(
                PowerManager.FULL_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP or PowerManager.ON_AFTER_RELEASE,
                "buzzer::alarm"
            ).apply { acquire(120000) } // auto-release after 2 min
        } catch (e: Exception) {
            Log.e(TAG, "Alarm wake lock error: ${e.message}")
        }

        // 2. Disable DND if we have permission
        try {
            val nm = getSystemService(NotificationManager::class.java)
            if (nm.isNotificationPolicyAccessGranted) {
                originalDndMode = nm.currentInterruptionFilter
                if (originalDndMode != NotificationManager.INTERRUPTION_FILTER_ALL) {
                    nm.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_ALL)
                    Log.d(TAG, "DND disabled for alarm (was $originalDndMode)")
                }
            } else {
                Log.w(TAG, "DND access not granted — alarm may be silent on some OEMs in DND mode")
            }
        } catch (e: Exception) {
            Log.w(TAG, "DND override failed: ${e.message}")
        }

        // 3. Max alarm volume and set ringer to normal — each operation independent
        val audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
        try {
            originalAlarmVolume = audioManager.getStreamVolume(AudioManager.STREAM_ALARM)
            val maxVol = audioManager.getStreamMaxVolume(AudioManager.STREAM_ALARM)
            audioManager.setStreamVolume(AudioManager.STREAM_ALARM, maxVol, 0)
            // Verify it actually took effect
            val actualVol = audioManager.getStreamVolume(AudioManager.STREAM_ALARM)
            if (actualVol < maxVol) {
                Log.w(TAG, "Alarm volume set to $actualVol/$maxVol (OEM may have restricted it)")
            } else {
                Log.d(TAG, "Alarm volume set to max: $maxVol")
            }
        } catch (e: Exception) {
            Log.w(TAG, "setStreamVolume(ALARM) failed: ${e.message}")
        }

        try {
            originalRingerMode = audioManager.ringerMode
            if (audioManager.ringerMode != AudioManager.RINGER_MODE_NORMAL) {
                audioManager.ringerMode = AudioManager.RINGER_MODE_NORMAL
                Log.d(TAG, "Ringer mode set to NORMAL (was $originalRingerMode)")
            }
        } catch (e: Exception) {
            // Requires DND access on Android 7+; expected to fail without it
            Log.w(TAG, "setRingerMode failed (needs DND access): ${e.message}")
        }

        // 4. Request audio focus — critical for OEMs that don't exempt USAGE_ALARM
        try {
            // Abandon any existing focus request to prevent leaking audio focus
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                (audioFocusRequest as? android.media.AudioFocusRequest)?.let {
                    try { audioManager.abandonAudioFocusRequest(it) } catch (_: Exception) {}
                }
                audioFocusRequest = null
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val focusReq = android.media.AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
                    .setAudioAttributes(AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build())
                    .setAcceptsDelayedFocusGain(false)
                    .build()
                val result = audioManager.requestAudioFocus(focusReq)
                audioFocusRequest = focusReq
                Log.d(TAG, "Audio focus request result: $result")
            } else {
                @Suppress("DEPRECATION")
                audioManager.requestAudioFocus(null, AudioManager.STREAM_ALARM, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Audio focus request failed: ${e.message}")
        }

        // 5. Start vibration
        val pattern = longArrayOf(0, 500, 200, 500, 200, 500, 200, 500)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator?.vibrate(VibrationEffect.createWaveform(pattern, 0))
        } else {
            @Suppress("DEPRECATION") vibrator?.vibrate(pattern, 0)
        }

        // 6. Check in-app mute toggle — skip sound but keep vibration
        val appMuted = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getBoolean("app_muted", false)
        if (appMuted) {
            Log.d(TAG, "App is muted — skipping sound playback, vibration only")
            return
        }

        // 7. Start sound playback (primary: STREAM_ALARM)
        if (!tryStartMediaPlayer()) {
            Log.w(TAG, "MediaPlayer failed on first attempt, retrying in 500ms...")
            handler.postDelayed({
                if (isAlarming && mediaPlayer == null) {
                    if (!tryStartMediaPlayer()) {
                        Log.e(TAG, "MediaPlayer failed on retry — alarm will be vibration-only")
                    }
                }
            }, 500)
        }

        // 8. Fallback: also play on STREAM_MUSIC when DND access is not granted.
        // STREAM_ALARM handles silent/vibrate mode (independent of ringer).
        // STREAM_MUSIC handles DND on OEMs that suppress STREAM_ALARM in DND,
        // because music playback is rarely blocked by DND.
        // When DND access IS granted, step 2 already disables DND, so no fallback needed.
        val nm2 = getSystemService(NotificationManager::class.java)
        if (!nm2.isNotificationPolicyAccessGranted) {
            Log.d(TAG, "DND access not granted — starting fallback STREAM_MUSIC player")
            try {
                originalMusicVolume = audioManager.getStreamVolume(AudioManager.STREAM_MUSIC)
                val maxMusicVol = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
                audioManager.setStreamVolume(AudioManager.STREAM_MUSIC, maxMusicVol, 0)
                Log.d(TAG, "Music volume set to max: $maxMusicVol (was $originalMusicVolume)")
            } catch (e: Exception) {
                Log.w(TAG, "setStreamVolume(MUSIC) failed: ${e.message}")
            }
            if (!tryStartFallbackMediaPlayer()) {
                handler.postDelayed({
                    if (isAlarming && fallbackMediaPlayer == null) {
                        tryStartFallbackMediaPlayer()
                    }
                }, 500)
            }
        }
    }

    private fun tryStartMediaPlayer(): Boolean {
        // Release any existing player first
        mediaPlayer?.let {
            try { it.release() } catch (_: Exception) {}
            mediaPlayer = null
        }
        return try {
            val soundName = activeSoundId
            val soundUri = Uri.parse("android.resource://$packageName/raw/$soundName")
            val player = MediaPlayer()
            player.setAudioAttributes(AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .setFlags(AudioAttributes.FLAG_AUDIBILITY_ENFORCED)
                .build())
            player.setDataSource(this@BuzzerService, soundUri)
            player.isLooping = true
            player.setVolume(1.0f, 1.0f)

            // Detect playback errors mid-stream (Bluetooth disconnect, audio policy kill, etc.)
            player.setOnErrorListener { mp, what, extra ->
                Log.e(TAG, "MediaPlayer error during playback: what=$what extra=$extra")
                try { mp.release() } catch (_: Exception) {}
                mediaPlayer = null
                // Auto-retry once if we're still supposed to be alarming
                if (isAlarming) {
                    handler.postDelayed({
                        if (isAlarming && mediaPlayer == null) {
                            Log.d(TAG, "Restarting MediaPlayer after mid-playback error")
                            tryStartMediaPlayer()
                        }
                    }, 300)
                }
                true // error handled
            }

            player.prepare()
            player.start()
            mediaPlayer = player

            if (player.isPlaying) {
                Log.d(TAG, "MediaPlayer started successfully, isPlaying=true")
            } else {
                Log.w(TAG, "MediaPlayer.start() called but isPlaying=false")
            }
            true
        } catch (e: Exception) {
            Log.e(TAG, "Alarm sound error: ${e.message}", e)
            mediaPlayer?.let {
                try { it.release() } catch (_: Exception) {}
            }
            mediaPlayer = null
            false
        }
    }

    private fun tryStartFallbackMediaPlayer(): Boolean {
        fallbackMediaPlayer?.let {
            try { it.release() } catch (_: Exception) {}
            fallbackMediaPlayer = null
        }
        return try {
            val soundName = activeSoundId
            val soundUri = Uri.parse("android.resource://$packageName/raw/$soundName")
            val player = MediaPlayer()
            player.setAudioAttributes(AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                .build())
            player.setDataSource(this@BuzzerService, soundUri)
            player.isLooping = true
            player.setVolume(1.0f, 1.0f)
            player.setOnErrorListener { mp, what, extra ->
                Log.e(TAG, "Fallback MediaPlayer error: what=$what extra=$extra")
                try { mp.release() } catch (_: Exception) {}
                fallbackMediaPlayer = null
                if (isAlarming) {
                    handler.postDelayed({
                        if (isAlarming && fallbackMediaPlayer == null) {
                            tryStartFallbackMediaPlayer()
                        }
                    }, 300)
                }
                true
            }
            player.prepare()
            player.start()
            fallbackMediaPlayer = player
            Log.d(TAG, "Fallback MediaPlayer (STREAM_MUSIC) started successfully")
            true
        } catch (e: Exception) {
            Log.w(TAG, "Fallback MediaPlayer failed: ${e.message}")
            fallbackMediaPlayer = null
            false
        }
    }

    private fun stopAlarm() {
        if (!isAlarming && mediaPlayer == null && fallbackMediaPlayer == null && alarmWakeLock == null) return
        Log.d(TAG, "stopAlarm: stopping alarm sequence")
        isAlarming = false
        vibrator?.cancel()

        // Stop and release MediaPlayer (primary: STREAM_ALARM)
        mediaPlayer?.let {
            try { if (it.isPlaying) it.stop() } catch (_: Exception) {}
            try { it.release() } catch (_: Exception) {}
        }
        mediaPlayer = null

        // Stop and release fallback MediaPlayer (STREAM_MUSIC)
        fallbackMediaPlayer?.let {
            try { if (it.isPlaying) it.stop() } catch (_: Exception) {}
            try { it.release() } catch (_: Exception) {}
        }
        fallbackMediaPlayer = null

        // Release screen wake lock
        alarmWakeLock?.let { if (it.isHeld) try { it.release() } catch (_: Exception) {} }
        alarmWakeLock = null

        // Abandon audio focus
        try {
            val audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                (audioFocusRequest as? android.media.AudioFocusRequest)?.let {
                    audioManager.abandonAudioFocusRequest(it)
                }
            } else {
                @Suppress("DEPRECATION")
                audioManager.abandonAudioFocus(null)
            }
            audioFocusRequest = null
        } catch (_: Exception) {}

        // Restore alarm volume (separate try-catch so ringer restore still runs if this fails)
        if (originalAlarmVolume >= 0) {
            try {
                val audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
                audioManager.setStreamVolume(AudioManager.STREAM_ALARM, originalAlarmVolume, 0)
            } catch (_: Exception) {}
            originalAlarmVolume = -1
        }

        // Restore music volume (fallback player)
        if (originalMusicVolume >= 0) {
            try {
                val audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
                audioManager.setStreamVolume(AudioManager.STREAM_MUSIC, originalMusicVolume, 0)
            } catch (_: Exception) {}
            originalMusicVolume = -1
        }

        // Restore ringer mode
        if (originalRingerMode >= 0) {
            try {
                val audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
                audioManager.ringerMode = originalRingerMode
            } catch (_: Exception) {}
            originalRingerMode = -1
        }

        // Restore DND
        if (originalDndMode >= 0) {
            try {
                val nm = getSystemService(NotificationManager::class.java)
                if (nm.isNotificationPolicyAccessGranted && originalDndMode != NotificationManager.INTERRUPTION_FILTER_ALL) {
                    nm.setInterruptionFilter(originalDndMode)
                }
            } catch (_: Exception) {}
            originalDndMode = -1
        }
    }

    // ─── Notifications ─────────────────────────────────────
    private fun cancelActiveBuzzNotification() {
        activeBuzzId?.let {
            getSystemService(NotificationManager::class.java).cancel(it.hashCode())
            activeBuzzId = null
        }
    }

    private fun cancelAllNotificationsForBuzz(buzzId: String) {
        val nm = getSystemService(NotificationManager::class.java)
        nm.cancel(buzzId.hashCode())
        nm.cancel(buzzId, 0)
        for (n in nm.activeNotifications) {
            if (n.tag == buzzId) nm.cancel(n.tag, n.id)
        }
    }

    private fun resolveUserName(userId: String, callback: (String) -> Unit) {
        if (userId.isEmpty()) { callback("Unknown"); return }
        val cached = userNameCache[userId]
        if (cached != null) { callback(cached); return }
        Thread {
            try {
                val json = supabaseGet("users?id=eq.$userId&select=name") ?: run { handler.post { callback("User") }; return@Thread }
                val arr = JSONArray(json)
                val name = if (arr.length() > 0) arr.getJSONObject(0).optString("name", "User") else "User"
                userNameCache[userId] = name
                handler.post { callback(name) }
            } catch (_: Exception) {
                handler.post { callback("User") }
            }
        }.start()
    }

    private fun coloredText(text: String, color: Int): SpannableString {
        val s = SpannableString(text)
        s.setSpan(ForegroundColorSpan(color), 0, text.length, 0)
        return s
    }

    private fun showBuzzNotification(buzzId: String, fromUserId: String, reason: String, note: String?) {
        val notifStart = System.currentTimeMillis()
        resolveUserName(fromUserId) { senderName ->
            Log.d(TAG, "[T9-detail] resolveUserName completed for $buzzId in ${System.currentTimeMillis() - notifStart}ms (name=$senderName)")
            cancelAllNotificationsForBuzz(buzzId)
            val body = if (note.isNullOrEmpty() || note == "null") reason else "$reason — $note"
            val launchIntent = Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                putExtra("buzz_id", buzzId)
                putExtra("from_user_id", fromUserId)
                putExtra("from_user_name", senderName)
                putExtra("reason", reason)
                putExtra("note", note ?: "")
                putExtra("sound_id", activeSoundId)
            }
            val pendingIntent = PendingIntent.getActivity(this, buzzId.hashCode(), launchIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

            fun respondIntent(response: String, rc: Int): PendingIntent {
                val i = Intent(this, BuzzerService::class.java).apply {
                    action = ACTION_RESPOND
                    putExtra(EXTRA_BUZZ_ID, buzzId)
                    putExtra(EXTRA_RESPONSE, response)
                }
                return PendingIntent.getService(this, rc, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            }

            createBuzzVisualChannel()

            // Use the visual-only channel (no sound, HIGH importance) so the
            // notification shows as a heads-up popup without playing audio.
            // All audio is handled by startAlarm() via MediaPlayer with USAGE_ALARM,
            // max volume, and audio focus — the notification is purely visual + action buttons.
            val notification = NotificationCompat.Builder(this, BUZZ_VISUAL_CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle("Buzz from $senderName")
                .setContentText(body)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setAutoCancel(true)
                .setOngoing(true)
                .setFullScreenIntent(pendingIntent, true)
                .setContentIntent(pendingIntent)
                .addAction(0, coloredText("✓ Ack", 0xFF4CAF50.toInt()), respondIntent("ack", buzzId.hashCode() + 1))
                .addAction(0, coloredText("⏱ 5 min", 0xFFFF9800.toInt()), respondIntent("five_min", buzzId.hashCode() + 2))
                .addAction(0, coloredText("✗ Busy", 0xFFF44336.toInt()), respondIntent("busy", buzzId.hashCode() + 3))
                .build()

            getSystemService(NotificationManager::class.java).notify(buzzId.hashCode(), notification)

            // Delayed cleanup: cancel any FCM/notifee duplicate notification
            handler.postDelayed({
                val nm2 = getSystemService(NotificationManager::class.java)
                nm2.cancel(buzzId, 0)
                for (n in nm2.activeNotifications) {
                    if (n.tag == buzzId) nm2.cancel(n.tag, n.id)
                }
            }, 3000)
        }
    }

    private fun showCancelledNotification(buzzId: String, fromUserId: String) {
        resolveUserName(fromUserId) { senderName ->
            val notification = NotificationCompat.Builder(this, BUZZ_CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle("Buzz cancelled")
                .setContentText("$senderName cancelled the buzz")
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setAutoCancel(true)
                .setTimeoutAfter(10000)
                .build()
            getSystemService(NotificationManager::class.java).notify((buzzId + "_cancel").hashCode(), notification)
        }
    }

    // ─── Channels ──────────────────────────────────────────
    private fun buildNotification(): Notification =
        NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("Buzzer")
            .setContentText("Listening for incoming buzzes")
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .setContentIntent(PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
            .build()

    private fun createServiceChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(NotificationChannel(CHANNEL_ID, "Buzzer Service", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Keeps Buzzer listening for incoming buzzes"
            })
        }
    }

    private fun createVoiceMailChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(NotificationChannel(VOICEMAIL_CHANNEL_ID, "Voice Messages", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Voice message notifications"
            })
        }
    }

    private fun createBuzzChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(NotificationManager::class.java)
            val soundName = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .getString("buzz_sound", "buzz_alarm") ?: "buzz_alarm"
            val soundUri = Uri.parse("android.resource://$packageName/raw/$soundName")
            val audioAttrs = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()

            // Android locks channel settings after creation. If the channel exists
            // with wrong settings (e.g., USAGE_NOTIFICATION instead of USAGE_ALARM,
            // or bypassDnd=false), delete and recreate it. This is a one-time
            // migration that runs natively before React Native's JS bridge starts.
            val existing = nm.getNotificationChannel(BUZZ_CHANNEL_ID)
            if (existing != null) {
                val existingUsage = existing.audioAttributes?.usage ?: -1
                if (!existing.canBypassDnd() || existingUsage != AudioAttributes.USAGE_ALARM) {
                    Log.d(TAG, "Buzz channel has wrong settings (bypassDnd=${existing.canBypassDnd()}, usage=$existingUsage) — deleting and recreating")
                    nm.deleteNotificationChannel(BUZZ_CHANNEL_ID)
                }
            }

            nm.createNotificationChannel(NotificationChannel(BUZZ_CHANNEL_ID, "Buzzer Alerts", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Incoming buzz alerts"
                setBypassDnd(true)
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
                setSound(soundUri, audioAttrs)
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 500, 200, 500, 200, 500)
            })
        }
    }

    private fun createBuzzVisualChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(NotificationChannel(BUZZ_VISUAL_CHANNEL_ID, "Buzzer Visual Alerts", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Visual heads-up alerts for incoming buzzes (sound handled by alarm)"
                setBypassDnd(true)
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
                setSound(null, null) // No sound — MediaPlayer handles all audio
                enableVibration(false) // No vibration — BuzzerService vibrator handles it
            })
        }
    }

    private fun acquireWakeLock() {
        val pm = getSystemService(POWER_SERVICE) as PowerManager
        // Release any existing WakeLock before acquiring a new one
        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "buzzer::listener").apply {
            acquire() // No timeout — released in onDestroy()
        }
    }

    private var restartScheduledByTimeout = false

    override fun onTimeout(startId: Int, fgsType: Int) {
        super.onTimeout(startId, fgsType)
        Log.d(TAG, "FGS timeout (dataSync limit) — restarting immediately")
        restartScheduledByTimeout = true
        // Restart with minimum delay (0 = next alarm wakeup window, typically <1s)
        // rather than the escalating delays used for unexpected kills.
        try {
            val userId = getSavedUserId()
            if (userId != null) {
                val restartIntent = Intent(this, BuzzerService::class.java).apply {
                    action = ACTION_START
                    putExtra(EXTRA_USER_ID, userId)
                }
                val pendingIntent = PendingIntent.getService(
                    this, RESTART_REQUEST_CODE, restartIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
                val alarmManager = getSystemService(Context.ALARM_SERVICE) as AlarmManager
                alarmManager.setAndAllowWhileIdle(
                    AlarmManager.RTC_WAKEUP,
                    System.currentTimeMillis() + 1000, // 1 second
                    pendingIntent
                )
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to schedule immediate restart from timeout: ${e.message}")
            scheduleRestartAlarm() // fallback to normal retry
        }
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        Log.d(TAG, "Service destroyed")
        // If no active buzz, clear the persisted state so restart doesn't
        // falsely re-trigger. If there IS an active buzz, leave it persisted
        // so the restarted service can recover the alarm.
        if (activeBuzzId == null) clearActiveBuzz()
        stopAlarm()
        cancelActiveBuzzNotification()
        stopPolling()
        unregisterNetworkCallback()
        // Only schedule restart if onTimeout didn't already do it
        if (!restartScheduledByTimeout && getSavedUserId() != null) {
            Log.d(TAG, "Scheduling restart from onDestroy")
            scheduleRestartAlarm()
        }
        restartScheduledByTimeout = false
        wakeLock?.let { if (it.isHeld) it.release() }
        super.onDestroy()
    }
}

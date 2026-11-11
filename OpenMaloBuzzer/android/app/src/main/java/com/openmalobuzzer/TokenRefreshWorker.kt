package com.openmalobuzzer

import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.tasks.await
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

class TokenRefreshWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {

    companion object {
        const val TAG = "TokenRefreshWorker"
        const val WORK_NAME = "token_refresh_work"
    }

    override suspend fun doWork(): Result {
        val prefs = applicationContext.getSharedPreferences(
            BuzzerService.PREFS_NAME, Context.MODE_PRIVATE
        )
        val userId = prefs.getString(BuzzerService.PREF_USER_ID, null)
        if (userId == null) {
            Log.d(TAG, "No saved userId — skipping")
            return Result.success()
        }

        Log.d(TAG, "Running periodic token refresh for userId: $userId")

        try {
            // Refresh FCM token and save to Supabase
            val token = FirebaseMessaging.getInstance().token.await()
            if (!token.isNullOrEmpty()) {
                var conn: HttpURLConnection? = null
                try {
                    val url = URL("${SupabaseConfig.URL}/rest/v1/user_tokens")
                    conn = url.openConnection() as HttpURLConnection
                    conn.requestMethod = "POST"
                    conn.setRequestProperty("apikey", SupabaseConfig.ANON_KEY)
                    conn.setRequestProperty("Authorization", "Bearer ${SupabaseConfig.ANON_KEY}")
                    conn.setRequestProperty("Content-Type", "application/json")
                    conn.setRequestProperty("Prefer", "resolution=merge-duplicates,return=minimal")
                    conn.doOutput = true

                    val body = JSONObject().apply {
                        put("user_id", userId)
                        put("fcm_token", token)
                        put("fcm_token_stale", false)
                        put("token_updated_at", System.currentTimeMillis())
                        put("platform", "android")
                    }

                    val writer = OutputStreamWriter(conn.outputStream)
                    writer.write(body.toString())
                    writer.flush()
                    writer.close()
                    val responseCode = conn.responseCode
                    if (responseCode in 200..299) {
                        Log.d(TAG, "FCM token refreshed and saved to Supabase")
                    } else {
                        Log.e(TAG, "Supabase token upsert failed with HTTP $responseCode")
                    }
                } finally {
                    conn?.disconnect()
                }
            }

            // Check if service is alive; restart only if OEM killed it
            val healthy = BuzzerService.isServiceHealthy(applicationContext)
            Log.d(TAG, "BuzzerService health check: ${if (healthy) "alive" else "DEAD — restarting"}")
            if (!healthy) {
                // Service is dead — poll for pending buzzes directly as a safety net.
                // If there's an unanswered buzz right now, we need to show it.
                try {
                    pollForPendingBuzzes(userId)
                } catch (e: Exception) {
                    Log.e(TAG, "Worker poll for buzzes failed: ${e.message}")
                }

                try {
                    val serviceIntent = Intent(applicationContext, BuzzerService::class.java).apply {
                        action = BuzzerService.ACTION_START
                        putExtra(BuzzerService.EXTRA_USER_ID, userId)
                    }
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        applicationContext.startForegroundService(serviceIntent)
                    } else {
                        applicationContext.startService(serviceIntent)
                    }
                } catch (e: Exception) {
                    // Android 12+ can throw ForegroundServiceStartNotAllowedException
                    // when the app is in a restricted background state
                    Log.e(TAG, "Failed to restart BuzzerService: ${e.message}")
                    return Result.retry()
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Token refresh failed: ${e.message}")
            return Result.retry()
        }

        return Result.success()
    }

    /**
     * Quick poll for unanswered buzzes when the service is dead.
     * If found, starts the BuzzerService with ACTION_SHOW_BUZZ to trigger the alarm.
     * This is a safety net — normally the foreground service or FCM handles this.
     */
    private fun pollForPendingBuzzes(userId: String) {
        var conn: HttpURLConnection? = null
        try {
            val since = System.currentTimeMillis() - 600000 // last 10 minutes (catches buzzes missed during airplane mode / network outage)
            val url = URL("${SupabaseConfig.URL}/rest/v1/buzzes?to_user_id=eq.$userId&response=eq.none&created_at=gte.$since&select=id,from_user_id,from_user_name,reason,note,sound_id")
            conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "GET"
            conn.setRequestProperty("apikey", SupabaseConfig.ANON_KEY)
            conn.setRequestProperty("Authorization", "Bearer ${SupabaseConfig.ANON_KEY}")
            conn.connectTimeout = 10000
            conn.readTimeout = 10000

            if (conn.responseCode == 200) {
                val reader = BufferedReader(InputStreamReader(conn.inputStream))
                val response = reader.readText()
                reader.close()
                val arr = JSONArray(response)
                if (arr.length() > 0) {
                    val buzz = arr.getJSONObject(0) // show the most recent pending buzz
                    val buzzId = buzz.getString("id")
                    val fromUserId = buzz.optString("from_user_id", "")
                    val fromUserName = buzz.optString("from_user_name", "").let { if (it == "null" || it.isEmpty()) "User" else it }
                    val reason = buzz.optString("reason", "")
                    val note = buzz.optString("note", "").let { if (it == "null") "" else it }
                    val soundId = buzz.optString("sound_id", "buzz_alarm").let { if (it == "null" || it.isEmpty()) "buzz_alarm" else it }
                    Log.d(TAG, "Worker found pending buzz $buzzId — triggering SHOW_BUZZ")
                    try {
                        val showIntent = Intent(applicationContext, BuzzerService::class.java).apply {
                            action = BuzzerService.ACTION_SHOW_BUZZ
                            putExtra(BuzzerService.EXTRA_BUZZ_ID, buzzId)
                            putExtra(BuzzerService.EXTRA_FROM_USER_ID, fromUserId)
                            putExtra(BuzzerService.EXTRA_FROM_USER_NAME, fromUserName)
                            putExtra(BuzzerService.EXTRA_REASON, reason)
                            putExtra(BuzzerService.EXTRA_NOTE, note)
                            putExtra(BuzzerService.EXTRA_SOUND_ID, soundId)
                        }
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                            applicationContext.startForegroundService(showIntent)
                        } else {
                            applicationContext.startService(showIntent)
                        }
                    } catch (e: Exception) {
                        Log.e(TAG, "Worker failed to start SHOW_BUZZ: ${e.message}")
                    }
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Worker poll error: ${e.message}")
        } finally {
            conn?.disconnect()
        }
    }
}

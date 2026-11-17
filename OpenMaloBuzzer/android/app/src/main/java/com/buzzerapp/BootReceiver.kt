package com.buzzerapp

import android.app.ForegroundServiceStartNotAllowedException
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action == Intent.ACTION_BOOT_COMPLETED ||
            intent?.action == "android.intent.action.QUICKBOOT_POWERON") {
            Log.d("BootReceiver", "Boot completed — restarting BuzzerService")

            val prefs = context.getSharedPreferences(BuzzerService.PREFS_NAME, Context.MODE_PRIVATE)
            val userId = prefs.getString(BuzzerService.PREF_USER_ID, null)

            if (userId != null) {
                try {
                    val serviceIntent = Intent(context, BuzzerService::class.java).apply {
                        action = BuzzerService.ACTION_START
                        putExtra(BuzzerService.EXTRA_USER_ID, userId)
                    }
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        context.startForegroundService(serviceIntent)
                    } else {
                        context.startService(serviceIntent)
                    }
                    Log.d("BootReceiver", "BuzzerService restarted for userId: $userId")
                } catch (e: Exception) {
                    // Android 12+ can block foreground service start after boot on some OEMs
                    // Fall back to WorkManager which can start it when conditions allow
                    Log.e("BootReceiver", "Failed to start service directly: ${e.message}")
                    try {
                        val workRequest = OneTimeWorkRequestBuilder<TokenRefreshWorker>()
                            .setInitialDelay(10, TimeUnit.SECONDS)
                            .build()
                        WorkManager.getInstance(context).enqueueUniqueWork(
                            "boot_service_recovery",
                            ExistingWorkPolicy.REPLACE,
                            workRequest
                        )
                        Log.d("BootReceiver", "Scheduled WorkManager fallback to restart service")
                    } catch (we: Exception) {
                        Log.e("BootReceiver", "WorkManager fallback also failed: ${we.message}")
                    }
                }
            } else {
                Log.d("BootReceiver", "No saved userId — skipping service restart")
            }
        }
    }
}

package com.openmalobuzzer

import android.content.Intent
import android.media.MediaRecorder
import android.os.Build
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import android.util.Log
import java.io.File

class BuzzerServiceModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "BuzzerService"

    private var mediaRecorder: MediaRecorder? = null
    private var recordingPath: String? = null

    @ReactMethod
    fun startService(userId: String) {
        val intent = Intent(reactApplicationContext, BuzzerService::class.java).apply {
            action = BuzzerService.ACTION_START
            putExtra(BuzzerService.EXTRA_USER_ID, userId)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            reactApplicationContext.startForegroundService(intent)
        } else {
            reactApplicationContext.startService(intent)
        }
    }

    @ReactMethod
    fun stopService() {
        val intent = Intent(reactApplicationContext, BuzzerService::class.java).apply {
            action = BuzzerService.ACTION_STOP
        }
        reactApplicationContext.startService(intent)
    }

    @ReactMethod
    fun restartService() {
        val prefs = reactApplicationContext.getSharedPreferences(
            BuzzerService.PREFS_NAME, android.content.Context.MODE_PRIVATE
        )
        val userId = prefs.getString(BuzzerService.PREF_USER_ID, null) ?: return
        val intent = Intent(reactApplicationContext, BuzzerService::class.java).apply {
            action = BuzzerService.ACTION_START
            putExtra(BuzzerService.EXTRA_USER_ID, userId)
        }
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            reactApplicationContext.startForegroundService(intent)
        } else {
            reactApplicationContext.startService(intent)
        }
    }

    @ReactMethod
    fun showBuzz(buzzId: String, fromUserId: String, fromUserName: String, reason: String, note: String?, soundId: String?, promise: Promise) {
        try {
            val intent = Intent(reactApplicationContext, BuzzerService::class.java).apply {
                action = BuzzerService.ACTION_SHOW_BUZZ
                putExtra(BuzzerService.EXTRA_BUZZ_ID, buzzId)
                putExtra(BuzzerService.EXTRA_FROM_USER_ID, fromUserId)
                putExtra(BuzzerService.EXTRA_FROM_USER_NAME, fromUserName)
                putExtra(BuzzerService.EXTRA_REASON, reason)
                putExtra(BuzzerService.EXTRA_NOTE, note ?: "")
                putExtra(BuzzerService.EXTRA_SOUND_ID, soundId ?: "buzz_alarm")
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                reactApplicationContext.startForegroundService(intent)
            } else {
                reactApplicationContext.startService(intent)
            }
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e("BuzzerServiceModule", "showBuzz failed: ${e.message}")
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun stopAlarm() {
        val intent = Intent(reactApplicationContext, BuzzerService::class.java).apply {
            action = BuzzerService.ACTION_STOP_ALARM
        }
        reactApplicationContext.startService(intent)
    }

    @ReactMethod
    fun getPendingBuzz(promise: Promise) {
        val payload = MainActivity.pendingBuzzPayload
        if (payload != null) {
            val map = Arguments.createMap().apply {
                putString("buzz_id", payload.getString("buzz_id") ?: "")
                putString("from_user_id", payload.getString("from_user_id") ?: "")
                putString("from_user_name", payload.getString("from_user_name") ?: "")
                putString("reason", payload.getString("reason") ?: "")
                putString("note", payload.getString("note") ?: "")
                putString("sound_id", payload.getString("sound_id") ?: "buzz_alarm")
            }
            MainActivity.pendingBuzzPayload = null
            promise.resolve(map)
        } else {
            promise.resolve(null)
        }
    }

    @ReactMethod
    fun getPendingNavigation(promise: Promise) {
        val nav = MainActivity.pendingNavigation
        if (nav != null) {
            MainActivity.pendingNavigation = null
            promise.resolve(nav)
        } else {
            promise.resolve(null)
        }
    }

    @ReactMethod
    fun readFileBase64(filePath: String, promise: Promise) {
        try {
            val file = File(filePath)
            val bytes = file.readBytes()
            val base64 = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
            promise.resolve(base64)
        } catch (e: Exception) {
            promise.reject("FILE_ERROR", e.message)
        }
    }

    @ReactMethod
    fun writeBase64ToFile(base64Data: String, fileName: String, promise: Promise) {
        try {
            val dir = File(reactApplicationContext.cacheDir, "voice_mails")
            if (!dir.exists()) dir.mkdirs()
            // Sanitize filename
            val safeName = fileName.replace(Regex("[^a-zA-Z0-9._-]"), "_")
            val file = File(dir, safeName)
            val bytes = android.util.Base64.decode(base64Data, android.util.Base64.DEFAULT)
            file.writeBytes(bytes)
            // Verify file was written
            if (file.exists() && file.length() > 0) {
                promise.resolve(file.absolutePath)
            } else {
                promise.reject("FILE_ERROR", "File was not written correctly: size=${file.length()}")
            }
        } catch (e: Exception) {
            promise.reject("FILE_ERROR", "writeBase64ToFile failed: ${e.message}")
        }
    }

    private var currentPlayer: android.media.MediaPlayer? = null

    @ReactMethod
    fun playAudioFile(filePath: String, promise: Promise) {
        try {
            currentPlayer?.let {
                try { it.stop() } catch (_: Exception) {}
                try { it.release() } catch (_: Exception) {}
            }
            currentPlayer = null

            val file = File(filePath)
            if (!file.exists()) {
                promise.reject("FILE_ERROR", "File not found: $filePath")
                return
            }

            Log.d("BuzzerVM", "playAudioFile: path=$filePath size=${file.length()}")

            val player = android.media.MediaPlayer()
            @Suppress("DEPRECATION")
            player.setAudioStreamType(android.media.AudioManager.STREAM_MUSIC)
            player.setDataSource(filePath)
            player.setVolume(1.0f, 1.0f)
            player.prepare()
            Log.d("BuzzerVM", "prepared: duration=${player.duration}ms")
            player.start()
            Log.d("BuzzerVM", "started playing")
            currentPlayer = player

            player.setOnCompletionListener {
                Log.d("BuzzerVM", "playback completed")
                it.release()
                currentPlayer = null
                promise.resolve("done")
            }
            player.setOnErrorListener { mp, what, extra ->
                Log.e("BuzzerVM", "playback error: what=$what extra=$extra")
                mp.release()
                currentPlayer = null
                promise.reject("PLAY_ERROR", "MediaPlayer error: what=$what extra=$extra")
                true
            }
        } catch (e: Exception) {
            Log.e("BuzzerVM", "playAudioFile exception: ${e.message}", e)
            promise.reject("PLAY_ERROR", "playAudioFile failed: ${e.message}")
        }
    }

    @ReactMethod
    fun playBase64Audio(base64Data: String, promise: Promise) {
        try {
            currentPlayer?.let {
                try { it.stop() } catch (_: Exception) {}
                try { it.release() } catch (_: Exception) {}
            }
            currentPlayer = null

            // Write to temp file
            val dir = File(reactApplicationContext.cacheDir, "voice_mails")
            if (!dir.exists()) dir.mkdirs()
            val file = File(dir, "playback_temp.m4a")
            val bytes = android.util.Base64.decode(base64Data, android.util.Base64.DEFAULT)
            file.writeBytes(bytes)

            Log.d("BuzzerVM", "playBase64Audio: decoded ${bytes.size} bytes, file=${file.absolutePath}")

            val player = android.media.MediaPlayer()
            @Suppress("DEPRECATION")
            player.setAudioStreamType(android.media.AudioManager.STREAM_MUSIC)
            player.setDataSource(file.absolutePath)
            player.setVolume(1.0f, 1.0f)
            player.prepare()
            Log.d("BuzzerVM", "prepared: duration=${player.duration}ms")
            player.start()
            Log.d("BuzzerVM", "started playing base64 audio")
            currentPlayer = player

            player.setOnCompletionListener {
                Log.d("BuzzerVM", "base64 playback completed")
                it.release()
                currentPlayer = null
                promise.resolve("done")
            }
            player.setOnErrorListener { mp, what, extra ->
                Log.e("BuzzerVM", "base64 playback error: what=$what extra=$extra")
                mp.release()
                currentPlayer = null
                promise.reject("PLAY_ERROR", "MediaPlayer error: what=$what extra=$extra")
                true
            }
        } catch (e: Exception) {
            Log.e("BuzzerVM", "playBase64Audio exception: ${e.message}", e)
            promise.reject("PLAY_ERROR", "playBase64Audio failed: ${e.message}")
        }
    }

    @ReactMethod
    fun stopPlayback() {
        currentPlayer?.let {
            try { it.stop() } catch (_: Exception) {}
            try { it.release() } catch (_: Exception) {}
        }
        currentPlayer = null
    }

    @ReactMethod
    fun startRecording(promise: Promise) {
        try {
            val dir = File(reactApplicationContext.cacheDir, "voice_mails")
            if (!dir.exists()) dir.mkdirs()
            val file = File(dir, "vm_${System.currentTimeMillis()}.m4a")
            recordingPath = file.absolutePath

            val recorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                MediaRecorder(reactApplicationContext)
            } else {
                @Suppress("DEPRECATION")
                MediaRecorder()
            }

            recorder.apply {
                setAudioSource(MediaRecorder.AudioSource.MIC)
                setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                setAudioSamplingRate(44100)
                setAudioEncodingBitRate(128000)
                setOutputFile(recordingPath)
                prepare()
                start()
            }
            mediaRecorder = recorder
            promise.resolve(recordingPath)
        } catch (e: Exception) {
            mediaRecorder?.let { try { it.release() } catch (_: Exception) {} }
            mediaRecorder = null
            promise.reject("RECORDING_ERROR", e.message)
        }
    }

    @ReactMethod
    fun stopRecording(promise: Promise) {
        try {
            mediaRecorder?.apply {
                stop()
                release()
            }
            mediaRecorder = null
            promise.resolve(recordingPath)
        } catch (e: Exception) {
            mediaRecorder?.release()
            mediaRecorder = null
            promise.reject("RECORDING_ERROR", e.message)
        }
    }

    // ─── Service Health Check ────────────────────────────────

    @ReactMethod
    fun isServiceHealthy(promise: Promise) {
        val healthy = BuzzerService.isServiceHealthy(reactApplicationContext)
        promise.resolve(healthy)
    }

    /**
     * Checks if the service is alive. If not, restarts it and returns false.
     * The JS side can use this on foreground resume to auto-recover from OEM kills.
     */
    @ReactMethod
    fun checkAndRecoverService(promise: Promise) {
        val healthy = BuzzerService.isServiceHealthy(reactApplicationContext)
        if (!healthy) {
            val prefs = reactApplicationContext.getSharedPreferences(
                BuzzerService.PREFS_NAME, android.content.Context.MODE_PRIVATE
            )
            val userId = prefs.getString(BuzzerService.PREF_USER_ID, null)
            if (userId != null) {
                Log.d("BuzzerServiceModule", "Service not healthy — restarting for $userId")
                val intent = Intent(reactApplicationContext, BuzzerService::class.java).apply {
                    action = BuzzerService.ACTION_START
                    putExtra(BuzzerService.EXTRA_USER_ID, userId)
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    reactApplicationContext.startForegroundService(intent)
                } else {
                    reactApplicationContext.startService(intent)
                }
            }
        }
        promise.resolve(healthy)
    }

    @ReactMethod
    fun setBuzzSound(soundName: String) {
        reactApplicationContext.getSharedPreferences(
            BuzzerService.PREFS_NAME, android.content.Context.MODE_PRIVATE
        ).edit().putString("buzz_sound", soundName).apply()
    }

    @ReactMethod
    fun setMuted(muted: Boolean) {
        reactApplicationContext.getSharedPreferences(
            BuzzerService.PREFS_NAME, android.content.Context.MODE_PRIVATE
        ).edit().putBoolean("app_muted", muted).apply()
    }

    @ReactMethod
    fun cancelBuzzNotification(buzzId: String) {
        val nm = reactApplicationContext.getSystemService(android.content.Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
        nm.cancel(buzzId.hashCode())
        nm.cancel(buzzId, 0)
        for (n in nm.activeNotifications) {
            if (n.tag == buzzId) nm.cancel(n.tag, n.id)
        }
    }

    // ─── DND Access ────────────────────────────────────────

    @ReactMethod
    fun isDndAccessGranted(promise: Promise) {
        val nm = reactApplicationContext.getSystemService(android.content.Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
        promise.resolve(nm.isNotificationPolicyAccessGranted)
    }

    // ─── OEM Battery Optimization ───────────────────────────

    @ReactMethod
    fun getBatteryInfo(promise: Promise) {
        try {
            val ctx = reactApplicationContext
            val oem = OemBatteryHelper.detectOem()
            val instructions = OemBatteryHelper.getInstructions()
            val map = Arguments.createMap().apply {
                putString("oem", oem.name)
                putString("oemName", instructions.oemName)
                putString("steps", instructions.steps)
                putBoolean("hasAutostart", instructions.hasAutostart)
                putBoolean("needsManualStep", instructions.needsManualStep)
                putBoolean("isIgnoringBatteryOptimizations",
                    OemBatteryHelper.isIgnoringBatteryOptimizations(ctx))
                putString("manufacturer", android.os.Build.MANUFACTURER)
                putString("model", android.os.Build.MODEL)
            }
            promise.resolve(map)
        } catch (e: Exception) {
            promise.reject("BATTERY_ERROR", e.message)
        }
    }

    @ReactMethod
    fun requestBatteryExemption(promise: Promise) {
        try {
            val result = OemBatteryHelper.requestBatteryOptimizationExemption(reactApplicationContext)
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("BATTERY_ERROR", e.message)
        }
    }

    @ReactMethod
    fun openOemBatterySettings(promise: Promise) {
        try {
            val result = OemBatteryHelper.openOemBatterySettings(reactApplicationContext)
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("BATTERY_ERROR", e.message)
        }
    }
}

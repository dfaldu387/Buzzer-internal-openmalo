package com.buzzerapp

import android.app.Application
import android.util.Log
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import java.util.concurrent.TimeUnit

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          add(BuzzerServicePackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
    scheduleTokenRefresh()
  }

  private fun scheduleTokenRefresh() {
    try {
      // 15 minutes is the minimum allowed by WorkManager. This worker also
      // checks service health and polls for pending buzzes as a safety net,
      // so a shorter interval is important for reliability after OEM kills.
      val workRequest = PeriodicWorkRequestBuilder<TokenRefreshWorker>(
        15, TimeUnit.MINUTES
      ).build()

      WorkManager.getInstance(this).enqueueUniquePeriodicWork(
        TokenRefreshWorker.WORK_NAME,
        ExistingPeriodicWorkPolicy.UPDATE,
        workRequest
      )
      Log.d("MainApplication", "TokenRefreshWorker scheduled (every 15 minutes)")
    } catch (e: Exception) {
      Log.e("MainApplication", "Failed to schedule TokenRefreshWorker: ${e.message}")
    }
  }
}

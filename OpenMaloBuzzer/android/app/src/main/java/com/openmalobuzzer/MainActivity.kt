package com.openmalobuzzer

import android.content.Intent
import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.facebook.react.bridge.Arguments
import com.facebook.react.modules.core.DeviceEventManagerModule

class MainActivity : ReactActivity() {

  companion object {
    var pendingBuzzPayload: Bundle? = null
    var pendingNavigation: String? = null
  }

  override fun getMainComponentName(): String = "OpenMaloBuzzer"

  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    handleBuzzIntent(intent)
  }

  override fun onNewIntent(intent: Intent?) {
    super.onNewIntent(intent)
    intent?.let { handleBuzzIntent(it) }
  }

  private fun handleBuzzIntent(intent: Intent) {
    val navigateTo = intent.getStringExtra("navigate_to")
    if (navigateTo != null) {
      pendingNavigation = navigateTo
      intent.removeExtra("navigate_to")
      // Emit event for foreground case (AppState won't change)
      emitNavigationEvent(navigateTo)
      return
    }

    val buzzId = intent.getStringExtra("buzz_id") ?: return
    pendingBuzzPayload = Bundle().apply {
      putString("buzz_id", buzzId)
      putString("from_user_id", intent.getStringExtra("from_user_id") ?: "")
      putString("from_user_name", intent.getStringExtra("from_user_name") ?: "")
      putString("reason", intent.getStringExtra("reason") ?: "")
      putString("note", intent.getStringExtra("note") ?: "")
      putString("sound_id", intent.getStringExtra("sound_id") ?: "buzz_alarm")
    }
    // Clear the extras so we don't re-process
    intent.removeExtra("buzz_id")
  }

  private fun emitNavigationEvent(navigateTo: String) {
    try {
      val reactContext = reactHost?.currentReactContext ?: return
      val params = Arguments.createMap().apply {
        putString("screen", navigateTo)
      }
      reactContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit("onNavigate", params)
    } catch (_: Exception) {
      // React context not ready (killed state) — handled by pendingNavigation
    }
  }
}

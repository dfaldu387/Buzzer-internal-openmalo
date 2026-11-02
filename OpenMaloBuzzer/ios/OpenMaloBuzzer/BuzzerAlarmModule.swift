import Foundation
import AVFoundation
import React

/// Native module providing iOS alarm audio session management.
///
/// Closes these Android-parity gaps:
///   - Audio focus: activateAlarmSession() sets AVAudioSession to .playback
///     with .duckOthers, which lowers other apps' audio while the alarm plays.
///     This is the closest iOS equivalent to Android's
///     AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE.
///   - Mute-switch bypass: .playback category ignores the hardware mute switch,
///     matching Android's USAGE_ALARM routing to the alarm stream.
///
/// PLATFORM LIMITATIONS (no public API, cannot be closed):
///   - Volume override: iOS has no API to programmatically set or force max
///     device volume. Android's setStreamVolume(STREAM_ALARM, maxVol) has no
///     equivalent. The alarm plays at the user's current volume setting.
///   - Ringer mode override: iOS has no API to switch from silent to normal
///     ringer mode. Android's setRingerMode(RINGER_MODE_NORMAL) has no equivalent.
///     The .playback audio category does bypass the mute switch for in-app audio,
///     but system notification sounds still respect it.
@objc(BuzzerAlarmModule)
class BuzzerAlarmModule: NSObject {

  @objc
  func activateAlarmSession(
    _ resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    let session = AVAudioSession.sharedInstance()
    do {
      // .playback: continues audio even when the mute switch is on
      // .duckOthers: lowers volume of other audio apps while our alarm plays
      try session.setCategory(.playback, mode: .default, options: [.duckOthers])
      try session.setActive(true, options: [])
      resolve(true)
    } catch {
      reject(
        "AUDIO_SESSION_ERROR",
        "Failed to activate alarm session: \(error.localizedDescription)",
        error
      )
    }
  }

  @objc
  func deactivateAlarmSession(
    _ resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    let session = AVAudioSession.sharedInstance()
    do {
      // .notifyOthersOnDeactivation tells ducked apps to restore their volume
      try session.setActive(false, options: [.notifyOthersOnDeactivation])
      resolve(true)
    } catch {
      // Deactivation can fail if another session is active; non-fatal
      resolve(false)
    }
  }

  /// No-op stub so shared JS code calling BuzzerService?.stopAlarm?.() does
  /// not throw on iOS. The actual alarm teardown (Sound + Vibration) is
  /// handled in IncomingBuzzScreen.stopIOSAlarm().
  @objc
  func stopAlarm() {
    // Intentionally empty
  }

  @objc
  static func requiresMainQueueSetup() -> Bool { return false }
}

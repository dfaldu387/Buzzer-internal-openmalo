import Foundation
import AVFoundation
import AudioToolbox
import React

/// Native module providing iOS alarm audio session management and playback.
///
/// Closes these Android-parity gaps:
///   - Audio focus: .playback category with .duckOthers lowers other apps' audio.
///   - Mute-switch bypass: .playback category ignores the hardware mute switch.
///   - Background alarm: startAlarm() plays a looping alarm via AVAudioPlayer.
///     Combined with the "audio" UIBackgroundMode in Info.plist, the alarm
///     continues playing even when the app is backgrounded — matching Android's
///     BuzzerService foreground service behavior.
///
/// PLATFORM LIMITATIONS (no public API, cannot be closed):
///   - Volume override: iOS has no API to programmatically set or force max
///     device volume. The alarm plays at the user's current volume setting.
///   - Ringer mode override: iOS has no API to switch from silent to normal
///     ringer mode. The .playback category bypasses the mute switch for in-app
///     audio, but system notification sounds still respect it.
@objc(BuzzerAlarmModule)
class BuzzerAlarmModule: NSObject {

  private var audioPlayer: AVAudioPlayer?
  private var vibrationTimer: Timer?

  @objc
  func activateAlarmSession(
    _ resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    let session = AVAudioSession.sharedInstance()
    do {
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
      try session.setActive(false, options: [.notifyOthersOnDeactivation])
      resolve(true)
    } catch {
      resolve(false)
    }
  }

  /// Start a looping alarm sound with vibration.
  /// The "audio" UIBackgroundMode keeps playback alive when the app is backgrounded.
  /// If an alarm is already playing, it is stopped and replaced.
  @objc
  func startAlarm(
    _ soundFile: String,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async { [weak self] in
      guard let self = self else { return }

      // Stop any existing alarm first
      self.teardownAlarm()

      // Configure audio session for background playback + duck others
      let session = AVAudioSession.sharedInstance()
      do {
        try session.setCategory(.playback, mode: .default, options: [.duckOthers])
        try session.setActive(true, options: [])
      } catch {
        reject("AUDIO_SESSION_ERROR", "Failed to activate session: \(error.localizedDescription)", error)
        return
      }

      // Resolve the sound file URL from the app bundle
      let url = self.resolveSound(soundFile)
      guard let soundURL = url else {
        reject("FILE_NOT_FOUND", "Sound file not found: \(soundFile)", nil)
        return
      }

      do {
        self.audioPlayer = try AVAudioPlayer(contentsOf: soundURL)
        self.audioPlayer?.numberOfLoops = -1
        self.audioPlayer?.volume = 1.0
        self.audioPlayer?.play()
        self.startVibration()
        resolve(true)
      } catch {
        reject("PLAYER_ERROR", "Failed to play: \(error.localizedDescription)", error)
      }
    }
  }

  /// Stop the alarm (audio + vibration) and deactivate the audio session.
  @objc
  func stopAlarm() {
    DispatchQueue.main.async { [weak self] in
      self?.teardownAlarm()
      try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    }
  }

  // MARK: - Private helpers

  private func teardownAlarm() {
    audioPlayer?.stop()
    audioPlayer = nil
    vibrationTimer?.invalidate()
    vibrationTimer = nil
  }

  private func resolveSound(_ soundFile: String) -> URL? {
    let nameWithoutExt = (soundFile as NSString).deletingPathExtension
    let ext = (soundFile as NSString).pathExtension
    let fileExt = ext.isEmpty ? "wav" : ext

    // Try exact match first
    if let url = Bundle.main.url(forResource: nameWithoutExt, withExtension: fileExt) {
      return url
    }
    // Fallback to buzz_alarm.wav
    return Bundle.main.url(forResource: "buzz_alarm", withExtension: "wav")
  }

  private func startVibration() {
    AudioServicesPlaySystemSound(kSystemSoundID_Vibrate)
    vibrationTimer = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: true) { _ in
      AudioServicesPlaySystemSound(kSystemSoundID_Vibrate)
    }
  }

  @objc
  static func requiresMainQueueSetup() -> Bool { return false }
}

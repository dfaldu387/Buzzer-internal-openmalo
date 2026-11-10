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
class BuzzerAlarmModule: NSObject, AVAudioPlayerDelegate {

  private var audioPlayer: AVAudioPlayer?
  private var vibrationTimer: Timer?
  private var interruptionObserver: NSObjectProtocol?
  private var currentSoundURL: URL?

  @objc
  func activateAlarmSession(
    _ resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    // Audio session calls off main thread to avoid hang risk
    DispatchQueue.global(qos: .userInteractive).async {
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
  }

  @objc
  func deactivateAlarmSession(
    _ resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.global(qos: .utility).async {
      let session = AVAudioSession.sharedInstance()
      do {
        try session.setActive(false, options: [.notifyOthersOnDeactivation])
        resolve(true)
      } catch {
        resolve(false)
      }
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
    // Audio session activation must happen OFF the main thread.
    // iOS logs "AVAudioSession Hang Risk" and may throttle or kill
    // the session if setActive(true) blocks the main thread, which
    // causes the alarm to die after ~10-12 seconds on real devices.
    DispatchQueue.global(qos: .userInteractive).async { [weak self] in
      guard let self = self else { return }

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

      // AVAudioPlayer and Timer must be created/started on the main thread
      DispatchQueue.main.async { [weak self] in
        guard let self = self else { return }

        // Stop any existing alarm first
        self.teardownAlarm()

        do {
          self.currentSoundURL = soundURL
          self.audioPlayer = try AVAudioPlayer(contentsOf: soundURL)
          self.audioPlayer?.delegate = self
          self.audioPlayer?.numberOfLoops = -1
          self.audioPlayer?.volume = 1.0
          self.audioPlayer?.prepareToPlay()
          self.audioPlayer?.play()
          self.observeInterruptions()
          self.startVibration()
          resolve(true)
        } catch {
          reject("PLAYER_ERROR", "Failed to play: \(error.localizedDescription)", error)
        }
      }
    }
  }

  /// Stop the alarm (audio + vibration) and deactivate the audio session.
  @objc
  func stopAlarm() {
    DispatchQueue.main.async { [weak self] in
      self?.teardownAlarm()
      // Deactivate audio session off main thread to avoid hang risk
      DispatchQueue.global(qos: .utility).async {
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
      }
    }
  }

  // MARK: - Private helpers

  private func teardownAlarm() {
    if let observer = interruptionObserver {
      NotificationCenter.default.removeObserver(observer)
      interruptionObserver = nil
    }
    audioPlayer?.stop()
    audioPlayer = nil
    currentSoundURL = nil
    vibrationTimer?.invalidate()
    vibrationTimer = nil
  }

  /// Resume playback after iOS audio session interruption (phone call,
  /// Siri, system sound, etc.). Without this, the alarm stops at ~10-15s
  /// when any system event briefly interrupts the audio session.
  private func observeInterruptions() {
    if interruptionObserver != nil { return }
    interruptionObserver = NotificationCenter.default.addObserver(
      forName: AVAudioSession.interruptionNotification,
      object: AVAudioSession.sharedInstance(),
      queue: .main
    ) { [weak self] notification in
      guard let self = self else { return }
      guard let info = notification.userInfo,
            let typeValue = info[AVAudioSessionInterruptionTypeKey] as? UInt,
            let type = AVAudioSession.InterruptionType(rawValue: typeValue) else { return }

      if type == .ended {
        // Re-activate session and resume playback
        let options = info[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
        if AVAudioSession.InterruptionOptions(rawValue: options).contains(.shouldResume) || true {
          try? AVAudioSession.sharedInstance().setActive(true, options: [])
          self.audioPlayer?.play()
        }
      }
    }
  }

  // MARK: - AVAudioPlayerDelegate

  /// Called when playback finishes unexpectedly (decode error, file issue).
  /// Restart the alarm from scratch to recover.
  func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: (any Error)?) {
    print("[BuzzerAlarm] Decode error: \(error?.localizedDescription ?? "unknown") — restarting")
    guard let url = currentSoundURL else { return }
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in
      guard let self = self, self.currentSoundURL != nil else { return }
      do {
        self.audioPlayer = try AVAudioPlayer(contentsOf: url)
        self.audioPlayer?.delegate = self
        self.audioPlayer?.numberOfLoops = -1
        self.audioPlayer?.volume = 1.0
        self.audioPlayer?.play()
      } catch {
        print("[BuzzerAlarm] Restart failed: \(error.localizedDescription)")
      }
    }
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

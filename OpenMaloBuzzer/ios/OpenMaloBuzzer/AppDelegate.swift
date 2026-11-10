import UIKit
import BackgroundTasks
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider
import FirebaseCore
import FirebaseMessaging

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    FirebaseApp.configure()

    // Register with APNs early so the device token is available
    // as soon as the user grants notification permission from JS.
    // Do NOT set UNUserNotificationCenter.delegate here — notifee
    // sets itself as the delegate to handle action button presses
    // (Ack, 5min, Busy) via onBackgroundEvent.
    application.registerForRemoteNotifications()

    // Register BGTaskScheduler for periodic token refresh.
    // This replaces the deprecated setMinimumBackgroundFetchInterval API.
    // iOS decides when to run it (typically every few hours for active apps).
    BGTaskScheduler.shared.register(
      forTaskWithIdentifier: "com.openmalobuzzer.token-refresh",
      using: nil
    ) { task in
      Self.handleTokenRefreshTask(task as! BGAppRefreshTask)
    }
    // Schedule the first run
    Self.scheduleTokenRefresh()

    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    // When UIScene is available (iOS 27+), the window is created in SceneDelegate.
    // For older iOS without UIScene, create the window here as fallback.
    if #unavailable(iOS 17) {
      window = UIWindow(frame: UIScreen.main.bounds)
      factory.startReactNative(
        withModuleName: "OpenMaloBuzzer",
        in: window,
        launchOptions: launchOptions
      )
    }

    return true
  }

  // MARK: APNs Token Forwarding

  func application(
    _ application: UIApplication,
    didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
  ) {
    // Forward APNs token to Firebase so FCM can deliver push notifications.
    // Firebase swizzling normally handles this, but explicit forwarding
    // is a safety net for Swift AppDelegates where swizzling can be unreliable.
    Messaging.messaging().apnsToken = deviceToken
  }

  func application(
    _ application: UIApplication,
    didFailToRegisterForRemoteNotificationsWithError error: Error
  ) {
    // Log APNs registration failure — common causes:
    //   - Running on Simulator (no APNs support)
    //   - Missing Push Notification capability in provisioning profile
    //   - No APNs key uploaded in Firebase Console
    print("[APNs] Failed to register: \(error.localizedDescription)")
  }

  // MARK: BGTaskScheduler — Periodic Token Refresh

  /// Schedule the next background app refresh task.
  /// iOS decides the actual execution time based on usage patterns.
  static func scheduleTokenRefresh() {
    let request = BGAppRefreshTaskRequest(
      identifier: "com.openmalobuzzer.token-refresh"
    )
    // Ask iOS to run no earlier than 1 hour from now.
    // iOS may delay further based on battery, usage patterns, etc.
    request.earliestBeginDate = Date(timeIntervalSinceNow: 3600)
    do {
      try BGTaskScheduler.shared.submit(request)
      print("[BGTask] Token refresh scheduled")
    } catch {
      print("[BGTask] Failed to schedule: \(error.localizedDescription)")
    }
  }

  /// Handle the background task when iOS grants execution time.
  /// Re-registers APNs token and refreshes the FCM mapping so push
  /// delivery stays alive even after days/weeks of inactivity.
  static func handleTokenRefreshTask(_ task: BGAppRefreshTask) {
    // Schedule the next run FIRST — if this task gets killed early,
    // the next one is already queued.
    scheduleTokenRefresh()

    // Re-register for remote notifications to catch APNs token rotations
    DispatchQueue.main.async {
      UIApplication.shared.registerForRemoteNotifications()
    }

    // Refresh the FCM token mapping
    Messaging.messaging().token { token, error in
      if let token = token {
        print("[BGTask] FCM token refreshed: \(token.prefix(12))...")
        task.setTaskCompleted(success: true)
      } else {
        print("[BGTask] FCM token refresh failed: \(error?.localizedDescription ?? "unknown")")
        task.setTaskCompleted(success: false)
      }
    }

    // If iOS kills this task early, mark as failed so it retries
    task.expirationHandler = {
      task.setTaskCompleted(success: false)
    }
  }

  // MARK: UISceneSession Lifecycle

  func application(
    _ application: UIApplication,
    configurationForConnecting connectingSceneSession: UISceneSession,
    options: UIScene.ConnectionOptions
  ) -> UISceneConfiguration {
    let config = UISceneConfiguration(
      name: "Default Configuration",
      sessionRole: connectingSceneSession.role
    )
    config.delegateClass = SceneDelegate.self
    return config
  }
}

// MARK: - SceneDelegate

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene else { return }
    guard let appDelegate = UIApplication.shared.delegate as? AppDelegate else { return }

    let window = UIWindow(windowScene: windowScene)
    appDelegate.reactNativeFactory?.startReactNative(
      withModuleName: "OpenMaloBuzzer",
      in: window,
      launchOptions: nil
    )
    self.window = window
    appDelegate.window = window
    window.makeKeyAndVisible()
  }

  func sceneDidEnterBackground(_ scene: UIScene) {
    // Re-schedule background token refresh every time the app backgrounds.
    // This ensures the task is always queued even if the previous one ran
    // or was cancelled by iOS.
    AppDelegate.scheduleTokenRefresh()
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}

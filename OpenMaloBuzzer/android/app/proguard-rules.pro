# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:

# Keep BuzzerService and its companion (used via reflection by React Native NativeModules)
-keep class com.buzzerapp.BuzzerService { *; }
-keep class com.buzzerapp.BuzzerService$Companion { *; }
-keep class com.buzzerapp.BuzzerServiceModule { *; }
-keep class com.buzzerapp.BuzzerServicePackage { *; }
-keep class com.buzzerapp.BootReceiver { *; }
-keep class com.buzzerapp.TokenRefreshWorker { *; }
-keep class com.buzzerapp.OemBatteryHelper { *; }
-keep class com.buzzerapp.OemBatteryHelper$* { *; }
-keep class com.buzzerapp.SupabaseConfig { *; }
-keep class com.buzzerapp.MainActivity { *; }

# Keep BuildConfig fields used by SupabaseConfig
-keep class com.buzzerapp.BuildConfig { *; }

# Firebase Messaging
-keep class com.google.firebase.messaging.** { *; }
-dontwarn com.google.firebase.messaging.**

# Supabase REST — keep JSON model classes
-keepattributes *Annotation*
-keep class org.json.** { *; }

# WorkManager
-keep class androidx.work.** { *; }

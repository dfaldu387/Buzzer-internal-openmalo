package com.openmalobuzzer

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.util.Log

/**
 * Detects OEM-specific battery restrictions and provides intents to the correct
 * settings screens. Each OEM layers its own kill system on top of stock Android
 * Doze / App Standby, and the standard ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS
 * does NOT cover them.
 *
 * This class is intentionally conservative: it only tries intents that are known
 * to resolve on the target OEM. Unresolvable intents are skipped silently.
 */
object OemBatteryHelper {

    private const val TAG = "OemBatteryHelper"

    // ─── OEM Detection ──────────────────────────────────────

    enum class Oem {
        XIAOMI, HUAWEI, SAMSUNG, OPPO, VIVO, ONEPLUS, MOTOROLA, TRANSSION, STOCK
    }

    fun detectOem(): Oem {
        val manufacturer = Build.MANUFACTURER.lowercase()
        return when {
            manufacturer.contains("xiaomi") || manufacturer.contains("redmi") || manufacturer.contains("poco") -> Oem.XIAOMI
            manufacturer.contains("huawei") || manufacturer.contains("honor") -> Oem.HUAWEI
            manufacturer.contains("samsung") -> Oem.SAMSUNG
            manufacturer.contains("oppo") || manufacturer.contains("realme") -> Oem.OPPO
            manufacturer.contains("vivo") -> Oem.VIVO
            manufacturer.contains("oneplus") -> Oem.ONEPLUS
            manufacturer.contains("motorola") || manufacturer.contains("lenovo") -> Oem.MOTOROLA
            manufacturer.contains("tecno") || manufacturer.contains("infinix") || manufacturer.contains("itel") -> Oem.TRANSSION
            else -> Oem.STOCK
        }
    }

    // ─── Stock Android Battery Optimization Check ───────────

    fun isIgnoringBatteryOptimizations(context: Context): Boolean {
        val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        return pm.isIgnoringBatteryOptimizations(context.packageName)
    }

    // ─── Request Stock Battery Optimization Exemption ───────

    /**
     * Opens the system dialog to request battery optimization exemption.
     * This is the standard Android mechanism.
     *
     * Google Play policy: Allowed for apps whose core function requires persistent
     * background work (messaging, communication, safety). The Buzzer app qualifies.
     * See: https://developer.android.com/training/monitoring-device-state/doze-standby
     */
    fun requestBatteryOptimizationExemption(context: Context): Boolean {
        if (isIgnoringBatteryOptimizations(context)) return true
        return try {
            val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                data = Uri.parse("package:${context.packageName}")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
            true
        } catch (e: Exception) {
            Log.e(TAG, "Failed to request battery exemption: ${e.message}")
            false
        }
    }

    // ─── OEM-Specific Autostart / Protected App Settings ────

    /**
     * Returns a list of intents for the current OEM's autostart / battery / protected
     * app settings, ordered by specificity. The caller should try each one and use
     * the first that resolves.
     */
    fun getOemBatteryIntents(context: Context): List<Intent> {
        val oem = detectOem()
        val intents = mutableListOf<Intent>()

        when (oem) {
            Oem.XIAOMI -> {
                // MIUI Autostart manager — this is the critical one
                intents.add(Intent().apply {
                    component = ComponentName(
                        "com.miui.securitycenter",
                        "com.miui.permcenter.autostart.AutoStartManagementActivity"
                    )
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                })
                // MIUI Battery Saver app-specific settings
                intents.add(Intent("miui.intent.action.POWER_HIDE_MODE_APP_LIST").apply {
                    putExtra("package_name", context.packageName)
                    putExtra("package_label", getAppLabel(context))
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                })
                // MIUI App Battery Saver
                intents.add(Intent("miui.intent.action.OP_AUTO_START").apply {
                    putExtra("package_name", context.packageName)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                })
            }

            Oem.HUAWEI -> {
                // EMUI App Launch Manager — three toggles: Auto-launch, Secondary launch, Run in background
                intents.add(Intent().apply {
                    component = ComponentName(
                        "com.huawei.systemmanager",
                        "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"
                    )
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                })
                // Older EMUI Protected Apps
                intents.add(Intent().apply {
                    component = ComponentName(
                        "com.huawei.systemmanager",
                        "com.huawei.systemmanager.optimize.process.ProtectActivity"
                    )
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                })
                // Battery optimization detail
                intents.add(Intent().apply {
                    component = ComponentName(
                        "com.huawei.systemmanager",
                        "com.huawei.systemmanager.power.ui.HwPowerManagerActivity"
                    )
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                })
            }

            Oem.SAMSUNG -> {
                // One UI: Remove from Sleeping / Deep Sleeping apps
                intents.add(Intent().apply {
                    component = ComponentName(
                        "com.samsung.android.lool",
                        "com.samsung.android.sm.battery.ui.BatteryActivity"
                    )
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                })
                // Samsung Device Care → Battery
                intents.add(Intent().apply {
                    component = ComponentName(
                        "com.samsung.android.lool",
                        "com.samsung.android.sm.ui.battery.BatteryActivity"
                    )
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                })
            }

            Oem.OPPO -> {
                // ColorOS Auto-launch Manager
                intents.add(Intent().apply {
                    component = ComponentName(
                        "com.coloros.safecenter",
                        "com.coloros.safecenter.startupapp.StartupAppListActivity"
                    )
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                })
                // Realme variant
                intents.add(Intent().apply {
                    component = ComponentName(
                        "com.coloros.safecenter",
                        "com.coloros.safecenter.permission.startup.StartupAppListActivity"
                    )
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                })
                // Older ColorOS
                intents.add(Intent().apply {
                    component = ComponentName(
                        "com.oppo.safe",
                        "com.oppo.safe.permission.startup.StartupAppListActivity"
                    )
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                })
            }

            Oem.VIVO -> {
                // Vivo iManager / Background App Management
                intents.add(Intent().apply {
                    component = ComponentName(
                        "com.vivo.permissionmanager",
                        "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"
                    )
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                })
                // Older Vivo
                intents.add(Intent().apply {
                    component = ComponentName(
                        "com.iqoo.secure",
                        "com.iqoo.secure.ui.phoneoptimize.BgStartUpManager"
                    )
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                })
            }

            Oem.ONEPLUS -> {
                // OxygenOS Battery Optimization
                intents.add(Intent().apply {
                    component = ComponentName(
                        "com.oneplus.security",
                        "com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity"
                    )
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                })
            }

            Oem.MOTOROLA -> {
                // Moto App Optimization
                intents.add(Intent().apply {
                    component = ComponentName(
                        "com.motorola.ccc.ota",
                        "com.motorola.ccc.ota.ui.batteryoptimization.BatteryOptimizationActivity"
                    )
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                })
            }

            Oem.TRANSSION -> {
                // Tecno/Infinix/itel Phone Master or HiOS power manager
                intents.add(Intent().apply {
                    component = ComponentName(
                        "com.transsion.phonemaster",
                        "com.cyin.chameleon.autostart.AutoStartActivity"
                    )
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                })
                intents.add(Intent().apply {
                    component = ComponentName(
                        "com.transsion.phonemaster",
                        "com.cyin.chameleon.Ede.activity.PowerSaverActivity"
                    )
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                })
            }

            Oem.STOCK -> {
                // No OEM-specific intent needed
            }
        }

        // Always add generic app info as last fallback
        intents.add(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
            data = Uri.parse("package:${context.packageName}")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        })

        return intents
    }

    /**
     * Tries to open the OEM-specific battery settings. Returns true if an intent resolved.
     */
    fun openOemBatterySettings(context: Context): Boolean {
        val intents = getOemBatteryIntents(context)
        for (intent in intents) {
            if (canResolveIntent(context, intent)) {
                try {
                    context.startActivity(intent)
                    return true
                } catch (e: Exception) {
                    Log.w(TAG, "Intent resolved but failed to start: ${e.message}")
                }
            }
        }
        // Final fallback: generic app settings
        return try {
            context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                data = Uri.parse("package:${context.packageName}")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            })
            true
        } catch (e: Exception) {
            Log.e(TAG, "Even generic settings failed: ${e.message}")
            false
        }
    }

    // ─── User-Facing Instructions ───────────────────────────

    data class OemInstructions(
        val oemName: String,
        val steps: String,
        val hasAutostart: Boolean,
        val needsManualStep: Boolean
    )

    fun getInstructions(): OemInstructions {
        return when (detectOem()) {
            Oem.XIAOMI -> OemInstructions(
                oemName = "Xiaomi/Redmi/POCO",
                steps = "1. Tap 'Open Settings' below\n" +
                        "2. Find 'Buzzer' and enable Autostart\n" +
                        "3. Go back to Settings → Apps → Buzzer → Battery Saver → No restrictions\n" +
                        "4. Also check: Settings → Battery → Battery Saver → turn OFF or exclude this app",
                hasAutostart = true,
                needsManualStep = true
            )
            Oem.HUAWEI -> OemInstructions(
                oemName = "Huawei/Honor",
                steps = "1. Tap 'Open Settings' below\n" +
                        "2. Find 'Buzzer'\n" +
                        "3. Set to 'Manage manually' and enable ALL three toggles:\n" +
                        "   - Auto-launch\n" +
                        "   - Secondary launch\n" +
                        "   - Run in background",
                hasAutostart = true,
                needsManualStep = true
            )
            Oem.SAMSUNG -> OemInstructions(
                oemName = "Samsung",
                steps = "1. Go to Settings → Battery → Background usage limits\n" +
                        "2. Tap 'Sleeping apps' — remove Buzzer if listed\n" +
                        "3. Tap 'Deep sleeping apps' — remove Buzzer if listed\n" +
                        "4. Tap 'Never sleeping apps' — add Buzzer",
                hasAutostart = false,
                needsManualStep = true
            )
            Oem.OPPO -> OemInstructions(
                oemName = "Oppo/Realme",
                steps = "1. Tap 'Open Settings' below\n" +
                        "2. Find 'Buzzer' and enable Auto-launch\n" +
                        "3. Go to Settings → Battery → Buzzer → Allow background activity",
                hasAutostart = true,
                needsManualStep = true
            )
            Oem.VIVO -> OemInstructions(
                oemName = "Vivo",
                steps = "1. Tap 'Open Settings' below\n" +
                        "2. Find 'Buzzer' and enable background autostart\n" +
                        "3. Go to Settings → Battery → High background power consumption → Allow",
                hasAutostart = true,
                needsManualStep = true
            )
            Oem.ONEPLUS -> OemInstructions(
                oemName = "OnePlus",
                steps = "1. Go to Settings → Apps → Buzzer → Battery → Don't optimize\n" +
                        "2. Also check: Settings → Battery → Battery Optimization → All apps → Buzzer → Don't optimize",
                hasAutostart = false,
                needsManualStep = true
            )
            Oem.MOTOROLA -> OemInstructions(
                oemName = "Motorola/Lenovo",
                steps = "1. Go to Settings → Battery → Adaptive Battery → turn OFF\n" +
                        "2. Go to Settings → Apps → Buzzer → Battery → Unrestricted",
                hasAutostart = false,
                needsManualStep = true
            )
            Oem.TRANSSION -> OemInstructions(
                oemName = "Tecno/Infinix/itel",
                steps = "1. Tap 'Open Settings' below\n" +
                        "2. Find 'Buzzer' and enable Autostart\n" +
                        "3. Go to Phone Master → Battery Manager → set Buzzer to 'Allow background'",
                hasAutostart = true,
                needsManualStep = true
            )
            Oem.STOCK -> OemInstructions(
                oemName = "Android",
                steps = "1. Go to Settings → Apps → Buzzer → Battery → Unrestricted",
                hasAutostart = false,
                needsManualStep = false
            )
        }
    }

    // ─── Helpers ────────────────────────────────────────────

    private fun canResolveIntent(context: Context, intent: Intent): Boolean {
        return context.packageManager.resolveActivity(
            intent, PackageManager.MATCH_DEFAULT_ONLY
        ) != null
    }

    private fun getAppLabel(context: Context): String {
        return try {
            val appInfo = context.packageManager.getApplicationInfo(context.packageName, 0)
            context.packageManager.getApplicationLabel(appInfo).toString()
        } catch (e: Exception) {
            "Buzzer"
        }
    }
}

package expo.modules.appblocker

import android.app.AppOpsManager
import android.content.Context
import android.os.Process

/** Shared check for the PACKAGE_USAGE_STATS ("Usage access") app-op. */
internal fun Context.hasUsageStatsAccess(): Boolean {
  val appOps = getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
  val mode = appOps.unsafeCheckOpNoThrow(
    AppOpsManager.OPSTR_GET_USAGE_STATS,
    Process.myUid(),
    packageName
  )
  return mode == AppOpsManager.MODE_ALLOWED
}

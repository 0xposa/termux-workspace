package com.workspace.termuxui

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.app.AppCompatDelegate
import androidx.core.content.ContextCompat
import androidx.core.os.LocaleListCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import java.net.HttpURLConnection
import java.net.URL
import java.security.SecureRandom
import java.util.Locale
import kotlin.concurrent.thread

class MainActivity : AppCompatActivity() {

    companion object {
        private const val PORT = 24817
        private const val PREFS_NAME = "termux_ws_prefs"
        private const val PREF_TOKEN = "auth_token"
        private const val PREF_LANGUAGE = "pref_app_language"
        private const val PREF_SETUP_COMPLETED = "pref_setup_completed"
        private const val PERMISSION_RUN_COMMAND = "com.termux.permission.RUN_COMMAND"
        private const val TERMUX_PACKAGE = "com.termux"
        private const val RUN_COMMAND_SERVICE = "com.termux.app.RunCommandService"
        private const val ACTION_RUN_COMMAND = "com.termux.RUN_COMMAND"
        private const val EXTRA_COMMAND_PATH = "com.termux.RUN_COMMAND_PATH"
        private const val EXTRA_ARGUMENTS = "com.termux.RUN_COMMAND_ARGUMENTS"
        private const val EXTRA_WORKDIR = "com.termux.RUN_COMMAND_WORKDIR"
        private const val EXTRA_BACKGROUND = "com.termux.RUN_COMMAND_BACKGROUND"
        private const val START_SCRIPT_PATH = "/data/data/com.termux/files/home/termux-workspace/start.sh"
        private const val WORKDIR_PATH = "/data/data/com.termux/files/home/termux-workspace"
    }

    private lateinit var rootLayout: FrameLayout
    private lateinit var webView: WebView
    private lateinit var statusLayout: LinearLayout
    private lateinit var progressBar: ProgressBar
    private lateinit var textStatus: TextView
    private lateinit var btnRetry: Button
    private lateinit var btnOpenSettings: Button
    private lateinit var btnChangeLanguage: Button

    private var isConnected = false
    private var isConnecting = false

    override fun attachBaseContext(newBase: Context) {
        val prefs = newBase.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val lang = prefs.getString(PREF_LANGUAGE, null)
        if (!lang.isNullOrEmpty()) {
            val locale = if (lang == "en") Locale.ENGLISH else Locale("id")
            val config = Configuration(newBase.resources.configuration)
            Locale.setDefault(locale)
            config.setLocale(locale)
            val localizedContext = newBase.createConfigurationContext(config)
            super.attachBaseContext(localizedContext)
            return
        }
        super.attachBaseContext(newBase)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        applyCutoutMode()
        applyFullscreen()
        setContentView(R.layout.activity_main)

        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR

        rootLayout = findViewById(R.id.root_layout)
        webView = findViewById(R.id.web_view)
        statusLayout = findViewById(R.id.status_layout)
        progressBar = findViewById(R.id.progress_bar)
        textStatus = findViewById(R.id.text_status)
        btnRetry = findViewById(R.id.btn_retry)
        btnOpenSettings = findViewById(R.id.btn_open_settings)
        btnChangeLanguage = findViewById(R.id.btn_change_language)

        setupInsets()
        setupBackHandler()
        setupWebView()

        btnRetry.setOnClickListener {
            startConnectionFlow()
        }

        btnOpenSettings.setOnClickListener {
            openAppSettings()
        }

        btnChangeLanguage.setOnClickListener {
            showLanguageDialog(isFirstSetup = false)
        }

        checkFirstSetupAndProceed()
    }

    override fun onResume() {
        super.onResume()
        if (isSetupCompleted() && !isConnected && !isConnecting && hasRunCommandPermission()) {
            startConnectionFlow()
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) {
            applyCutoutMode()
            applyFullscreen()
        }
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        applyCutoutMode()
        applyFullscreen()
    }

    private fun applyCutoutMode() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val params = window.attributes
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                params.layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
            } else {
                params.layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            }
            window.attributes = params
        }
    }

    private fun applyFullscreen() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val insetsController = WindowCompat.getInsetsController(window, window.decorView)
        insetsController.hide(WindowInsetsCompat.Type.systemBars())
        insetsController.systemBarsBehavior =
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    }

    private fun setupInsets() {
        ViewCompat.setOnApplyWindowInsetsListener(rootLayout) { _, insets ->
            val imeInsets = insets.getInsets(WindowInsetsCompat.Type.ime())
            rootLayout.setPadding(0, 0, 0, imeInsets.bottom)
            if (!insets.isVisible(WindowInsetsCompat.Type.ime())) {
                applyFullscreen()
            }
            insets
        }
    }

    private fun setupBackHandler() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                moveTaskToBack(true)
            }
        })
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            cacheMode = WebSettings.LOAD_DEFAULT
        }
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        CookieManager.getInstance().setAcceptCookie(true)

        webView.webViewClient = object : WebViewClient() {
            // Mempertahankan navigasi internal dalam WebView
        }
    }

    private fun isSetupCompleted(): Boolean {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getBoolean(PREF_SETUP_COMPLETED, false)
    }

    private fun checkFirstSetupAndProceed() {
        if (!isSetupCompleted()) {
            showLanguageDialog(isFirstSetup = true)
        } else {
            checkPermissionAndProceed()
        }
    }

    private fun showLanguageDialog(isFirstSetup: Boolean) {
        val languages = arrayOf("🇮🇩 Bahasa Indonesia", "🇬🇧 English")
        val langCodes = arrayOf("id", "en")

        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val currentLang = prefs.getString(PREF_LANGUAGE, "id") ?: "id"
        var selectedIndex = if (currentLang == "en") 1 else 0

        val builder = AlertDialog.Builder(this, R.style.Theme_TermuxWorkspace_Dialog)
            .setTitle(R.string.dialog_choose_language_title)
            .setSingleChoiceItems(languages, selectedIndex) { _, which ->
                selectedIndex = which
            }
            .setPositiveButton(R.string.btn_confirm) { dialog, _ ->
                val selectedLang = langCodes[selectedIndex]
                val changed = (selectedLang != currentLang)
                prefs.edit()
                    .putBoolean(PREF_SETUP_COMPLETED, true)
                    .putString(PREF_LANGUAGE, selectedLang)
                    .apply()
                dialog.dismiss()

                AppCompatDelegate.setApplicationLocales(LocaleListCompat.forLanguageTags(selectedLang))

                if (isFirstSetup) {
                    if (changed) {
                        recreate()
                    } else {
                        checkPermissionAndProceed()
                    }
                } else {
                    if (changed) {
                        recreate()
                    }
                }
            }

        if (!isFirstSetup) {
            builder.setNegativeButton(android.R.string.cancel, null)
        } else {
            builder.setCancelable(false)
        }

        builder.show()
    }

    private fun checkPermissionAndProceed() {
        if (!isTermuxInstalled()) {
            showError(getString(R.string.termux_not_installed))
            return
        }

        if (!hasRunCommandPermission()) {
            showPermissionGuideDialog()
        } else {
            startConnectionFlow()
        }
    }

    private fun hasRunCommandPermission(): Boolean {
        return ContextCompat.checkSelfPermission(
            this,
            PERMISSION_RUN_COMMAND
        ) == PackageManager.PERMISSION_GRANTED
    }

    private fun showPermissionGuideDialog() {
        AlertDialog.Builder(this, R.style.Theme_TermuxWorkspace_Dialog)
            .setTitle(R.string.dialog_perm_title)
            .setMessage(R.string.dialog_perm_message)
            .setCancelable(false)
            .setPositiveButton(R.string.btn_open_settings) { dialog, _ ->
                dialog.dismiss()
                openAppSettings()
            }
            .setNegativeButton(R.string.btn_later) { dialog, _ ->
                dialog.dismiss()
                startConnectionFlow()
            }
            .show()
    }

    private fun openAppSettings() {
        try {
            val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                data = Uri.fromParts("package", packageName, null)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            startActivity(intent)
        } catch (e: Exception) {
            try {
                val intent = Intent(Settings.ACTION_SETTINGS).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                startActivity(intent)
            } catch (_: Exception) {}
        }
    }

    private fun isTermuxInstalled(): Boolean {
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                packageManager.getPackageInfo(TERMUX_PACKAGE, PackageManager.PackageInfoFlags.of(0))
            } else {
                @Suppress("DEPRECATION")
                packageManager.getPackageInfo(TERMUX_PACKAGE, 0)
            }
            true
        } catch (e: PackageManager.NameNotFoundException) {
            false
        }
    }

    private fun getOrCreateToken(): String {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        var token = prefs.getString(PREF_TOKEN, null)
        if (token == null || token.length != 64) {
            val bytes = ByteArray(32)
            SecureRandom().nextBytes(bytes)
            token = bytes.joinToString("") { "%02x".format(it) }
            prefs.edit().putString(PREF_TOKEN, token).apply()
        }
        return token
    }

    private fun startConnectionFlow() {
        if (!isTermuxInstalled()) {
            showError(getString(R.string.termux_not_installed))
            return
        }

        isConnecting = true
        showLoading(getString(R.string.connecting_server))

        val token = getOrCreateToken()

        thread(start = true, name = "TermuxConnector") {
            val isHealthy = checkHealth(token)
            if (isHealthy) {
                isConnected = true
                isConnecting = false
                runOnUiThread {
                    loadAppUrl(token)
                }
                return@thread
            }

            triggerRunCommand(token)

            var connected = false
            val maxAttempts = 50
            for (attempt in 1..maxAttempts) {
                try {
                    Thread.sleep(500)
                } catch (e: InterruptedException) {
                    break
                }
                if (checkHealth(token)) {
                    connected = true
                    break
                }
            }

            isConnected = connected
            isConnecting = false
            runOnUiThread {
                if (connected) {
                    loadAppUrl(token)
                } else {
                    showError(getString(R.string.server_connection_failed))
                }
            }
        }
    }

    private fun checkHealth(token: String): Boolean {
        var connection: HttpURLConnection? = null
        return try {
            val url = URL("http://127.0.0.1:$PORT/health?token=$token")
            connection = url.openConnection() as HttpURLConnection
            connection.requestMethod = "GET"
            connection.connectTimeout = 1000
            connection.readTimeout = 1000
            connection.instanceFollowRedirects = false
            connection.responseCode == 200
        } catch (e: Exception) {
            false
        } finally {
            connection?.disconnect()
        }
    }

    private fun triggerRunCommand(token: String) {
        val intent = Intent().apply {
            setClassName(TERMUX_PACKAGE, RUN_COMMAND_SERVICE)
            action = ACTION_RUN_COMMAND
            putExtra(EXTRA_COMMAND_PATH, START_SCRIPT_PATH)
            putExtra(EXTRA_ARGUMENTS, arrayOf("--token", token, "--port", PORT.toString(), "--restart"))
            putExtra(EXTRA_WORKDIR, WORKDIR_PATH)
            putExtra(EXTRA_BACKGROUND, true)
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(intent)
            } else {
                startService(intent)
            }
        } catch (e: Exception) {
            // Exception ditangani secara aman tanpa menghentikan aplikasi
        }
    }

    private fun loadAppUrl(token: String) {
        statusLayout.visibility = View.GONE
        webView.visibility = View.VISIBLE
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val lang = prefs.getString(PREF_LANGUAGE, "id") ?: "id"
        webView.loadUrl("http://127.0.0.1:$PORT/?token=$token&lang=$lang")
    }

    private fun showLoading(message: String) {
        webView.visibility = View.GONE
        statusLayout.visibility = View.VISIBLE
        progressBar.visibility = View.VISIBLE
        btnRetry.visibility = View.GONE
        btnOpenSettings.visibility = View.GONE
        btnChangeLanguage.visibility = View.GONE
        textStatus.text = message
    }

    private fun showError(message: String) {
        webView.visibility = View.GONE
        statusLayout.visibility = View.VISIBLE
        progressBar.visibility = View.GONE
        btnRetry.visibility = View.VISIBLE
        btnOpenSettings.visibility = if (!hasRunCommandPermission()) View.VISIBLE else View.GONE
        btnChangeLanguage.visibility = View.VISIBLE
        textStatus.text = message
    }
}

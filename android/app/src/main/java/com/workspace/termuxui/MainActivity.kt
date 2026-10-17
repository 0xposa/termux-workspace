package com.workspace.termuxui

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.View
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
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import java.net.HttpURLConnection
import java.net.URL
import java.security.SecureRandom
import kotlin.concurrent.thread

class MainActivity : AppCompatActivity() {

    companion object {
        private const val PORT = 24817
        private const val PREFS_NAME = "termux_ws_prefs"
        private const val PREF_TOKEN = "auth_token"
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

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR
        applyFullscreen()

        rootLayout = findViewById(R.id.root_layout)
        webView = findViewById(R.id.web_view)
        statusLayout = findViewById(R.id.status_layout)
        progressBar = findViewById(R.id.progress_bar)
        textStatus = findViewById(R.id.text_status)
        btnRetry = findViewById(R.id.btn_retry)

        setupInsets()
        setupBackHandler()
        setupWebView()

        btnRetry.setOnClickListener {
            startConnectionFlow()
        }

        startConnectionFlow()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) {
            applyFullscreen()
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
        // Langkah 1: Cek Termux terpasang
        if (!isTermuxInstalled()) {
            showError(getString(R.string.termux_not_installed))
            return
        }

        showLoading(getString(R.string.connecting_server))

        // Langkah 2: Ambil token dari SharedPreferences
        val token = getOrCreateToken()

        // Jalankan alur cek dan nyalakan server di thread latar belakang
        thread(start = true, name = "TermuxConnector") {
            // Langkah 3: GET /health?token=<token>
            val isHealthy = checkHealth(token)
            if (isHealthy) {
                // Langkah 5: Langsung loadUrl jika server sudah aktif
                runOnUiThread {
                    loadAppUrl(token)
                }
                return@thread
            }

            // Langkah 4: Kirim RUN_COMMAND intent ke Termux RunCommandService
            triggerRunCommand(token)

            // Cek /health tiap 500 ms sampai 25 detik (maksimal 50 kali)
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
        webView.loadUrl("http://127.0.0.1:$PORT/?token=$token")
    }

    private fun showLoading(message: String) {
        webView.visibility = View.GONE
        statusLayout.visibility = View.VISIBLE
        progressBar.visibility = View.VISIBLE
        btnRetry.visibility = View.GONE
        textStatus.text = message
    }

    private fun showError(message: String) {
        webView.visibility = View.GONE
        statusLayout.visibility = View.VISIBLE
        progressBar.visibility = View.GONE
        btnRetry.visibility = View.VISIBLE
        textStatus.text = message
    }
}

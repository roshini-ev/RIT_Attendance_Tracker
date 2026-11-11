package com.rit.attendancetracker;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Bundle;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.TextView;

import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

import com.google.android.gms.auth.api.identity.GetPhoneNumberHintIntentRequest;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.CommonStatusCodes;
import com.google.android.material.button.MaterialButton;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;

import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

public class MainActivity extends AppCompatActivity {

    public static final String BASE_URL = "https://rit-attendance-tracker.vercel.app";
    public static final String TRUSTED_HOST = "rit-attendance-tracker.vercel.app";
    private static final String PREFS_NAME = "rit_phone_session_prefs";
    private static final String KEY_STAFF_ID = "active_staff_id";
    private static final String KEY_PHONE_NUMBER = "selected_phone_number";
    private static final String KEY_SESSION_DATE = "selection_date";
    private static final String VALUE_UNAVAILABLE = "Unavailable";

    private WebView webView;
    private SwipeRefreshLayout swipeRefreshLayout;
    private ProgressBar topProgressBar;
    private LinearLayout loadingOverlay;
    private LinearLayout errorOverlay;

    private volatile String currentVerifiedOriginUrl = "";
    private volatile String activeStaffId = "";
    private volatile String confirmedPhoneNumber = "";

    private boolean hintLaunchedInCurrentLogin = false;
    private boolean isHintDialogOpen = false;
    private boolean mainFrameHasError = false;
    private boolean initialLoadFinished = false;

    private String pendingGeoOrigin = null;
    private GeolocationPermissions.Callback pendingGeoCallback = null;

    private ActivityResultLauncher<IntentSenderRequest> phoneNumberHintLauncher;
    private ActivityResultLauncher<String[]> locationPermissionLauncher;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        bindViews();
        registerActivityResultLaunchers();
        configureWebView();
        configureBackNavigation();

        swipeRefreshLayout.setOnChildScrollUpCallback((parent, child) ->
                webView != null && webView.getScrollY() > 0);
        swipeRefreshLayout.setOnRefreshListener(() -> {
            if (isNetworkAvailable()) {
                mainFrameHasError = false;
                webView.reload();
            } else {
                swipeRefreshLayout.setRefreshing(false);
                showNetworkError();
            }
        });

        MaterialButton retryButton = findViewById(R.id.retryButton);
        retryButton.setOnClickListener(v -> loadPortal());

        loadPortal();
    }

    private void bindViews() {
        webView = findViewById(R.id.webView);
        swipeRefreshLayout = findViewById(R.id.swipeRefreshLayout);
        topProgressBar = findViewById(R.id.topProgressBar);
        loadingOverlay = findViewById(R.id.loadingOverlay);
        errorOverlay = findViewById(R.id.errorOverlay);
    }

    private void registerActivityResultLaunchers() {
        phoneNumberHintLauncher = registerForActivityResult(
                new ActivityResultContracts.StartIntentSenderForResult(),
                result -> {
                    isHintDialogOpen = false;
                    if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
                        try {
                            String phone = Identity.getSignInClient(this)
                                    .getPhoneNumberFromIntent(result.getData());
                            if (!TextUtils.isEmpty(phone) && !phone.trim().isEmpty()) {
                                confirmPhoneSelection(phone.trim());
                            } else {
                                showUnavailableSelectionDialog();
                            }
                        } catch (ApiException e) {
                            if (e.getStatusCode() == CommonStatusCodes.CANCELED) {
                                cancelPhoneSelection();
                            } else {
                                showUnavailableSelectionDialog();
                            }
                        } catch (Exception e) {
                            showUnavailableSelectionDialog();
                        }
                    } else {
                        // Cancelled by user -> do NOT assign Unavailable; keep PUSH disabled
                        cancelPhoneSelection();
                    }
                }
        );

        locationPermissionLauncher = registerForActivityResult(
                new ActivityResultContracts.RequestMultiplePermissions(),
                permissions -> {
                    if (pendingGeoCallback != null && pendingGeoOrigin != null) {
                        boolean fine = Boolean.TRUE.equals(permissions.get(Manifest.permission.ACCESS_FINE_LOCATION));
                        boolean coarse = Boolean.TRUE.equals(permissions.get(Manifest.permission.ACCESS_COARSE_LOCATION));
                        pendingGeoCallback.invoke(pendingGeoOrigin, fine || coarse, false);
                        pendingGeoCallback = null;
                        pendingGeoOrigin = null;
                    }
                }
        );
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView() {
        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(webView, true);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setGeolocationEnabled(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);

        String defaultUA = settings.getUserAgentString();
        settings.setUserAgentString(defaultUA + " RITAttendanceAndroidApp/1.0");

        webView.addJavascriptInterface(new WebAppInterface(this), "AndroidBridge");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (uri == null) return true;

                String scheme = uri.getScheme();
                String host = uri.getHost();
                if ("https".equalsIgnoreCase(scheme) && TRUSTED_HOST.equalsIgnoreCase(host)) {
                    return false;
                }

                // External URLs open in system browser rather than privileged bridge WebView
                try {
                    Intent externalIntent = new Intent(Intent.ACTION_VIEW, uri);
                    startActivity(externalIntent);
                } catch (Exception ignored) {
                }
                return true;
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                currentVerifiedOriginUrl = url != null ? url : "";
                mainFrameHasError = false;
                errorOverlay.setVisibility(View.GONE);

                if (url != null) {
                    String path = Uri.parse(url).getPath();
                    if ("/logout".equals(path) || "/login".equals(path)) {
                        clearPhoneSelectionSession();
                    }
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                currentVerifiedOriginUrl = url != null ? url : "";
                swipeRefreshLayout.setRefreshing(false);
                topProgressBar.setVisibility(View.GONE);

                if (!mainFrameHasError) {
                    initialLoadFinished = true;
                    loadingOverlay.setVisibility(View.GONE);
                    errorOverlay.setVisibility(View.GONE);
                }

                CookieManager.getInstance().flush();
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                super.onReceivedError(view, request, error);
                if (request != null && request.isForMainFrame()) {
                    mainFrameHasError = true;
                    swipeRefreshLayout.setRefreshing(false);
                    loadingOverlay.setVisibility(View.GONE);
                    showNetworkError();
                }
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                if (newProgress < 100) {
                    topProgressBar.setVisibility(View.VISIBLE);
                    topProgressBar.setProgress(newProgress);
                } else {
                    topProgressBar.setVisibility(View.GONE);
                }
            }

            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                if (origin == null || !origin.startsWith(BASE_URL)) {
                    callback.invoke(origin, false, false);
                    return;
                }

                if (hasLocationPermission()) {
                    callback.invoke(origin, true, false);
                } else {
                    pendingGeoOrigin = origin;
                    pendingGeoCallback = callback;
                    locationPermissionLauncher.launch(new String[]{
                            Manifest.permission.ACCESS_FINE_LOCATION,
                            Manifest.permission.ACCESS_COARSE_LOCATION
                    });
                }
            }
        });
    }

    private void configureBackNavigation() {
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (webView != null && webView.canGoBack()) {
                    String currentUrl = webView.getUrl();
                    if (currentUrl != null && (currentUrl.endsWith("/login") || currentUrl.endsWith("/staff") || currentUrl.equals(BASE_URL + "/"))) {
                        finish();
                    } else {
                        webView.goBack();
                    }
                } else {
                    finish();
                }
            }
        });
    }

    private void loadPortal() {
        if (!isNetworkAvailable()) {
            loadingOverlay.setVisibility(View.GONE);
            showNetworkError();
            return;
        }
        mainFrameHasError = false;
        errorOverlay.setVisibility(View.GONE);
        if (!initialLoadFinished) {
            loadingOverlay.setVisibility(View.VISIBLE);
        }
        webView.loadUrl(BASE_URL + "/");
    }

    private void showNetworkError() {
        errorOverlay.setVisibility(View.VISIBLE);
    }

    private boolean isNetworkAvailable() {
        ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) return false;
        NetworkCapabilities nc = cm.getNetworkCapabilities(cm.getActiveNetwork());
        return nc != null && (nc.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
                || nc.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)
                || nc.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET));
    }

    private boolean hasLocationPermission() {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                || ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    public boolean isTrustedOrigin() {
        String url = currentVerifiedOriginUrl;
        if (TextUtils.isEmpty(url)) {
            return false;
        }
        Uri uri = Uri.parse(url);
        return "https".equalsIgnoreCase(uri.getScheme())
                && TRUSTED_HOST.equalsIgnoreCase(uri.getHost());
    }

    public String getConfirmedPhoneNumber() {
        if (TextUtils.isEmpty(confirmedPhoneNumber)) {
            // Safely check stored selection if activeStaffId matches today's active session
            if (!TextUtils.isEmpty(activeStaffId)) {
                SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
                String savedSid = prefs.getString(KEY_STAFF_ID, "");
                String savedPhone = prefs.getString(KEY_PHONE_NUMBER, "");
                String savedDate = prefs.getString(KEY_SESSION_DATE, "");
                if (activeStaffId.equals(savedSid) && getTodayIst().equals(savedDate) && !TextUtils.isEmpty(savedPhone)) {
                    confirmedPhoneNumber = savedPhone;
                }
            }
        }
        return confirmedPhoneNumber == null ? "" : confirmedPhoneNumber;
    }

    public void handleLoginPageLoaded() {
        clearPhoneSelectionSession();
    }

    public void handleStaffLoggedOut() {
        clearPhoneSelectionSession();
        notifyWebPhoneCleared();
    }

    public void handleStaffPageLoaded(@NonNull String staffId, boolean alreadyPushed) {
        String cleanSid = staffId.trim().toUpperCase(Locale.US);
        if (cleanSid.isEmpty()) {
            return;
        }

        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        String savedSid = prefs.getString(KEY_STAFF_ID, "");
        String savedPhone = prefs.getString(KEY_PHONE_NUMBER, "");
        String savedDate = prefs.getString(KEY_SESSION_DATE, "");

        String today = getTodayIst();

        // Check if saved valid selection exists for THIS staff member and TODAY's session
        if (cleanSid.equals(savedSid) && today.equals(savedDate) && !TextUtils.isEmpty(savedPhone)) {
            activeStaffId = cleanSid;
            confirmedPhoneNumber = savedPhone;
            notifyWebPhoneSelected(savedPhone);
            return;
        }

        // Different user, expired date, or not yet selected
        if (!cleanSid.equals(activeStaffId)) {
            clearPhoneSelectionSession();
            activeStaffId = cleanSid;
        } else {
            confirmedPhoneNumber = "";
        }

        notifyWebPhoneCleared();

        if (!alreadyPushed && !hintLaunchedInCurrentLogin && !isHintDialogOpen) {
            hintLaunchedInCurrentLogin = true;
            launchPhoneNumberHint();
        }
    }

    public void requestPhoneNumberHintManually() {
        if (!isHintDialogOpen && !TextUtils.isEmpty(activeStaffId)) {
            launchPhoneNumberHint();
        }
    }

    private void launchPhoneNumberHint() {
        if (isFinishing() || isDestroyed() || isHintDialogOpen) {
            return;
        }
        isHintDialogOpen = true;

        GetPhoneNumberHintIntentRequest request = GetPhoneNumberHintIntentRequest.builder().build();
        Identity.getSignInClient(this)
                .getPhoneNumberHintIntent(request)
                .addOnSuccessListener(this, pendingIntent -> {
                    try {
                        IntentSenderRequest intentSenderRequest = new IntentSenderRequest.Builder(
                                pendingIntent.getIntentSender()).build();
                        phoneNumberHintLauncher.launch(intentSenderRequest);
                    } catch (Exception e) {
                        isHintDialogOpen = false;
                        showUnavailableSelectionDialog();
                    }
                })
                .addOnFailureListener(this, e -> {
                    isHintDialogOpen = false;
                    // No usable phone number found on device or Google Play Services error
                    // Display the explicit "Unavailable" selection interface
                    showUnavailableSelectionDialog();
                });
    }

    private void showUnavailableSelectionDialog() {
        if (isFinishing() || isDestroyed() || isHintDialogOpen) {
            return;
        }
        isHintDialogOpen = true;

        int padH = dpToPx(24);
        int padV = dpToPx(12);

        LinearLayout container = new LinearLayout(this);
        container.setOrientation(LinearLayout.VERTICAL);
        container.setPadding(padH, padV, padH, dpToPx(4));

        TextView msgView = new TextView(this);
        msgView.setText(R.string.phone_unavailable_message);
        msgView.setTextSize(14f);
        msgView.setTextColor(ContextCompat.getColor(this, R.color.text_secondary));
        msgView.setPadding(0, 0, 0, dpToPx(14));
        container.addView(msgView);

        RadioGroup radioGroup = new RadioGroup(this);
        radioGroup.setOrientation(RadioGroup.VERTICAL);

        final RadioButton unavailableOption = new RadioButton(this);
        unavailableOption.setId(View.generateViewId());
        unavailableOption.setText(R.string.phone_unavailable_option);
        unavailableOption.setTextSize(16f);
        unavailableOption.setTextColor(ContextCompat.getColor(this, R.color.text_primary));
        unavailableOption.setGravity(Gravity.CENTER_VERTICAL);
        unavailableOption.setPadding(dpToPx(8), dpToPx(10), dpToPx(8), dpToPx(10));
        unavailableOption.setLayoutParams(new RadioGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        radioGroup.addView(unavailableOption);
        container.addView(radioGroup);

        AlertDialog dialog = new MaterialAlertDialogBuilder(this)
                .setTitle(R.string.phone_unavailable_title)
                .setView(container)
                .setPositiveButton("Confirm", (d, which) -> {
                    isHintDialogOpen = false;
                    if (unavailableOption.isChecked()) {
                        confirmPhoneSelection(VALUE_UNAVAILABLE);
                    } else {
                        cancelPhoneSelection();
                    }
                })
                .setNegativeButton(R.string.cancel, (d, which) -> {
                    isHintDialogOpen = false;
                    cancelPhoneSelection();
                })
                .setOnCancelListener(d -> {
                    isHintDialogOpen = false;
                    cancelPhoneSelection();
                })
                .create();

        dialog.setCanceledOnTouchOutside(false);
        dialog.show();

        final android.widget.Button confirmBtn = dialog.getButton(AlertDialog.BUTTON_POSITIVE);
        confirmBtn.setEnabled(false);

        radioGroup.setOnCheckedChangeListener((group, checkedId) -> {
            confirmBtn.setEnabled(checkedId == unavailableOption.getId());
        });
    }

    private void confirmPhoneSelection(@NonNull String phoneNumber) {
        confirmedPhoneNumber = phoneNumber;

        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        prefs.edit()
                .putString(KEY_STAFF_ID, activeStaffId)
                .putString(KEY_PHONE_NUMBER, phoneNumber)
                .putString(KEY_SESSION_DATE, getTodayIst())
                .apply();

        notifyWebPhoneSelected(phoneNumber);
    }

    private void cancelPhoneSelection() {
        confirmedPhoneNumber = "";
        notifyWebPhoneCancelled();
    }

    private void clearPhoneSelectionSession() {
        activeStaffId = "";
        confirmedPhoneNumber = "";
        hintLaunchedInCurrentLogin = false;

        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        prefs.edit().clear().apply();
    }

    private void notifyWebPhoneSelected(@NonNull String phoneNumber) {
        if (webView == null || !isTrustedOrigin()) return;
        String quoted = JSONObject.quote(phoneNumber);
        webView.evaluateJavascript(
                "if (window.onNativePhoneSelected) { window.onNativePhoneSelected(" + quoted + "); }",
                null
        );
    }

    private void notifyWebPhoneCleared() {
        if (webView == null || !isTrustedOrigin()) return;
        webView.evaluateJavascript(
                "if (window.onNativePhoneCleared) { window.onNativePhoneCleared(); }",
                null
        );
    }

    private void notifyWebPhoneCancelled() {
        if (webView == null || !isTrustedOrigin()) return;
        webView.evaluateJavascript(
                "if (window.onNativePhoneCancelled) { window.onNativePhoneCancelled(); }",
                null
        );
    }

    private String getTodayIst() {
        SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
        sdf.setTimeZone(TimeZone.getTimeZone("Asia/Kolkata"));
        return sdf.format(new Date());
    }

    private int dpToPx(int dp) {
        float density = getResources().getDisplayMetrics().density;
        return Math.round(dp * density);
    }

    @Override
    protected void onPause() {
        super.onPause();
        CookieManager.getInstance().flush();
    }

    @Override
    protected void onStop() {
        super.onStop();
        CookieManager.getInstance().flush();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.removeJavascriptInterface("AndroidBridge");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}

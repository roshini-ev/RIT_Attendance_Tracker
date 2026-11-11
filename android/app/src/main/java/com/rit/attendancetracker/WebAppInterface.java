package com.rit.attendancetracker;

import android.webkit.JavascriptInterface;

/**
 * Secure JavaScript bridge exposed ONLY to the trusted RIT Vercel application origin.
 */
public class WebAppInterface {

    private final MainActivity mainActivity;

    public WebAppInterface(MainActivity mainActivity) {
        this.mainActivity = mainActivity;
    }

    @JavascriptInterface
    public void onLoginPageLoaded() {
        if (!mainActivity.isTrustedOrigin()) {
            return;
        }
        mainActivity.runOnUiThread(mainActivity::handleLoginPageLoaded);
    }

    @JavascriptInterface
    public void onStaffLoggedOut() {
        if (!mainActivity.isTrustedOrigin()) {
            return;
        }
        mainActivity.runOnUiThread(mainActivity::handleStaffLoggedOut);
    }

    @JavascriptInterface
    public void onStaffPageLoaded(String staffId, boolean alreadyPushed) {
        if (!mainActivity.isTrustedOrigin()) {
            return;
        }
        final String cleanSid = staffId == null ? "" : staffId.trim();
        mainActivity.runOnUiThread(() -> mainActivity.handleStaffPageLoaded(cleanSid, alreadyPushed));
    }

    @JavascriptInterface
    public void requestPhoneNumberHint() {
        if (!mainActivity.isTrustedOrigin()) {
            return;
        }
        mainActivity.runOnUiThread(mainActivity::requestPhoneNumberHintManually);
    }

    @JavascriptInterface
    public String getSelectedPhoneNumber() {
        if (!mainActivity.isTrustedOrigin()) {
            return "";
        }
        return mainActivity.getConfirmedPhoneNumber();
    }
}

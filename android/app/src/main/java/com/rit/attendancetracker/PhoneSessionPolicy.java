package com.rit.attendancetracker;

import java.net.URI;
import java.util.Locale;

/**
 * Pure Java security and phone-session rules shared between {@link MainActivity}
 * and JVM unit tests.
 */
public final class PhoneSessionPolicy {

    public static final String TRUSTED_HOST = "rit-attendance-tracker.vercel.app";
    public static final String VALUE_UNAVAILABLE = "Unavailable";

    private PhoneSessionPolicy() {
    }

    /**
     * Verifies that the active WebView origin strictly matches HTTPS + the trusted Vercel host.
     */
    public static boolean isTrustedOriginUrl(String url) {
        if (url == null || url.trim().isEmpty()) {
            return false;
        }
        try {
            URI uri = URI.create(url.trim());
            int port = uri.getPort();
            return "https".equalsIgnoreCase(uri.getScheme())
                    && TRUSTED_HOST.equalsIgnoreCase(uri.getHost())
                    && (port == -1 || port == 443)
                    && (uri.getUserInfo() == null || uri.getUserInfo().isEmpty());
        } catch (IllegalArgumentException e) {
            return false;
        }
    }

    public static String normalizeStaffId(String staffId) {
        return staffId == null ? "" : staffId.trim().toUpperCase(Locale.US);
    }

    public static String normalizeHintPhoneNumber(String rawPhone) {
        return rawPhone == null ? "" : rawPhone.trim();
    }

    /**
     * Checks whether a persisted phone selection belongs to the currently authenticated staff ID
     * and today's IST attendance date.
     */
    public static boolean isSavedSessionValid(
            String currentStaffId,
            String savedStaffId,
            String savedPhone,
            String savedDate,
            String todayDate
    ) {
        String cleanCurrent = normalizeStaffId(currentStaffId);
        String cleanSaved = normalizeStaffId(savedStaffId);
        if (cleanCurrent.isEmpty() || !cleanCurrent.equals(cleanSaved)) {
            return false;
        }
        if (todayDate == null || todayDate.trim().isEmpty() || !todayDate.equals(savedDate)) {
            return false;
        }
        return savedPhone != null && !savedPhone.trim().isEmpty();
    }

    /**
     * Determines whether PUSH should be enabled for the current session state.
     */
    public static boolean canEnablePush(boolean isLoggedIn, boolean alreadyPushed, String selectedPhone) {
        return isLoggedIn
                && !alreadyPushed
                && selectedPhone != null
                && !selectedPhone.trim().isEmpty();
    }
}

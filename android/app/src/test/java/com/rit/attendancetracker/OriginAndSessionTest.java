package com.rit.attendancetracker;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

/**
 * JVM unit tests covering trusted WebView origin verification and mandatory
 * phone-selection session rules.
 */
public class OriginAndSessionTest {

    @Test
    public void trustedOrigin_acceptsExactProductionVercelOrigin() {
        assertTrue(PhoneSessionPolicy.isTrustedOriginUrl("https://rit-attendance-tracker.vercel.app"));
        assertTrue(PhoneSessionPolicy.isTrustedOriginUrl("https://rit-attendance-tracker.vercel.app/"));
        assertTrue(PhoneSessionPolicy.isTrustedOriginUrl("https://rit-attendance-tracker.vercel.app/staff"));
        assertTrue(PhoneSessionPolicy.isTrustedOriginUrl("https://rit-attendance-tracker.vercel.app:443/login"));
    }

    @Test
    public void trustedOrigin_rejectsUntrustedSchemesHostsAndMalformedUrls() {
        assertFalse(PhoneSessionPolicy.isTrustedOriginUrl(null));
        assertFalse(PhoneSessionPolicy.isTrustedOriginUrl(""));
        assertFalse(PhoneSessionPolicy.isTrustedOriginUrl("http://rit-attendance-tracker.vercel.app"));
        assertFalse(PhoneSessionPolicy.isTrustedOriginUrl("https://evil-rit-attendance-tracker.vercel.app"));
        assertFalse(PhoneSessionPolicy.isTrustedOriginUrl("https://rit-attendance-tracker.vercel.app.evil.com"));
        assertFalse(PhoneSessionPolicy.isTrustedOriginUrl("https://user@rit-attendance-tracker.vercel.app"));
        assertFalse(PhoneSessionPolicy.isTrustedOriginUrl("https://rit-attendance-tracker.vercel.app:8443"));
        assertFalse(PhoneSessionPolicy.isTrustedOriginUrl("javascript:alert(1)"));
        assertFalse(PhoneSessionPolicy.isTrustedOriginUrl("not a valid uri"));
    }

    @Test
    public void sessionValidation_restoresOnlyForMatchingStaffAndToday() {
        assertTrue(PhoneSessionPolicy.isSavedSessionValid(
                "staff001", "STAFF001", "+919876543210", "2026-11-11", "2026-11-11"));
        assertTrue(PhoneSessionPolicy.isSavedSessionValid(
                "STAFF002", "STAFF002", "Unavailable", "2026-11-11", "2026-11-11"));

        // Different staff ID must not inherit previous staff's selection
        assertFalse(PhoneSessionPolicy.isSavedSessionValid(
                "STAFF002", "STAFF001", "+919876543210", "2026-11-11", "2026-11-11"));
        // Stale date must require fresh selection
        assertFalse(PhoneSessionPolicy.isSavedSessionValid(
                "STAFF001", "STAFF001", "+919876543210", "2026-11-10", "2026-11-11"));
        // Empty phone or empty staff cannot satisfy session
        assertFalse(PhoneSessionPolicy.isSavedSessionValid(
                "STAFF001", "STAFF001", "", "2026-11-11", "2026-11-11"));
        assertFalse(PhoneSessionPolicy.isSavedSessionValid(
                "", "STAFF001", "+919876543210", "2026-11-11", "2026-11-11"));
    }

    @Test
    public void pushState_requiresLoginNotPushedAndValidSelection() {
        // Before login -> disabled
        assertFalse(PhoneSessionPolicy.canEnablePush(false, false, "+919876543210"));
        // Pending or cancelled hint (empty string) -> disabled
        assertFalse(PhoneSessionPolicy.canEnablePush(true, false, ""));
        assertFalse(PhoneSessionPolicy.canEnablePush(true, false, null));
        // Already pushed today -> disabled
        assertFalse(PhoneSessionPolicy.canEnablePush(true, true, "+919876543210"));
        // Authenticated, not pushed, phone selected or Unavailable -> enabled
        assertTrue(PhoneSessionPolicy.canEnablePush(true, false, "+919876543210"));
        assertTrue(PhoneSessionPolicy.canEnablePush(true, false, PhoneSessionPolicy.VALUE_UNAVAILABLE));
    }

    @Test
    public void normalizeHelpers_handleWhitespaceAndCase() {
        assertEquals("STAFF007", PhoneSessionPolicy.normalizeStaffId("  staff007  "));
        assertEquals("", PhoneSessionPolicy.normalizeStaffId(null));
        assertEquals("+919876543210", PhoneSessionPolicy.normalizeHintPhoneNumber(" +919876543210 "));
        assertEquals("", PhoneSessionPolicy.normalizeHintPhoneNumber(null));
    }
}

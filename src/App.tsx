import { useState, useEffect, useRef, type FormEvent } from 'react';

declare global {
  interface Window {
    AndroidBridge?: {
      onLoginPageLoaded: () => void;
      onStaffPageLoaded: (staffId: string, alreadyPushed: boolean) => void;
      onStaffLoggedOut: () => void;
      requestPhoneNumberHint: () => void;
      getSelectedPhoneNumber: () => string;
    };
    onNativePhoneSelected?: (phone: string) => void;
    onNativePhoneCleared?: () => void;
    onNativePhoneCancelled?: () => void;
  }
}

// Demo credentials
const DUMMY_STAFF: Record<string, string> = {
  ADMIN01: 'admin123',
  HOD01: 'staff123',
};

for (let i = 1; i <= 50; i++) {
  const id = `STAFF${i.toString().padStart(3, '0')}`;
  DUMMY_STAFF[id] = 'staff123';
}

function isValidStaff(id: string, pass: string): boolean {
  const nid = id.trim().toUpperCase();
  const p = pass.trim();
  if (DUMMY_STAFF[nid] && DUMMY_STAFF[nid] === p) return true;
  if (/^STAFF\d+$/i.test(nid) && p === 'staff123') return true;
  return false;
}

export default function App() {
  const isAndroid = typeof window !== 'undefined' && Boolean(window.AndroidBridge);

  const [staffId, setStaffId] = useState<string | null>(() => {
    return sessionStorage.getItem('rit_staff_id');
  });
  const [inputStaffId, setInputStaffId] = useState('STAFF001');
  const [inputPassword, setInputPassword] = useState('staff123');
  const [loginError, setLoginError] = useState<string | null>(null);

  const [hasPushed, setHasPushed] = useState<boolean>(false);
  const [isPushing, setIsPushing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedPhone, setSelectedPhone] = useState<string | null>(() => {
    if (typeof window !== 'undefined' && window.AndroidBridge) {
      try {
        const val = window.AndroidBridge.getSelectedPhoneNumber();
        return val && val.trim() ? val.trim() : null;
      } catch {
        return null;
      }
    }
    return null;
  });

  const justLoggedInRef = useRef<boolean>(false);

  // Register native Android callbacks
  useEffect(() => {
    window.onNativePhoneSelected = (phone: string) => {
      const clean = phone ? phone.trim() : '';
      setSelectedPhone(clean.length > 0 ? clean : null);
      if (clean.length > 0) {
        setErrorMessage(null);
      }
    };
    window.onNativePhoneCleared = () => {
      setSelectedPhone(null);
    };
    window.onNativePhoneCancelled = () => {
      setSelectedPhone(null);
      setErrorMessage('Phone number selection is required before pushing attendance.');
    };

    return () => {
      delete window.onNativePhoneSelected;
      delete window.onNativePhoneCleared;
      delete window.onNativePhoneCancelled;
    };
  }, []);

  const handleLogout = () => {
    sessionStorage.removeItem('rit_staff_id');
    setStaffId(null);
    setHasPushed(false);
    setIsPushing(false);
    setErrorMessage(null);
    setSelectedPhone(null);
    justLoggedInRef.current = false;

    fetch('/logout', { credentials: 'same-origin' }).catch(() => {});
    if (isAndroid && window.AndroidBridge) {
      try {
        window.AndroidBridge.onStaffLoggedOut();
      } catch {
        // ignore
      }
    }
  };

  // Notify Android login state & verify status when staffId changes or loads
  useEffect(() => {
    if (!staffId) {
      setHasPushed(false);
      setSelectedPhone(null);
      if (isAndroid && window.AndroidBridge) {
        try {
          window.AndroidBridge.onLoginPageLoaded();
        } catch {
          // ignore
        }
      }
      return;
    }

    if (justLoggedInRef.current) {
      justLoggedInRef.current = false;
      return;
    }

    setHasPushed(false);
    fetch(`/api/status?staffId=${encodeURIComponent(staffId)}`, {
      credentials: 'same-origin',
    })
      .then((res) => res.json())
      .then((data) => {
        const pushed = Boolean(data && data.pushed);
        setHasPushed(pushed);
        if (isAndroid && window.AndroidBridge) {
          try {
            const existing = window.AndroidBridge.getSelectedPhoneNumber();
            setSelectedPhone(existing && existing.trim() ? existing.trim() : null);
            window.AndroidBridge.onStaffPageLoaded(staffId, pushed);
          } catch {
            // ignore
          }
        }
      })
      .catch(() => {
        const today = new Date().toISOString().slice(0, 10);
        const localRecorded = localStorage.getItem(`pushed_${staffId}`);
        const pushed = localRecorded === today;
        setHasPushed(pushed);
        if (isAndroid && window.AndroidBridge) {
          try {
            const existing = window.AndroidBridge.getSelectedPhoneNumber();
            setSelectedPhone(existing && existing.trim() ? existing.trim() : null);
            window.AndroidBridge.onStaffPageLoaded(staffId, pushed);
          } catch {
            // ignore
          }
        }
      });
  }, [staffId, isAndroid]);

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setErrorMessage(null);

    const normalizedId = inputStaffId.trim().toUpperCase();
    const password = inputPassword.trim();

    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ staffId: normalizedId, password }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        const alreadyPushed = Boolean(data.alreadyPushed);
        sessionStorage.setItem('rit_staff_id', normalizedId);
        justLoggedInRef.current = true;
        setHasPushed(alreadyPushed);
        setStaffId(normalizedId);

        if (isAndroid && window.AndroidBridge) {
          try {
            const existing = window.AndroidBridge.getSelectedPhoneNumber();
            setSelectedPhone(existing && existing.trim() ? existing.trim() : null);
            window.AndroidBridge.onStaffPageLoaded(normalizedId, alreadyPushed);
          } catch {
            // ignore
          }
        }
      } else {
        setLoginError(data.message || 'Invalid Staff ID or Password');
      }
    } catch {
      if (isValidStaff(normalizedId, password)) {
        const today = new Date().toISOString().slice(0, 10);
        const pushed = localStorage.getItem(`pushed_${normalizedId}`) === today;
        sessionStorage.setItem('rit_staff_id', normalizedId);
        justLoggedInRef.current = true;
        setHasPushed(pushed);
        setStaffId(normalizedId);

        if (isAndroid && window.AndroidBridge) {
          try {
            window.AndroidBridge.onStaffPageLoaded(normalizedId, pushed);
          } catch {
            // ignore
          }
        }
      } else {
        setLoginError('Invalid Staff ID or Password');
      }
    }
  };

  const handlePush = () => {
    if (hasPushed || isPushing || !staffId) return;

    let phoneToSubmit = 'Unavailable';
    if (isAndroid) {
      let nativePhone = '';
      try {
        nativePhone = window.AndroidBridge?.getSelectedPhoneNumber() || '';
      } catch {
        nativePhone = '';
      }
      if (!nativePhone.trim()) {
        setSelectedPhone(null);
        setErrorMessage('Please select your phone number (or Unavailable) before pushing.');
        return;
      }
      phoneToSubmit = nativePhone.trim();
      setSelectedPhone(phoneToSubmit);
    }

    setErrorMessage(null);

    if (!navigator.geolocation) {
      setErrorMessage('Unable to determine your location. Please try again.');
      return;
    }

    setIsPushing(true);

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const latitude = position.coords.latitude;
        const longitude = position.coords.longitude;

        try {
          const response = await fetch('/api/push', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({
              staffId,
              latitude,
              longitude,
              phoneNumber: phoneToSubmit,
              androidApp: isAndroid,
              status: 'Present',
            }),
          });

          const data = await response.json();

          if (response.ok && data.success) {
            setHasPushed(true);
            setIsPushing(false);
            const today = new Date().toISOString().slice(0, 10);
            localStorage.setItem(`pushed_${staffId}`, today);
            setErrorMessage(null);
          } else {
            setIsPushing(false);
            if (data.alreadyPushed) {
              setHasPushed(true);
            }
            setErrorMessage(data.message || data.error || 'Failed to record push.');
          }
        } catch {
          setIsPushing(false);
          setErrorMessage('Unable to record location. Please try again.');
        }
      },
      (geoError) => {
        setIsPushing(false);
        if (geoError.code === geoError.PERMISSION_DENIED) {
          setErrorMessage('Location required');
        } else {
          setErrorMessage('Unable to determine your location. Please try again.');
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      }
    );
  };

  const handleRequestPhoneHint = () => {
    setErrorMessage(null);
    if (isAndroid && window.AndroidBridge) {
      try {
        window.AndroidBridge.requestPhoneNumberHint();
      } catch {
        setErrorMessage('Unable to launch phone number selector.');
      }
    }
  };

  // ----------------------------------------------------
  // VIEW 1: Login Page
  // ----------------------------------------------------
  if (!staffId) {
    return (
      <div
        id="loginPage"
        className="min-h-screen w-full flex items-center justify-center bg-slate-100 p-4"
      >
        <div
          id="loginCard"
          className="w-full max-w-sm bg-white rounded-xl border border-slate-200 shadow-sm p-8"
        >
          <div className="text-center mb-6">
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Staff Attendance</h1>
            <p className="text-xs font-medium text-slate-500 mt-1">Rajalakshmi Institute of Technology</p>
          </div>

          {loginError && (
            <div
              id="loginErrorBanner"
              className="mb-4 p-2.5 bg-red-50 border border-red-200 text-red-700 text-xs font-medium rounded-lg text-center"
            >
              {loginError}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label
                htmlFor="staffIdInput"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Staff ID
              </label>
              <input
                id="staffIdInput"
                type="text"
                value={inputStaffId}
                onChange={(e) => setInputStaffId(e.target.value)}
                placeholder="e.g. STAFF001"
                required
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
              />
            </div>

            <div>
              <label
                htmlFor="passwordInput"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Password
              </label>
              <input
                id="passwordInput"
                type="password"
                value={inputPassword}
                onChange={(e) => setInputPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
              />
            </div>

            <button
              id="loginSubmitButton"
              type="submit"
              className="w-full py-2.5 bg-sky-600 hover:bg-sky-700 active:bg-sky-800 text-white text-sm font-semibold rounded-lg transition-colors cursor-pointer"
            >
              Login
            </button>
          </form>

          <div
            id="demoCredentialsInfo"
            className="mt-6 p-3 bg-slate-50 border border-dashed border-slate-300 rounded-lg text-center"
          >
            <span className="inline-block text-[10px] font-bold text-sky-700 tracking-wider mb-1">
              PORTAL ACCESS CREDENTIALS
            </span>
            <p className="text-xs text-slate-700 font-mono">
              Staff IDs: <strong className="text-slate-900">STAFF001</strong> to <strong className="text-slate-900">STAFF050</strong> (or any <span className="text-sky-700">STAFF###</span>)
            </p>
            <p className="text-xs text-slate-600 font-mono mt-0.5">
              Default Password: <strong className="text-slate-900">staff123</strong>
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ----------------------------------------------------
  // VIEW 2: Staff Screen
  // ----------------------------------------------------
  const pushDisabled = hasPushed || isPushing || (isAndroid && !selectedPhone);

  return (
    <div
      id="staffScreenContainer"
      className="relative h-screen w-screen flex flex-col items-center justify-center bg-white p-6 select-none overflow-hidden"
    >
      <div className="absolute top-4 right-4">
        <button
          onClick={handleLogout}
          className="text-xs font-medium text-slate-400 hover:text-slate-700 px-3 py-1.5 rounded-lg border border-slate-200 hover:border-slate-300 bg-white transition-colors cursor-pointer"
        >
          Logout / Switch ID
        </button>
      </div>

      <div
        id="staffCenterWrapper"
        className="flex flex-col items-center justify-center text-center"
      >
        <div
          id="staffIdDisplay"
          className="text-3xl font-bold tracking-wider text-slate-800 mb-4"
        >
          {staffId}
        </div>

        {isAndroid && (
          <div className="mb-6 flex flex-col items-center gap-2">
            <div
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold ${
                selectedPhone === 'Unavailable'
                  ? 'bg-amber-100 text-amber-800'
                  : selectedPhone
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-red-100 text-red-800'
              }`}
            >
              📱 Phone: {selectedPhone || 'Selection Required'}
            </div>
            {!selectedPhone && !hasPushed && (
              <button
                type="button"
                onClick={handleRequestPhoneHint}
                className="px-4 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-lg shadow-sm cursor-pointer"
              >
                Select Phone Number
              </button>
            )}
          </div>
        )}

        <button
          id="pushButton"
          disabled={pushDisabled}
          onClick={handlePush}
          className={`w-56 h-16 text-xl font-bold tracking-widest rounded-xl transition-all duration-200 flex items-center justify-center ${
            hasPushed || (isAndroid && !selectedPhone)
              ? 'bg-slate-400 text-slate-100 cursor-not-allowed shadow-none'
              : isPushing
              ? 'bg-sky-500 text-white cursor-wait opacity-90'
              : 'bg-sky-600 text-white hover:bg-sky-700 active:translate-y-0.5 shadow-md shadow-sky-600/25 cursor-pointer'
          }`}
        >
          {hasPushed ? 'PUSHED' : isPushing ? '...' : 'PUSH'}
        </button>

        {/* Minimal error notification */}
        <div
          id="errorMessage"
          className="mt-5 text-sm font-medium text-red-500 min-h-5 max-w-xs"
        >
          {errorMessage || ''}
        </div>
      </div>
    </div>
  );
}

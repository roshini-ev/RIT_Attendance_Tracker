import { useState, useEffect, type FormEvent } from 'react';

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
  const [staffId, setStaffId] = useState<string | null>(() => {
    return sessionStorage.getItem('rit_staff_id');
  });
  const [inputStaffId, setInputStaffId] = useState('STAFF001');
  const [inputPassword, setInputPassword] = useState('staff123');
  const [loginError, setLoginError] = useState<string | null>(null);

  const [hasPushed, setHasPushed] = useState<boolean>(false);
  const [isPushing, setIsPushing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleLogout = () => {
    sessionStorage.removeItem('rit_staff_id');
    setStaffId(null);
    setHasPushed(false);
    setIsPushing(false);
    setErrorMessage(null);
  };

  // Check on load whether this staff member has already pushed
  useEffect(() => {
    if (staffId) {
      // Check server status
      fetch(`/api/status?staffId=${encodeURIComponent(staffId)}`)
        .then((res) => res.json())
        .then((data) => {
          if (data && data.pushed) {
            setHasPushed(true);
          }
        })
        .catch(() => {
          // If server call fails, check local fallback
          const localRecorded = localStorage.getItem(`pushed_${staffId}`);
          if (localRecorded) {
            setHasPushed(true);
          }
        });
    }
  }, [staffId]);

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setLoginError(null);

    const normalizedId = inputStaffId.trim().toUpperCase();
    const password = inputPassword.trim();

    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staffId: normalizedId, password }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        sessionStorage.setItem('rit_staff_id', normalizedId);
        setStaffId(normalizedId);
        if (data.alreadyPushed) {
          setHasPushed(true);
        }
      } else {
        setLoginError(data.message || 'Invalid Staff ID or Password');
      }
    } catch {
      // Fallback check
      if (isValidStaff(normalizedId, password)) {
        sessionStorage.setItem('rit_staff_id', normalizedId);
        setStaffId(normalizedId);
        if (localStorage.getItem(`pushed_${normalizedId}`)) {
          setHasPushed(true);
        }
      } else {
        setLoginError('Invalid Staff ID or Password');
      }
    }
  };

  const handlePush = () => {
    if (hasPushed || isPushing || !staffId) return;

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
            body: JSON.stringify({
              staffId,
              latitude,
              longitude,
            }),
          });

          const data = await response.json();

          if (response.ok && data.success) {
            setHasPushed(true);
            setIsPushing(false);
            localStorage.setItem(`pushed_${staffId}`, 'true');
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
        timeout: 10000,
        maximumAge: 0,
      }
    );
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
  // VIEW 2: Staff Screen (Strictly Minimal Single-Screen)
  // Contains ONLY:
  // Staff ID
  // [ PUSH ] or [ PUSHED ]
  // Discreet Switch/Logout button for testing multiple IDs
  // ----------------------------------------------------
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
          className="text-3xl font-bold tracking-wider text-slate-800 mb-10"
        >
          {staffId}
        </div>

        <button
          id="pushButton"
          disabled={hasPushed || isPushing}
          onClick={handlePush}
          className={`w-56 h-16 text-xl font-bold tracking-widest rounded-xl transition-all duration-200 flex items-center justify-center ${
            hasPushed
              ? 'bg-slate-400 text-slate-100 cursor-not-allowed shadow-none'
              : isPushing
              ? 'bg-sky-500 text-white cursor-wait opacity-90'
              : 'bg-sky-600 text-white hover:bg-sky-700 active:translate-y-0.5 shadow-md shadow-sky-600/25 cursor-pointer'
          }`}
        >
          {hasPushed ? 'PUSHED' : isPushing ? '...' : 'PUSH'}
        </button>

        {/* Minimal error notification (only shown if GPS permission failed or error occurred) */}
        <div 
          id="errorMessage"
          className="mt-5 text-sm font-medium text-red-500 min-h-5"
        >
          {errorMessage || ''}
        </div>
      </div>
    </div>
  );
}

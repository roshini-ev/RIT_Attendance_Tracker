document.addEventListener('DOMContentLoaded', () => {
  const pushButton = document.getElementById('pushButton');
  const statusMessage = document.getElementById('statusMessage');
  const staffIdDisplay = document.getElementById('staffIdDisplay');
  const phoneSection = document.getElementById('phoneSection');
  const phoneBadge = document.getElementById('phoneBadge');
  const phoneNumberDisplay = document.getElementById('phoneNumberDisplay');
  const btnSelectPhone = document.getElementById('btnSelectPhone');

  if (!pushButton) return;

  const isAndroid = typeof window.AndroidBridge !== 'undefined';
  const staffId = staffIdDisplay ? staffIdDisplay.textContent.trim().toUpperCase() : '';
  const isAlreadyPushed = pushButton.classList.contains('pushed');
  let selectedPhoneNumber = null;

  function showMessage(msg) {
    if (statusMessage) {
      statusMessage.textContent = msg;
    }
  }

  function clearMessage() {
    if (statusMessage) {
      statusMessage.textContent = '';
    }
  }

  function updatePhoneSelectionUI(phone) {
    selectedPhoneNumber = phone && phone.trim().length > 0 ? phone.trim() : null;

    if (!isAndroid) return;
    if (phoneSection) phoneSection.style.display = 'block';

    if (selectedPhoneNumber) {
      if (phoneNumberDisplay) phoneNumberDisplay.textContent = selectedPhoneNumber;
      if (phoneBadge) {
        phoneBadge.style.background = selectedPhoneNumber === 'Unavailable' ? '#fef3c7' : '#dcfce7';
        phoneBadge.style.color = selectedPhoneNumber === 'Unavailable' ? '#92400e' : '#166534';
      }
      if (btnSelectPhone) btnSelectPhone.style.display = 'none';

      if (!isAlreadyPushed && pushButton.textContent !== 'PUSHED') {
        pushButton.disabled = false;
        clearMessage();
      }
    } else {
      if (phoneNumberDisplay) phoneNumberDisplay.textContent = 'Selection Required';
      if (phoneBadge) {
        phoneBadge.style.background = '#fee2e2';
        phoneBadge.style.color = '#991b1b';
      }
      if (!isAlreadyPushed && pushButton.textContent !== 'PUSHED') {
        pushButton.disabled = true;
        if (btnSelectPhone) btnSelectPhone.style.display = 'inline-block';
      } else {
        if (btnSelectPhone) btnSelectPhone.style.display = 'none';
      }
    }
  }

  // Expose native Android callbacks globally
  window.onNativePhoneSelected = function(phone) {
    updatePhoneSelectionUI(phone);
  };

  window.onNativePhoneCleared = function() {
    updatePhoneSelectionUI(null);
  };

  window.onNativePhoneCancelled = function() {
    updatePhoneSelectionUI(null);
    if (!isAlreadyPushed && pushButton.textContent !== 'PUSHED') {
      showMessage('Phone number selection is required before pushing attendance.');
    }
  };

  // Initialize Android WebView integration
  if (isAndroid) {
    if (!isAlreadyPushed) {
      pushButton.disabled = true;
    }
    try {
      const existing = window.AndroidBridge.getSelectedPhoneNumber();
      if (existing && existing.trim().length > 0) {
        updatePhoneSelectionUI(existing);
      } else {
        updatePhoneSelectionUI(null);
      }
      // Inform native layer about loaded staff page; native will launch hint once per login session
      window.AndroidBridge.onStaffPageLoaded(staffId, isAlreadyPushed);
    } catch (e) {
      console.error('AndroidBridge initialization error:', e);
    }

    if (btnSelectPhone) {
      btnSelectPhone.addEventListener('click', () => {
        clearMessage();
        try {
          window.AndroidBridge.requestPhoneNumberHint();
        } catch (e) {
          showMessage('Unable to launch phone number selector.');
        }
      });
    }
  }

  pushButton.addEventListener('click', () => {
    if (pushButton.disabled) return;

    // Strictly verify native phone selection before permitting push from Android WebView
    if (isAndroid) {
      let nativePhone = '';
      try {
        nativePhone = window.AndroidBridge.getSelectedPhoneNumber() || '';
      } catch (e) {
        nativePhone = '';
      }
      if (!nativePhone.trim()) {
        updatePhoneSelectionUI(null);
        showMessage('Please select your phone number (or Unavailable) before pushing.');
        return;
      }
      selectedPhoneNumber = nativePhone.trim();
    }

    clearMessage();

    // Check if Geolocation API is available
    if (!navigator.geolocation) {
      showMessage('Unable to determine your location. Please try again.');
      return;
    }

    pushButton.disabled = true;
    const originalText = pushButton.textContent;
    pushButton.textContent = '...';

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const latitude = position.coords.latitude;
        const longitude = position.coords.longitude;

        try {
          const response = await fetch('/api/push', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              latitude,
              longitude,
              phoneNumber: isAndroid ? selectedPhoneNumber : 'Unavailable',
              androidApp: isAndroid,
            }),
          });

          const data = await response.json();

          if (response.ok && data.success) {
            pushButton.textContent = 'PUSHED';
            pushButton.disabled = true;
            pushButton.classList.add('pushed');
            clearMessage();
          } else {
            if (data.alreadyPushed || (data.error || '').toLowerCase().includes('already')) {
              pushButton.textContent = 'PUSHED';
              pushButton.disabled = true;
              pushButton.classList.add('pushed');
              clearMessage();
              return;
            }
            pushButton.disabled = isAndroid && !selectedPhoneNumber;
            pushButton.textContent = originalText;
            showMessage(data.error || 'Failed to record push.');
          }
        } catch (err) {
          pushButton.disabled = isAndroid && !selectedPhoneNumber;
          pushButton.textContent = originalText;
          showMessage('Network error. Please try again.');
        }
      },
      (error) => {
        pushButton.disabled = isAndroid && !selectedPhoneNumber;
        pushButton.textContent = originalText;

        if (error.code === error.PERMISSION_DENIED) {
          showMessage('Location required');
        } else {
          showMessage('Unable to determine your location. Please try again.');
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 0,
      }
    );
  });
});

document.addEventListener('DOMContentLoaded', () => {
  const pushButton = document.getElementById('pushButton');
  const statusMessage = document.getElementById('statusMessage');
  const staffIdDisplay = document.getElementById('staffIdDisplay');
  const phoneSection = document.getElementById('phoneSection');
  const phoneBadge = document.getElementById('phoneBadge');
  const phoneNumberDisplay = document.getElementById('phoneNumberDisplay');
  const btnSelectPhone = document.getElementById('btnSelectPhone');

  // Independent Remark Elements
  const remarkStaffIdInput = document.getElementById('remarkStaffId');
  const remarkContentInput = document.getElementById('remarkContent');
  const btnSubmitRemark = document.getElementById('btnSubmitRemark');
  const remarkStatusMessage = document.getElementById('remarkStatusMessage');

  const isAndroid = typeof window.AndroidBridge !== 'undefined';
  const staffId = staffIdDisplay ? staffIdDisplay.textContent.trim().toUpperCase() : '';
  const isAlreadyPushed = pushButton ? pushButton.classList.contains('pushed') : false;
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

      if (pushButton && !isAlreadyPushed && pushButton.textContent !== 'PUSHED') {
        pushButton.disabled = false;
        clearMessage();
      }
    } else {
      if (phoneNumberDisplay) phoneNumberDisplay.textContent = 'Selection Required';
      if (phoneBadge) {
        phoneBadge.style.background = '#fee2e2';
        phoneBadge.style.color = '#991b1b';
      }
      if (pushButton && !isAlreadyPushed && pushButton.textContent !== 'PUSHED') {
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
    if (pushButton && !isAlreadyPushed && pushButton.textContent !== 'PUSHED') {
      showMessage('Phone number selection is required before pushing attendance.');
    }
  };

  // Initialize Android WebView integration
  if (isAndroid) {
    if (pushButton && !isAlreadyPushed) {
      pushButton.disabled = true;
    }
    try {
      const existing = window.AndroidBridge.getSelectedPhoneNumber();
      if (existing && existing.trim().length > 0) {
        updatePhoneSelectionUI(existing);
      } else {
        updatePhoneSelectionUI(null);
      }
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

  // ==========================================
  // ATTENDANCE PUSH BUTTON (Strictly Attendance)
  // ==========================================
  if (pushButton) {
    pushButton.addEventListener('click', () => {
      if (pushButton.disabled) return;

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
  }

  // ==========================================
  // INDEPENDENT REMARK SUBMISSION SECTION
  // ==========================================
  let isSubmittingRemark = false;

  function showRemarkStatus(msg, type) {
    if (!remarkStatusMessage) return;
    remarkStatusMessage.textContent = msg;
    remarkStatusMessage.className = 'remark-status ' + (type || '');
  }

  function clearRemarkStatus() {
    if (!remarkStatusMessage) return;
    remarkStatusMessage.textContent = '';
    remarkStatusMessage.className = 'remark-status';
  }

  const remarkCharCount = document.getElementById('remarkCharCount');
  if (remarkContentInput) {
    remarkContentInput.addEventListener('input', () => {
      if (remarkContentInput.value.length > 50) {
        remarkContentInput.value = remarkContentInput.value.substring(0, 50);
      }
      if (remarkCharCount) {
        remarkCharCount.textContent = `${remarkContentInput.value.length}/50`;
      }
      if (remarkStatusMessage && remarkStatusMessage.classList.contains('error')) {
        clearRemarkStatus();
      }
    });
  }

  if (btnSubmitRemark) {
    btnSubmitRemark.addEventListener('click', async () => {
      if (isSubmittingRemark) return;

      const sidVal = (remarkStaffIdInput ? remarkStaffIdInput.value : '').trim().toUpperCase();
      const remarkVal = (remarkContentInput ? remarkContentInput.value : '').trim();

      if (!sidVal) {
        showRemarkStatus('Please enter your Staff ID.', 'error');
        if (remarkStaffIdInput) remarkStaffIdInput.focus();
        return;
      }

      if (!remarkVal) {
        showRemarkStatus('Please enter a remark before submitting.', 'error');
        if (remarkContentInput) remarkContentInput.focus();
        return;
      }

      if (remarkVal.length > 50) {
        showRemarkStatus('Remark cannot exceed 50 characters.', 'error');
        return;
      }

      clearRemarkStatus();
      isSubmittingRemark = true;
      btnSubmitRemark.disabled = true;

      const btnLabel = btnSubmitRemark.querySelector('.btn-label');
      const btnSpinner = btnSubmitRemark.querySelector('.btn-spinner');
      if (btnLabel && btnSpinner) {
        btnLabel.style.display = 'none';
        btnSpinner.style.display = 'inline';
      } else {
        btnSubmitRemark.textContent = 'Submitting...';
      }

      try {
        const response = await fetch('/api/remark', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            staff_id: sidVal,
            remark: remarkVal,
          }),
        });

        const data = await response.json();

        if (response.ok && data.success) {
          // Clear only the remark textarea after successful submission
          if (remarkContentInput) {
            remarkContentInput.value = '';
          }
          if (remarkCharCount) {
            remarkCharCount.textContent = '0/50';
          }
          showRemarkStatus('Remark submitted successfully!', 'success');
        } else {
          // Do NOT clear form if submission fails
          showRemarkStatus(data.error || data.message || 'Failed to submit remark.', 'error');
        }
      } catch (err) {
        showRemarkStatus('Network error. Please try again.', 'error');
      } finally {
        isSubmittingRemark = false;
        btnSubmitRemark.disabled = false;
        if (btnLabel && btnSpinner) {
          btnLabel.style.display = 'inline';
          btnSpinner.style.display = 'none';
        } else {
          btnSubmitRemark.textContent = 'Submit Remark';
        }
      }
    });
  }
});

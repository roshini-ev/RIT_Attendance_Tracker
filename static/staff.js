document.addEventListener('DOMContentLoaded', () => {
  const pushButton = document.getElementById('pushButton');
  const statusMessage = document.getElementById('statusMessage');

  if (!pushButton) return;

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

  pushButton.addEventListener('click', () => {
    if (pushButton.disabled) return;

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
            body: JSON.stringify({ latitude, longitude }),
          });

          const data = await response.json();

          if (response.ok && data.success) {
            pushButton.textContent = 'PUSHED';
            pushButton.disabled = true;
            pushButton.classList.add('pushed');
            clearMessage();
          } else {
            // Already recorded (e.g. punched from another phone) — lock the button.
            if (data.alreadyPushed || (data.error || '').toLowerCase().includes('already')) {
              pushButton.textContent = 'PUSHED';
              pushButton.disabled = true;
              pushButton.classList.add('pushed');
              clearMessage();
              return;
            }
            pushButton.disabled = false;
            pushButton.textContent = originalText;
            showMessage(data.error || 'Failed to record push.');
          }
        } catch (err) {
          pushButton.disabled = false;
          pushButton.textContent = originalText;
          showMessage('Network error. Please try again.');
        }
      },
      (error) => {
        pushButton.disabled = false;
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

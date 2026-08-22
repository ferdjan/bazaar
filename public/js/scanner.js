'use strict';

(() => {
  const button = document.getElementById('start-scan');
  const video = document.getElementById('camera-preview');
  const status = document.getElementById('camera-status');
  const tokenInput = document.getElementById('token');
  if (!button || !video || !status) return;

  let stream;
  button.addEventListener('click', async () => {
    if (!('BarcodeDetector' in window)) {
      status.textContent = 'La caméra QR n’est pas disponible sur ce navigateur. Saisissez le code manuellement.';
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
      video.srcObject = stream;
      video.hidden = false;
      button.disabled = true;
      status.textContent = 'Présentez le QR code devant la caméra.';
      const detector = new BarcodeDetector({ formats: ['qr_code'] });
      const scan = async () => {
        if (video.readyState >= 2) {
          const codes = await detector.detect(video);
          const raw = codes[0] && codes[0].rawValue;
          const match = raw && raw.match(/\/scan\/([a-f0-9]{64})$/i);
          if (match) {
            if (stream) stream.getTracks().forEach((track) => track.stop());
            window.location.href = '/scan/' + match[1].toLowerCase();
            return;
          }
        }
        window.requestAnimationFrame(scan);
      };
      scan();
    } catch (_) {
      status.textContent = 'Accès caméra refusé ou indisponible. Saisissez le code manuellement.';
    }
  });
})();

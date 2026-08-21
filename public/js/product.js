'use strict';
/* Compteur de quantité − / + de la fiche produit.
   Borné par les attributs min/max du champ (min 1, max = stock). */
document.querySelectorAll('.qty-stepper').forEach(function (st) {
  var input = st.querySelector('.qty-input');
  if (!input) return;

  var min = parseInt(input.min, 10) || 1;
  var max = parseInt(input.max, 10) || 99;
  var clamp = function (v) { return Math.min(max, Math.max(min, v)); };

  st.querySelectorAll('.qty-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var step = parseInt(btn.dataset.step, 10) || 0;
      var v = parseInt(input.value, 10);
      input.value = clamp((Number.isFinite(v) ? v : min) + step);
    });
  });
});

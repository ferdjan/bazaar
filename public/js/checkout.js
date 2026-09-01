'use strict';
/* Cascade Wilaya → Commune du formulaire de commande.
   Chaque option "commune" porte data-wilaya ; on n'affiche que celles qui
   correspondent à la wilaya sélectionnée. Le champ reste optionnel. */
(function () {
  var wilaya = document.getElementById('wilaya');
  var commune = document.getElementById('commune');
  if (!wilaya || !commune) return;

  function sync() {
    var code = wilaya.value;
    var selected = commune.value;

    for (var i = 0; i < commune.options.length; i++) {
      var opt = commune.options[i];
      if (opt.value === '') continue;
      opt.hidden = (code === '' || opt.getAttribute('data-wilaya') !== code);
    }

    commune.disabled = code === '';

    if (code === '') {
      commune.value = '';
      return;
    }

    // Conserve la sélection si elle appartient encore à la wilaya choisie,
    // sinon on la remet à vide.
    var stillValid = false;
    for (var j = 0; j < commune.options.length; j++) {
      var o = commune.options[j];
      if (o.value === selected && !o.hidden) {
        stillValid = true;
        break;
      }
    }
    if (!stillValid) commune.value = '';
  }

  wilaya.addEventListener('change', sync);
  sync();
})();

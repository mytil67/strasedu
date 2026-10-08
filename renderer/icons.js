/* ==========================================================================
   StrasEdu — jeu d'icônes
   --------------------------------------------------------------------------
   Icônes dessinées sur une grille de 24 x 24, en traits de 1,7 px, pour rester
   lisibles de 16 à 48 px. Aucune dépendance externe : le catalogue peut nommer
   une icône de catégorie (`categoryMeta.<nom>.icon`) sans embarquer d'image.

   Exposé : window.PO.icons  — table { nom: "<markup interne du svg>" }
            window.PO.svg(nom, taille, classe) — renvoie une chaîne <svg>
   ========================================================================== */

(function () {
  "use strict";

  var icons = {
    /* ── Navigation ───────────────────────────────────────────────────── */
    home:
      '<path d="M3.2 10.8 12 3.4l8.8 7.4"></path>' +
      '<path d="M5.6 9.6V19a1.8 1.8 0 0 0 1.8 1.8h9.2A1.8 1.8 0 0 0 18.4 19V9.6"></path>' +
      '<path d="M9.8 20.4v-5.2h4.4v5.2"></path>',

    grid:
      '<rect x="3.4" y="3.4" width="7.4" height="7.4" rx="2"></rect>' +
      '<rect x="13.2" y="3.4" width="7.4" height="7.4" rx="2"></rect>' +
      '<rect x="3.4" y="13.2" width="7.4" height="7.4" rx="2"></rect>' +
      '<rect x="13.2" y="13.2" width="7.4" height="7.4" rx="2"></rect>',

    layers:
      '<path d="M12 3.4 3.6 7.8 12 12.2l8.4-4.4z"></path>' +
      '<path d="M3.6 12.4 12 16.8l8.4-4.4"></path>' +
      '<path d="M3.6 16.8 12 21.2l8.4-4.4"></path>',

    star:
      '<path d="m12 3.5 2.66 5.4 5.96.87-4.31 4.2 1.02 5.93L12 17.1l-5.33 2.8 1.02-5.93-4.31-4.2 5.96-.87z"></path>',

    clock:
      '<circle cx="12" cy="12" r="8.6"></circle>' +
      '<path d="M12 7.4V12l3.4 2.2"></path>',

    /* ── Catégories ───────────────────────────────────────────────────── */
    mic:
      '<path d="M12 3.2a2.9 2.9 0 0 0-2.9 2.9v5.6a2.9 2.9 0 0 0 5.8 0V6.1A2.9 2.9 0 0 0 12 3.2z"></path>' +
      '<path d="M5.6 11.4a6.4 6.4 0 0 0 12.8 0"></path>' +
      '<path d="M12 17.8v3.2M8.9 21h6.2"></path>',

    video:
      '<rect x="3.3" y="5.4" width="12.4" height="13.2" rx="2.6"></rect>' +
      '<path d="m15.7 10.4 5-3v9.2l-5-3z"></path>',

    sparkles:
      '<path d="M11.4 3.4 13 8.2l4.8 1.6-4.8 1.6-1.6 4.8-1.6-4.8L5 9.8l4.8-1.6z"></path>' +
      '<path d="m18.4 14.6.85 2.35 2.35.85-2.35.85-.85 2.35-.85-2.35-2.35-.85 2.35-.85z"></path>',

    folder:
      '<path d="M3.4 7.2A2.6 2.6 0 0 1 6 4.6h3.1a2 2 0 0 1 1.6.8l1 1.4H18a2.6 2.6 0 0 1 2.6 2.6v7.4A2.6 2.6 0 0 1 18 19.4H6a2.6 2.6 0 0 1-2.6-2.6z"></path>',

    fileText:
      '<path d="M6.4 3.4h7l5.2 5.2v11a1.8 1.8 0 0 1-1.8 1.8H6.4a1.8 1.8 0 0 1-1.8-1.8V5.2a1.8 1.8 0 0 1 1.8-1.8z"></path>' +
      '<path d="M13.2 3.6v5.2h5.2"></path>' +
      '<path d="M8.4 13.4h7.2M8.4 16.8h4.8"></path>',

    image:
      '<rect x="3.4" y="4.6" width="17.2" height="14.8" rx="2.6"></rect>' +
      '<circle cx="8.9" cy="10.1" r="1.8"></circle>' +
      '<path d="m4.4 17.6 4.6-4.4 3.4 3.2 3-2.8 4.2 4"></path>',

    globe:
      '<circle cx="12" cy="12" r="8.6"></circle>' +
      '<path d="M3.6 12h16.8"></path>' +
      '<path d="M12 3.4a13 13 0 0 1 0 17.2 13 13 0 0 1 0-17.2z"></path>',

    book:
      '<path d="M4.2 4.6A1.8 1.8 0 0 1 6 2.8h12.2v16.4H6a1.8 1.8 0 0 0-1.8 1.8z"></path>' +
      '<path d="M4.2 19.2A1.8 1.8 0 0 1 6 21h12.2"></path>',

    calculator:
      '<rect x="4.4" y="3.4" width="15.2" height="17.2" rx="2.4"></rect>' +
      '<path d="M8.2 7.6h7.6"></path>' +
      '<path d="M8.6 12.2h.01M12 12.2h.01M15.4 12.2h.01M8.6 16.4h.01M12 16.4h.01M15.4 16.4h.01"></path>',

    /* ── Interface ────────────────────────────────────────────────────── */
    search:
      '<circle cx="11" cy="11" r="7"></circle><path d="M16.5 16.5 21 21"></path>',

    chevronRight: '<path d="m9.4 5.4 6.6 6.6-6.6 6.6"></path>',

    chevronLeft: '<path d="m14.6 5.4-6.6 6.6 6.6 6.6"></path>',

    /* Informations du département informatique. */
    bullhorn:
      '<path d="M4.4 9.8v4.4a1.8 1.8 0 0 0 1.8 1.8h1.2l7.2 4.2V3.8L7.4 8H6.2a1.8 1.8 0 0 0-1.8 1.8z"></path>' +
      '<path d="M18.4 9.4a4 4 0 0 1 0 5.2"></path>',

    /* Galerie de captures d'écran. */
    images:
      '<rect x="3.4" y="4.6" width="14.6" height="11.8" rx="2.4"></rect>' +
      '<path d="m3.8 13.8 3.6-3.4 2.8 2.6 2.4-2.2 3.4 3.2"></path>' +
      '<path d="M8.6 20.6h9.6a2.4 2.4 0 0 0 2.4-2.4V8.4"></path>',

    arrowUpRight:
      '<path d="M7.2 16.8 16.8 7.2"></path><path d="M8.8 7.2h8v8"></path>',

    x: '<path d="M6 6l12 12M18 6 6 18"></path>',

    refresh:
      '<path d="M4.6 9.3A8.2 8.2 0 0 1 19.4 9.3"></path>' +
      '<path d="M19.4 14.7A8.2 8.2 0 0 1 4.6 14.7"></path>' +
      '<path d="M4.6 4.6v4.7h4.7M19.4 19.4v-4.7h-4.7"></path>',

    sun:
      '<circle cx="12" cy="12" r="4.2"></circle>' +
      '<path d="M12 2.6v2.2M12 19.2v2.2M4.3 4.3l1.6 1.6M18.1 18.1l1.6 1.6M2.6 12h2.2M19.2 12h2.2M4.3 19.7l1.6-1.6M18.1 5.9l1.6-1.6"></path>',

    moon: '<path d="M20.6 14.4A8.6 8.6 0 1 1 9.6 3.4a6.9 6.9 0 0 0 11 11z"></path>',

    monitor:
      '<rect x="3.4" y="4.6" width="17.2" height="12.4" rx="2.2"></rect>' +
      '<path d="M9 20.6h6M12 17v3.6"></path>',

    settings:
      '<path d="M5 7h14M5 12h14M5 17h14"></path>' +
      '<circle cx="9.5" cy="7" r="1.9" fill="currentColor" stroke="none"></circle>' +
      '<circle cx="15" cy="12" r="1.9" fill="currentColor" stroke="none"></circle>' +
      '<circle cx="8" cy="17" r="1.9" fill="currentColor" stroke="none"></circle>',

    help:
      '<circle cx="12" cy="12" r="9"></circle>' +
      '<path d="M9.6 9.3a2.5 2.5 0 1 1 3.2 2.4c-.6.2-.8.7-.8 1.3v.4"></path>' +
      '<circle cx="12" cy="16.6" r="1" fill="currentColor" stroke="none"></circle>',

    alert:
      '<path d="M12 3.6 21 19.4H3z"></path>' +
      '<path d="M12 9.4v4.4"></path>' +
      '<circle cx="12" cy="16.6" r="1" fill="currentColor" stroke="none"></circle>'
  };

  /**
   * Construit une icône SVG.
   * @param {string} name  clé de la table ci-dessus ; repli sur « grid »
   * @param {number} [size=20] côté en pixels
   * @param {string} [cls] classe CSS appliquée au <svg>
   */
  function svg(name, size, cls) {
    var body = icons[name] || icons.grid;
    var s = size || 20;
    return (
      '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="1.7" stroke-linecap="round" ' +
      'stroke-linejoin="round" aria-hidden="true"' +
      (cls ? ' class="' + cls + '"' : "") +
      ">" + body + "</svg>"
    );
  }

  window.PO = window.PO || {};
  window.PO.icons = icons;
  window.PO.svg = svg;
})();

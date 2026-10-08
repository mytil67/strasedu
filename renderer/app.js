/* ==========================================================================
   StrasEdu — logique d'interface
   --------------------------------------------------------------------------
   Sommaire :
     1.  Utilitaires (échappement, accents, recherche floue, couleurs, dates)
     2.  État de l'application et pont avec le processus principal
     3.  Thème, densité, couleur d'accentuation
     4.  Navigation et fil d'Ariane
     5.  Vues : accueil, tout le catalogue, catégorie, favoris, récents
     6.  Recherche et tri
     7.  Palette de commandes (Ctrl+K)
     8.  Boîtes de dialogue (réglages, aide)
     9.  Notifications et bandeau d'état
     10. Clavier et démarrage

   Aucune bibliothèque externe : l'application est chargée depuis file://, donc
   les scripts sont classiques (pas de modules ES) et partagent window.PO.
   ========================================================================== */

(function () {
  "use strict";

  var PO = window.PO || (window.PO = {});
  var svg = PO.svg;

  /* ═══ 1. Utilitaires ═════════════════════════════════════════════════════ */

  /** Échappe une valeur destinée à du HTML. */
  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /**
   * Normalise pour la recherche : minuscules, sans accents, apostrophes et
   * tirets ramenés à des espaces. Indispensable en français, où « vidéo » doit
   * répondre à « video » et « s'identifier » à « s identifier ».
   */
  function norm(value) {
    return String(value == null ? "" : value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[’'`]/g, " ")
      .replace(/[-_/]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * Note une correspondance littérale : 0 si le terme est absent, d'autant
   * plus élevée qu'il apparaît tôt et en début de mot.
   */
  function substringScore(haystack, needle) {
    if (!needle) return 0;
    var at = haystack.indexOf(needle);
    if (at < 0) return 0;
    if (at === 0) return 130;
    var bonus = haystack.charAt(at - 1) === " " ? 40 : 0;
    return 100 + bonus - Math.min(at, 80) * 0.4;
  }

  /**
   * Repli utilisé seulement quand aucune correspondance littérale n'existe :
   * « pdl » retrouve « Podcastle ». Volontairement grossier, donc jamais
   * mélangé aux résultats exacts — sinon « montage » ramènerait n'importe
   * quel outil contenant un m, un o et un n.
   */
  function subsequenceScore(haystack, needle) {
    if (!needle) return 0;
    var h = 0;
    var n = 0;
    var gaps = 0;
    var streak = 0;
    while (h < haystack.length && n < needle.length) {
      if (haystack.charAt(h) === needle.charAt(n)) {
        n += 1;
        streak += 1;
      } else if (streak > 0) {
        gaps += 1;
        streak = 0;
      }
      h += 1;
    }
    if (n < needle.length) return 0;
    return Math.max(1, 46 - gaps * 4);
  }

  function hexToRgb(hex) {
    var value = String(hex || "").replace("#", "");
    if (value.length === 3) {
      value = value.charAt(0) + value.charAt(0) + value.charAt(1) +
        value.charAt(1) + value.charAt(2) + value.charAt(2);
    }
    if (!/^[0-9a-f]{6}$/i.test(value)) return null;
    return [
      parseInt(value.slice(0, 2), 16),
      parseInt(value.slice(2, 4), 16),
      parseInt(value.slice(4, 6), 16)
    ];
  }

  /** Mélange une couleur vers le blanc ou le noir : teintes de fond et encres. */
  function mix(hex, target, amount) {
    var rgb = hexToRgb(hex);
    if (!rgb) return hex;
    var to = target === "black" ? [0, 0, 0] : [255, 255, 255];
    var out = rgb.map(function (channel, index) {
      return Math.round(channel + (to[index] - channel) * amount);
    });
    return "rgb(" + out.join(", ") + ")";
  }

  function relativeTime(timestamp) {
    if (!timestamp) return "";
    var seconds = Math.round((Date.now() - timestamp) / 1000);
    if (seconds < 90) return "à l'instant";
    var minutes = Math.round(seconds / 60);
    if (minutes < 60) return "il y a " + minutes + " min";
    var hours = Math.round(minutes / 60);
    if (hours < 24) return "il y a " + hours + " h";
    var days = Math.round(hours / 24);
    if (days === 1) return "hier";
    if (days < 30) return "il y a " + days + " j";
    return new Date(timestamp).toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "short"
    });
  }

  function debounce(fn, delay) {
    var timer = null;
    return function () {
      var args = arguments;
      var self = this;
      clearTimeout(timer);
      timer = setTimeout(function () {
        fn.apply(self, args);
      }, delay);
    };
  }

  /* ═══ 2. État et pont applicatif ════════════════════════════════════════ */

  var bridge = window.strasedu;

  var state = {
    route: { name: "home" },
    history: [],
    query: "",
    sort: "pertinence",
    favOnly: false,
    catalog: null,
    categories: [],
    apps: [],
    byId: {},
    favorites: [],
    usage: {},
    prefs: {},
    capabilities: {},
    sync: { state: "ok", text: "" },
    // Diapositive courante du carrousel : conservée d'un rendu à l'autre, pour
    // qu'une mise en favori ne ramène pas l'utilisateur à la première.
    slideIndex: 0,
    ready: false
  };

  var els = {
    app: document.getElementById("app"),
    railNav: document.getElementById("rail-nav"),
    crumbs: document.getElementById("crumbs"),
    content: document.getElementById("content"),
    search: document.getElementById("search"),
    searchWrap: document.getElementById("search-wrap"),
    searchClear: document.getElementById("search-clear"),
    theme: document.getElementById("btn-theme"),
    fullscreen: document.getElementById("btn-fullscreen"),
    railToggle: document.getElementById("btn-rail"),
    settings: document.getElementById("btn-settings"),
    help: document.getElementById("btn-help"),
    palette: document.getElementById("palette"),
    paletteInput: document.getElementById("palette-input"),
    paletteList: document.getElementById("palette-list"),
    paletteCount: document.getElementById("palette-count"),
    dialog: document.getElementById("dialog"),
    dialogTitle: document.getElementById("dialog-title"),
    dialogBody: document.getElementById("dialog-body"),
    dialogFoot: document.getElementById("dialog-foot"),
    dialogClose: document.getElementById("dialog-close"),
    toastHost: document.getElementById("toast-host"),
    live: document.getElementById("live"),
    statusSync: document.getElementById("status-sync"),
    statusVersion: document.getElementById("status-version")
  };

  function announce(message) {
    els.live.textContent = "";
    // Le double rAF force les lecteurs d'écran à relire le message mis à jour.
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        els.live.textContent = message;
      });
    });
  }

  /* ═══ 3. Thème, densité, accentuation ═══════════════════════════════════ */

  function resolvedTheme() {
    var pref = state.prefs.theme || "system";
    if (pref === "light" || pref === "dark") return pref;
    return state.capabilities.dark ? "dark" : "light";
  }

  function applyTheme() {
    var theme = resolvedTheme();
    if (document.documentElement.getAttribute("data-theme") !== theme) {
      document.documentElement.setAttribute("data-theme", theme);
    }

    var accent = state.capabilities.accent;
    if (accent && hexToRgb(accent)) {
      var root = document.documentElement.style;
      root.setProperty("--accent", theme === "dark" ? mix(accent, "white", 0.24) : accent);
      root.setProperty("--accent-strong", mix(accent, "black", 0.32));
    }

    var system = (state.prefs.theme || "system") === "system";
    els.theme.innerHTML = svg(system ? "monitor" : theme === "dark" ? "sun" : "moon", 19);
    els.theme.title = system
      ? "Thème du système — cliquez pour forcer le clair"
      : theme === "dark"
        ? "Thème sombre — cliquez pour passer au clair"
        : "Thème clair — cliquez pour passer au sombre";
  }

  function applyDensity() {
    document.documentElement.setAttribute(
      "data-density",
      state.prefs.density === "compact" ? "compact" : "comfortable"
    );
  }

  function applyRail() {
    els.app.setAttribute("data-rail", state.prefs.rail === "compact" ? "compact" : "expanded");
    els.railToggle.setAttribute(
      "aria-pressed",
      state.prefs.rail === "compact" ? "true" : "false"
    );
  }

  /**
   * Décline la couleur d'une catégorie en fond clair et en encre lisible pour
   * le thème courant. Posée via CSSOM, donc compatible avec une CSP stricte.
   */
  function decorate(element, category) {
    var meta = categoryMeta(category);
    var color = meta.color || "#0f9d63";
    var dark = resolvedTheme() === "dark";
    element.style.setProperty("--cat-color", color);
    element.style.setProperty(
      "--cat-soft",
      dark ? mix(color, "black", 0.74) : mix(color, "white", 0.86)
    );
    element.style.setProperty(
      "--cat-ink",
      dark ? mix(color, "white", 0.42) : mix(color, "black", 0.44)
    );
  }

  function savePrefs(patch) {
    Object.assign(state.prefs, patch);
    if (bridge && bridge.setPrefs) bridge.setPrefs(state.prefs);
  }

  /* ═══ 4. Catalogue, catégories, favoris ═════════════════════════════════ */

  function categoryMeta(name) {
    var meta = (state.catalog && state.catalog.categoryMeta) || {};
    var entry = meta[name];
    var defaults = {
      Audio: { icon: "mic", color: "#7C5CFF" },
      "Vidéo": { icon: "video", color: "#E5484D" },
      IA: { icon: "sparkles", color: "#0EA5A5" },
      Fichiers: { icon: "folder", color: "#F59E0B" },
      PDF: { icon: "fileText", color: "#3B82F6" }
    };
    var fallback = defaults[name] || { icon: "layers", color: "#0f9d63" };
    var result = {
      name: name,
      icon: fallback.icon,
      color: fallback.color,
      description: ""
    };
    if (entry) {
      if (entry.icon) result.icon = entry.icon;
      if (entry.color) result.color = entry.color;
      if (entry.description) result.description = entry.description;
    }
    return result;
  }

  function appsIn(category) {
    return state.apps.filter(function (app) {
      return app.category === category;
    });
  }

  function isFavorite(id) {
    return state.favorites.indexOf(id) >= 0;
  }

  function usageOf(id) {
    return state.usage[id] || { count: 0, last: 0 };
  }

  function recentApps(limit) {
    return Object.keys(state.usage)
      .map(function (id) {
        return state.byId[id] ? { app: state.byId[id], last: state.usage[id].last || 0 } : null;
      })
      .filter(Boolean)
      .sort(function (a, b) {
        return b.last - a.last;
      })
      .slice(0, limit || 6)
      .map(function (entry) {
        return entry.app;
      });
  }

  function favoriteApps() {
    return state.favorites
      .map(function (id) {
        return state.byId[id];
      })
      .filter(Boolean);
  }

  /* ═══ 5. Recherche et tri ═══════════════════════════════════════════════ */

  /** Texte indexable d'un outil : les mots-clés sont un tableau à recoller. */
  function haystackKeywords(app) {
    return Array.isArray(app.keywords) ? app.keywords.join(" ") : app.keywords || "";
  }

  /**
   * Note d'un terme sur un outil : le nom pèse le plus, puis les mots-clés,
   * la catégorie, la description et enfin la pastille d'information.
   */
  function tokenScore(app, token) {
    return Math.max(
      substringScore(norm(app.name), token) * 3,
      substringScore(norm(haystackKeywords(app)), token) * 2.2,
      substringScore(norm(app.category), token) * 1.6,
      substringScore(norm(app.description), token),
      substringScore(norm(app.meta), token) * 0.9
    );
  }

  /** Note d'un texte quelconque (catégorie, action) pour la recherche globale. */
  function textScore(text, tokens) {
    var haystack = norm(text);
    var total = 0;
    for (var i = 0; i < tokens.length; i += 1) {
      var partial = substringScore(haystack, tokens[i]);
      if (!partial) return 0;
      total += partial;
    }
    return total;
  }

  /** Note d'un outil : tous les termes doivent correspondre (ET, non OU). */
  function appScore(app, tokens) {
    var total = 0;
    for (var i = 0; i < tokens.length; i += 1) {
      var partial = tokenScore(app, tokens[i]);
      if (!partial) return 0;
      total += partial;
    }
    return total;
  }

  function appFuzzyScore(app, needle) {
    return Math.max(
      subsequenceScore(norm(app.name), needle) * 3,
      subsequenceScore(norm(haystackKeywords(app)), needle) * 2.2,
      subsequenceScore(norm(app.category), needle) * 1.6
    );
  }

  function tokensOf(query) {
    var needle = norm(query);
    return needle ? needle.split(" ").filter(Boolean) : [];
  }

  /**
   * Recherche en deux temps : correspondances littérales sur tous les termes
   * d'abord ; le repli approximatif n'intervient que si elles sont absentes.
   */
  function searchApps(list, query) {
    var tokens = tokensOf(query);
    if (!tokens.length) return list;

    var scored = [];
    var index;

    for (index = 0; index < list.length; index += 1) {
      var exact = appScore(list[index], tokens);
      if (exact > 0) scored.push({ app: list[index], score: exact });
    }

    if (!scored.length) {
      var joined = tokens.join("");
      for (index = 0; index < list.length; index += 1) {
        var fuzzy = appFuzzyScore(list[index], joined);
        if (fuzzy > 0) scored.push({ app: list[index], score: fuzzy });
      }
    }

    scored.sort(function (a, b) {
      return b.score - a.score;
    });
    return scored.map(function (entry) {
      return entry.app;
    });
  }

  function sortApps(list) {
    var sorted = list.slice();
    if (state.sort === "az") {
      sorted.sort(function (a, b) {
        return a.name.localeCompare(b.name, "fr", { sensitivity: "base" });
      });
    } else if (state.sort === "usage") {
      sorted.sort(function (a, b) {
        var diff = usageOf(b.id).count - usageOf(a.id).count;
        return diff !== 0
          ? diff
          : a.name.localeCompare(b.name, "fr", { sensitivity: "base" });
      });
    } else {
      sorted.sort(function (a, b) {
        var diff = usageOf(b.id).count - usageOf(a.id).count;
        return diff !== 0
          ? diff
          : a.name.localeCompare(b.name, "fr", { sensitivity: "base" });
      });
    }
    return sorted;
  }

  /** Applique recherche, filtre favoris et tri à une liste d'outils. */
  function visibleApps(list) {
    var result = searchApps(list, state.query);
    if (state.favOnly) {
      result = result.filter(function (app) {
        return isFavorite(app.id);
      });
    }
    return state.query ? result : sortApps(result);
  }

  /* ═══ 6. Navigation ═════════════════════════════════════════════════════ */

  var RAIL_PRIMARY = [
    { route: "home", label: "Accueil", icon: "home" },
    { route: "all", label: "Tous les outils", icon: "grid" },
    { route: "favorites", label: "Favoris", icon: "star" },
    { route: "recents", label: "Récents", icon: "clock" }
  ];

  function routeKey(route) {
    return route.name === "cat" ? "cat:" + route.cat : route.name;
  }

  function navigate(route, options) {
    var opts = options || {};
    if (!opts.replace && routeKey(route) !== routeKey(state.route)) {
      state.history.push(state.route);
      if (state.history.length > 40) state.history.shift();
    }
    state.route = route;
    state.favOnly = false;
    if (!opts.keepQuery) {
      state.query = "";
      els.search.value = "";
      els.searchWrap.setAttribute("data-filled", "false");
    }
    render();
    els.content.scrollTop = 0;
  }

  function goBack() {
    var previous = state.history.pop();
    if (previous) {
      state.route = previous;
      render();
      els.content.scrollTop = 0;
    }
  }

  function render() {
    renderRail();
    renderCrumbs();
    renderContent();
  }

  function renderRail() {
    var html = "";

    RAIL_PRIMARY.forEach(function (item, index) {
      var count = "";
      if (item.route === "all") count = state.apps.length;
      if (item.route === "favorites") count = state.favorites.length;
      if (item.route === "recents") count = recentApps(50).length;
      html += railItem(
        item.route,
        item.label,
        svg(item.icon, 20, "rail-ico"),
        count,
        index < 9 ? "Alt+" + (index + 1) : ""
      );
    });

    if (!state.query || state.query.length === 0) {
      html += '<div class="rail-label">Catégories</div>';
      state.categories.forEach(function (name, index) {
        var meta = categoryMeta(name);
        html += railItem(
          "cat:" + name,
          name,
          '<span class="rail-dot"></span>',
          appsIn(name).length,
          index < 5 ? "Alt+" + (index + 5) : "",
          meta.color
        );
      });
    }

    els.railNav.innerHTML = html;
  }

  function railItem(key, label, iconHtml, count, shortcut, color) {
    var active = routeKey(state.route) === key;
    var title = label + (shortcut ? "  (" + shortcut + ")" : "");
    return (
      '<button class="rail-item" type="button" data-action="route" data-route="' +
      esc(key) + '" title="' + esc(title) + '"' +
      (active ? ' aria-current="page"' : "") +
      (color ? ' data-color="' + esc(color) + '"' : "") +
      ">" +
      iconHtml +
      '<span class="rail-text">' + esc(label) + "</span>" +
      (count ? '<span class="rail-count">' + count + "</span>" : "") +
      "</button>"
    );
  }

  /** Applique les couleurs de catégorie aux pastilles du rail (CSSOM). */
  function paintRail() {
    var nodes = els.railNav.querySelectorAll('[data-color]');
    Array.prototype.forEach.call(nodes, function (node) {
      node.style.setProperty("--cat-color", node.getAttribute("data-color"));
    });
  }

  function renderCrumbs() {
    var route = state.route;
    var parts = [];

    if (route.name !== "home") {
      parts.push(
        '<a class="crumb crumb-link" href="#" data-action="route" data-route="home">Accueil</a>'
      );
      parts.push('<span class="crumb-sep">' + svg("chevronRight", 14) + "</span>");
    }

    var title = "Accueil";
    if (route.name === "all") title = "Tous les outils";
    else if (route.name === "favorites") title = "Favoris";
    else if (route.name === "recents") title = "Récents";
    else if (route.name === "cat") title = route.cat;

    parts.push('<span class="crumb">' + esc(title) + "</span>");
    els.crumbs.innerHTML = parts.join("");
  }

  /* ═══ 7. Vues ═══════════════════════════════════════════════════════════ */

  function renderContent() {
    if (!state.ready) {
      renderSkeleton();
      return;
    }

    var html = '<div class="content-inner">';

    if (state.query.trim()) {
      html += viewSearchResults();
    } else if (state.route.name === "home") {
      html += viewHome();
    } else if (state.route.name === "all") {
      html += viewAll();
    } else if (state.route.name === "favorites") {
      html += viewFavorites();
    } else if (state.route.name === "recents") {
      html += viewRecents();
    } else if (state.route.name === "cat") {
      html += viewCategory(state.route.cat);
    }

    html += "</div>";
    els.content.innerHTML = html;
    applyCardColors();
    paintRail();
    initCarousel();
  }

  function applyCardColors() {
    var nodes = els.content.querySelectorAll("[data-cat]");
    Array.prototype.forEach.call(nodes, function (node) {
      decorate(node, node.getAttribute("data-cat"));
    });
  }

  function renderSkeleton() {
    var blocks = "";
    for (var i = 0; i < 6; i += 1) {
      blocks += '<div class="skeleton sk-tile"></div>';
    }
    els.content.innerHTML =
      '<div class="content-inner"><div class="hero">' +
      '<div class="skeleton sk-title"></div>' +
      '<div class="skeleton sk-sub"></div>' +
      '</div><div class="cat-grid">' + blocks + "</div></div>";
  }

  /* ── Accueil ───────────────────────────────────────────────────────────── */

  function viewHome() {
    var html = "";
    var recents = recentApps(5);
    var favorites = favoriteApps();

    // Pas d'accueil nominatif : l'outil est commun à tous les utilisateurs du
    // poste, il n'y a donc ni nom ni établissement à afficher.
    html +=
      '<header class="hero">' +
      '<h1 class="hero-title">Vos outils pédagogiques</h1>' +
      '<p class="hero-sub">Choisissez une catégorie, ou appuyez sur ' +
      '<span class="kbd">Ctrl</span> <span class="kbd">K</span> pour chercher parmi les ' +
      state.apps.length +
      " outils disponibles.</p>" +
      '<div class="hero-cta">' +
      '<button class="btn btn-primary" type="button" data-action="palette">' +
      svg("search", 17) +
      "Rechercher un outil</button>" +
      '<button class="btn" type="button" data-action="route" data-route="all">' +
      svg("grid", 17) +
      "Voir tout le catalogue</button>" +
      "</div></header>";

    // Les informations du département informatique ouvrent l'accueil : c'est ce
    // que l'établissement veut faire lire en premier.
    if (state.news) html += newsCarousel(state.news);

    // Puis les mises en avant composées par l'administration, avant les
    // rubriques personnelles de l'utilisateur.
    state.highlights.forEach(function (group) {
      html += spotlight(group);
    });

    if (recents.length) {
      html +=
        '<section class="section"><div class="section-head">' +
        '<h2 class="section-title">Reprendre</h2>' +
        '<span class="section-count">vos derniers outils ouverts</span>' +
        '<span class="section-action"><button class="btn btn-subtle btn-sm" type="button" ' +
        'data-action="route" data-route="recents">Tout voir</button></span>' +
        "</div><div class=\"chip-row\">" +
        recents.map(chip).join("") +
        "</div></section>";
    }

    if (favorites.length) {
      html +=
        '<section class="section"><div class="section-head">' +
        '<h2 class="section-title">Favoris</h2>' +
        '<span class="section-count">' + favorites.length +
        (favorites.length > 1 ? " outils" : " outil") + "</span>" +
        '<span class="section-action"><button class="btn btn-subtle btn-sm" type="button" ' +
        'data-action="route" data-route="favorites">Gérer</button></span>' +
        "</div><div class=\"chip-row\">" +
        favorites.slice(0, 8).map(chip).join("") +
        "</div></section>";
    }

    html +=
      '<section class="section"><div class="section-head">' +
      '<h2 class="section-title">Explorer par catégorie</h2>' +
      '<span class="section-count">' + state.categories.length + " catégories</span>" +
      "</div><div class=\"cat-grid\">" +
      state.categories.map(categoryTile).join("") +
      "</div></section>";

    return html;
  }

  /* ── Informations du département informatique ──────────────────────────── */

  /**
   * Carrousel des informations poussées par l'administration.
   *
   * Le défilement est horizontal avec accroche : les flèches, les pastilles, la
   * molette et le clavier fonctionnent sans JavaScript. La rotation automatique
   * s'arrête au survol, à la prise de focus, et reste désactivée si la machine
   * demande de réduire les animations.
   */
  function newsCarousel(news) {
    var items = news.items;
    var many = items.length > 1;

    var nav = many
      ? '<span class="section-action carousel-nav">' +
        // Pause explicite : une rotation automatique doit pouvoir être arrêtée
        // pour de bon, pas seulement suspendue tant que le pointeur traîne
        // dessus (WCAG 2.2.2).
        '<button class="iconbtn iconbtn-sm" type="button" data-slide-pause aria-pressed="false" ' +
        'aria-label="Mettre la rotation en pause" title="Mettre la rotation en pause">' +
        svg("pause", 16) + "</button>" +
        '<button class="iconbtn iconbtn-sm" type="button" data-slide-prev ' +
        'aria-label="Information précédente" title="Information précédente">' +
        svg("chevronLeft", 16) + "</button>" +
        '<button class="iconbtn iconbtn-sm" type="button" data-slide-next ' +
        'aria-label="Information suivante" title="Information suivante">' +
        svg("chevronRight", 16) + "</button>" +
        "</span>"
      : "";

    var dots = many
      ? '<div class="carousel-dots" role="group" aria-label="Choisir une information">' +
        items
          .map(function (item, index) {
            return (
              '<button class="carousel-dot" type="button" data-slide-dot ' +
              'data-index="' + index + '" aria-label="Information ' + (index + 1) +
              " sur " + items.length + '" aria-current="' + (index === 0 ? "true" : "false") +
              '"></button>'
            );
          })
          .join("") +
        "</div>"
      : "";

    return (
      '<section class="section news-section" data-carousel aria-label="' +
      esc(news.title || "Informations du département informatique") + '">' +
      '<div class="section-head">' +
      '<h2 class="section-title"><span class="section-ico">' + svg("bullhorn", 17) + "</span>" +
      esc(news.title || "Informations du département informatique") + "</h2>" +
      (news.subtitle ? '<span class="section-count">' + esc(news.subtitle) + "</span>" : "") +
      nav +
      "</div>" +
      '<div class="carousel-track" tabindex="0" aria-live="polite">' +
      items.map(newsSlide).join("") +
      "</div>" +
      dots +
      "</section>"
    );
  }

  function newsSlide(item, index, all) {
    var media = item.image
      ? '<div class="news-media"><img alt="" src="' + esc(item.image) + '"></div>'
      : '<div class="news-media news-media-plain" aria-hidden="true">' + svg("bullhorn", 38) + "</div>";

    return (
      '<article class="news-slide" role="group" aria-roledescription="information" ' +
      'aria-label="' + (index + 1) + " sur " + all.length + '">' +
      media +
      '<div class="news-body">' +
      (item.date ? '<span class="news-date">' + esc(item.date) + "</span>" : "") +
      (item.title ? '<h3 class="news-title">' + esc(item.title) + "</h3>" : "") +
      (item.text ? '<p class="news-text">' + esc(item.text) + "</p>" : "") +
      (item.url
        ? '<button class="btn btn-sm btn-primary news-link" type="button" data-action="news-link" ' +
          'data-id="' + esc(item.id) + '">' + esc(item.linkLabel || "En savoir plus") +
          svg("arrowUpRight", 14) + "</button>"
        : "") +
      "</div></article>"
    );
  }

  /* ── Mises en avant composées par l'administration ─────────────────────── */

  function spotlight(group) {
    var apps = group.appIds
      .map(function (id) {
        return state.byId[id];
      })
      .filter(Boolean);
    if (!apps.length) return "";

    return (
      '<section class="section"><div class="section-head">' +
      '<h2 class="section-title"><span class="section-ico">' + svg("star", 17) + "</span>" +
      esc(group.label) + "</h2>" +
      '<span class="section-count">' + apps.length +
      (apps.length > 1 ? " outils mis en avant" : " outil mis en avant") + "</span>" +
      "</div><div class=\"spot-row\">" +
      apps.map(spotCard).join("") +
      "</div></section>"
    );
  }

  function spotCard(app) {
    var favorite = isFavorite(app.id);
    var label = favorite ? "Retirer des favoris" : "Ajouter aux favoris";

    return (
      '<article class="spot-card" data-cat="' + esc(app.category) + '" data-action="open" ' +
      'data-id="' + esc(app.id) + '">' +
      appVisual(app, "spot-visual") +
      '<div class="spot-body">' +
      '<div class="spot-head">' +
      '<div class="app-name" title="' + esc(app.name) + '">' + esc(app.name) + "</div>" +
      '<button class="fav" type="button" data-action="fav" data-id="' + esc(app.id) +
      '" aria-pressed="' + (favorite ? "true" : "false") + '" aria-label="' + label +
      '" title="' + label + '">' + svg("star", 15) + "</button>" +
      "</div>" +
      '<div class="app-eyebrow"><span class="dot"></span><span class="cat">' + esc(app.category) +
      "</span>" +
      (app.meta ? '<span class="sep">·</span><span class="trunc">' + esc(app.meta) + "</span>" : "") +
      "</div>" +
      (app.description ? '<p class="spot-desc">' + esc(app.description) + "</p>" : "") +
      '<div class="spot-foot">' +
      '<button class="btn btn-sm btn-primary" type="button" data-action="open" data-id="' +
      esc(app.id) + '">' + esc(app.type === "local" ? "Lancer" : "Ouvrir") + "</button>" +
      "</div></div></article>"
    );
  }

  /**
   * Visuel d'un outil : la vignette fournie par l'administration, sinon un aplat
   * coloré portant l'icône ou les initiales. Une carte n'est jamais vide.
   */
  function appVisual(app, cls) {
    if (app.image) {
      return '<div class="' + cls + '"><img alt="" src="' + esc(app.image) + '"></div>';
    }
    return (
      '<div class="' + cls + " " + cls + '-plain"><span class="app-mark">' +
      appMark(app, 24) + "</span></div>"
    );
  }

  /* ── Carrousel : comportement ──────────────────────────────────────────── */

  var carouselTimer = null;

  /**
   * Anime le carrousel de l'accueil. Appelée après chaque rendu du contenu :
   * l'ancien minuteur est toujours arrêté, sinon les rendus successifs
   * empileraient des rotations concurrentes.
   */
  function initCarousel() {
    stopCarousel();

    var root = els.content.querySelector("[data-carousel]");
    if (!root) return;

    var track = root.querySelector(".carousel-track");
    var slides = track ? track.querySelectorAll(".news-slide") : [];
    if (slides.length < 2) return;

    var calm = !!(
      window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );

    // Une machine qui demande moins d'animations ne fait pas tourner le
    // carrousel : le bouton de pause y apparaît alors déjà enfoncé.
    var paused = calm;

    /**
     * Diapositive visée par la dernière navigation. On ne peut pas se fier à la
     * position observée : pendant l'animation, elle est encore celle d'avant,
     * si bien que deux clics rapprochés sur « suivant » n'avançaient que d'une
     * diapositive.
     */
    var target = 0;
    var movedAt = 0;

    function currentIndex() {
      var best = 0;
      var closest = Infinity;
      Array.prototype.forEach.call(slides, function (slide, index) {
        var gap = Math.abs(slide.offsetLeft - track.offsetLeft - track.scrollLeft);
        if (gap < closest) {
          closest = gap;
          best = index;
        }
      });
      return best;
    }

    function sync() {
      // Après un déplacement demandé, on laisse l'animation se terminer avant de
      // réinterpréter la position : sinon un défilement à la molette ou au
      // trackpad reprendrait la main sur la diapositive visée.
      if (Date.now() - movedAt > 700) {
        target = currentIndex();
        state.slideIndex = target;
      }
      Array.prototype.forEach.call(root.querySelectorAll("[data-slide-dot]"), function (dot, i) {
        dot.setAttribute("aria-current", i === target ? "true" : "false");
      });
    }

    function go(index) {
      var wanted = (index + slides.length) % slides.length;
      var node = slides[wanted];
      if (!node) return;
      target = wanted;
      state.slideIndex = wanted;
      movedAt = Date.now();
      track.scrollTo({
        left: node.offsetLeft - track.offsetLeft,
        behavior: calm ? "auto" : "smooth"
      });
      Array.prototype.forEach.call(root.querySelectorAll("[data-slide-dot]"), function (dot, i) {
        dot.setAttribute("aria-current", i === wanted ? "true" : "false");
      });
    }

    function startCarousel() {
      if (paused) return;
      stopCarousel();
      carouselTimer = window.setInterval(function () {
        if (document.hidden) return;
        go(target + 1);
      }, 7000);
    }

    /**
     * Navigation demandée par l'utilisateur : elle repart pour un tour complet.
     * Sans cela, une flèche cliquée juste avant l'échéance est aussitôt
     * démentie par la rotation, ce qui donne l'impression d'un carrousel
     * capricieux.
     */
    function manual(delta) {
      go(target + delta);
      startCarousel();
    }

    var pause = root.querySelector("[data-slide-pause]");

    function paintPause() {
      if (!pause) return;
      var label = paused ? "Reprendre la rotation des informations" : "Mettre la rotation en pause";
      pause.innerHTML = svg(paused ? "play" : "pause", 16);
      pause.setAttribute("aria-pressed", paused ? "true" : "false");
      pause.setAttribute("aria-label", label);
      pause.title = label;
    }

    if (pause) {
      paintPause();
      pause.addEventListener("click", function () {
        paused = !paused;
        paintPause();
        if (paused) {
          stopCarousel();
          announce("Rotation des informations en pause");
        } else {
          startCarousel();
          announce("Rotation des informations reprise");
        }
      });
    }

    var prev = root.querySelector("[data-slide-prev]");
    var next = root.querySelector("[data-slide-next]");
    if (prev) {
      prev.addEventListener("click", function () {
        manual(-1);
      });
    }
    if (next) {
      next.addEventListener("click", function () {
        manual(1);
      });
    }

    Array.prototype.forEach.call(root.querySelectorAll("[data-slide-dot]"), function (dot) {
      dot.addEventListener("click", function () {
        go(Number(dot.getAttribute("data-index")) || 0);
        startCarousel();
      });
    });

    track.addEventListener("scroll", debounce(sync, 140));
    // La rotation s'interrompt dès que l'utilisateur s'intéresse au carrousel.
    root.addEventListener("mouseenter", stopCarousel);
    root.addEventListener("mouseleave", startCarousel);
    root.addEventListener("focusin", stopCarousel);
    root.addEventListener("focusout", startCarousel);

    // On revient sur la diapositive quittée : un rendu du contenu — une mise en
    // favori, par exemple — ne doit pas ramener à la première information.
    if (state.slideIndex > 0 && state.slideIndex < slides.length) {
      track.scrollTo({
        left: slides[state.slideIndex].offsetLeft - track.offsetLeft,
        behavior: "auto"
      });
    }

    sync();
    startCarousel();
  }

  function stopCarousel() {
    if (carouselTimer) {
      window.clearInterval(carouselTimer);
      carouselTimer = null;
    }
  }

  /** Ouvre le lien d'une information du département, résolu par le processus principal. */
  function openNewsLink(itemId) {
    if (!bridge) return;
    bridge.openNews(itemId).then(function (result) {
      if (result && result.ok === false) {
        toast("Lien indisponible", result.error || "Vérifiez le catalogue de l'établissement.", "warn");
      }
    });
  }

  /** Affiche les captures d'écran d'un outil, sans quitter l'accueil. */
  function openPreview(id) {
    var app = state.byId[id];
    if (!app || !Array.isArray(app.screenshots) || !app.screenshots.length) return;
    var cta = app.type === "local" ? "Lancer" : "Ouvrir";

    var body =
      '<div class="preview-gallery">' +
      app.screenshots
        .map(function (src) {
          return (
            '<figure class="preview-shot"><img alt="Capture d\'écran de ' +
            esc(app.name) + '" src="' + esc(src) + '"></figure>'
          );
        })
        .join("") +
      "</div>" +
      (app.description ? '<p class="preview-desc">' + esc(app.description) + "</p>" : "");

    showDialog(
      app.name,
      body,
      '<button class="btn" type="button" data-action="close-dialog">Fermer</button>' +
        '<button class="btn btn-primary" type="button" data-action="open" data-id="' +
        esc(app.id) + '">' + esc(cta) + "</button>"
    );
  }

  function categoryTile(name) {
    var meta = categoryMeta(name);
    var apps = appsIn(name);
    var preview = apps.slice(0, 3);
    var rest = apps.length - preview.length;

    return (
      '<button class="cat-tile" type="button" data-action="route" data-route="cat:' +
      esc(name) + '" data-cat="' + esc(name) + '" aria-label="' + esc(name) + ", " +
      apps.length + ' outils">' +
      '<div class="cat-tile-top">' +
      '<span class="cat-ico">' + svg(meta.icon, 22) + "</span>" +
      '<span><span class="cat-name">' + esc(name) + '</span>' +
      '<div class="cat-count">' + apps.length + (apps.length > 1 ? " outils" : " outil") +
      "</div></span>" +
      '<span class="cat-chevron">' + svg("chevronRight", 20) + "</span>" +
      "</div>" +
      (meta.description ? '<p class="cat-desc">' + esc(meta.description) + "</p>" : "") +
      '<ul class="cat-preview">' +
      preview
        .map(function (app) {
          return (
            '<li><span class="dot"></span><span class="name">' + esc(app.name) +
            "</span></li>"
          );
        })
        .join("") +
      (rest > 0 ? '<li class="cat-more">et ' + rest + " autre" + (rest > 1 ? "s" : "") + "</li>" : "") +
      "</ul></button>"
    );
  }

  /** Pastille d'un outil : icône choisie par l'administrateur, sinon initiales. */
  function appMark(app, size) {
    if (app.icon) return svg(app.icon, size || 22);
    return esc(app.mark || String(app.name || "").slice(0, 2));
  }

  /**
   * Applique la marque de l'établissement : son logo s'il est fourni par le
   * catalogue, sinon la marque par défaut de StrasEdu.
   */
  function renderBranding() {
    var logo = state.catalog && state.catalog.logo;
    var node = document.getElementById("rail-logo");
    if (!node) return;

    if (logo) {
      node.classList.add("has-logo");
      node.innerHTML = '<img alt="" src="' + esc(logo) + '">';
    } else {
      node.classList.remove("has-logo");
      node.innerHTML =
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">' +
        '<rect x="3.4" y="3.4" width="7.4" height="7.4" rx="2"></rect>' +
        '<rect x="13.2" y="3.4" width="7.4" height="7.4" rx="2"></rect>' +
        '<rect x="3.4" y="13.2" width="7.4" height="7.4" rx="2"></rect>' +
        '<rect x="13.2" y="13.2" width="7.4" height="7.4" rx="2"></rect>' +
        "</svg>";
    }
  }

  function chip(app) {
    var entry = usageOf(app.id);
    return (
      '<button class="chip" type="button" data-action="open" data-id="' + esc(app.id) +
      '" data-cat="' + esc(app.category) + '" title="' + esc(app.description) + '">' +
      '<span class="chip-mark">' + appMark(app, 14) + "</span>" +
      esc(app.name) +
      (entry.last ? '<span class="chip-time">' + esc(relativeTime(entry.last)) + "</span>" : "") +
      "</button>"
    );
  }

  /* ── Toutes les vues « grille » ────────────────────────────────────────── */

  function pageHead(title, iconName, count, description, categoryName) {
    return (
      '<header class="page-head"' + (categoryName ? ' data-cat="' + esc(categoryName) + '"' : "") + ">" +
      '<div class="page-head-main">' +
      '<h1 class="page-title">' +
      (iconName ? '<span class="page-ico">' + svg(iconName, 26) + "</span>" : "") +
      esc(title) +
      "</h1>" +
      (description ? '<p class="page-sub">' + esc(description) + "</p>" : "") +
      "</div>" +
      '<div class="page-tools">' +
      '<span class="section-count">' + count + (count > 1 ? " outils" : " outil") + "</span>" +
      toolBar() +
      "</div></header>"
    );
  }

  function toolBar() {
    function seg(value, label, current, action) {
      return (
        '<button type="button" data-action="' + action + '" data-value="' + esc(value) +
        '" aria-pressed="' + (current === value ? "true" : "false") + '">' +
        esc(label) + "</button>"
      );
    }
    return (
      '<div class="segmented" role="group" aria-label="Trier par">' +
      seg("pertinence", "Plus utilisés", state.sort, "sort") +
      seg("az", "A → Z", state.sort, "sort") +
      "</div>" +
      '<button class="btn btn-sm" type="button" data-action="fav-filter" aria-pressed="' +
      (state.favOnly ? "true" : "false") + '">' +
      svg("star", 15) + "Favoris</button>"
    );
  }

  function grid(apps) {
    if (!apps.length) return "";
    return (
      '<div class="app-grid" data-density="' +
      (state.prefs.density === "compact" ? "compact" : "comfortable") + '">' +
      apps.map(appCard).join("") + "</div>"
    );
  }

  function appCard(app) {
    var entry = usageOf(app.id);
    var favorite = isFavorite(app.id);
    var cta = app.type === "local" ? "Lancer" : "Ouvrir";
    var shots = Array.isArray(app.screenshots) ? app.screenshots.length : 0;

    return (
      '<article class="app-card' + (app.image ? " has-visual" : "") + '" data-cat="' +
      esc(app.category) + '" data-action="open" data-id="' + esc(app.id) + '">' +
      (app.image ? appVisual(app, "app-visual") : "") +
      '<div class="app-card-head">' +
      '<span class="app-mark">' + appMark(app, 22) + "</span>" +
      '<div class="app-card-title">' +
      '<div class="app-name" title="' + esc(app.name) + '">' + esc(app.name) + "</div>" +
      '<div class="app-eyebrow"><span class="dot"></span>' +
      '<span class="cat">' + esc(app.category) + "</span>" +
      (app.meta ? '<span class="sep">·</span><span class="trunc">' + esc(app.meta) + "</span>" : "") +
      "</div></div>" +
      (app.badge > 0 ? '<span class="badge" title="' + app.badge + ' éléments">' + app.badge + "</span>" : "") +
      '<button class="fav" type="button" data-action="fav" data-id="' + esc(app.id) +
      '" aria-pressed="' + (favorite ? "true" : "false") + '" aria-label="' +
      (favorite ? "Retirer des favoris" : "Ajouter aux favoris") + '" title="' +
      (favorite ? "Retirer des favoris" : "Ajouter aux favoris") + '">' +
      svg("star", 16) + "</button>" +
      "</div>" +
      '<p class="app-desc">' + esc(app.description) + "</p>" +
      '<div class="app-card-foot">' +
      (entry.count > 1
        ? '<span class="app-usage">ouvert ' + entry.count + " fois</span>"
        : '<span class="app-usage"></span>') +
      (shots
        ? '<button class="btn btn-sm btn-subtle app-shot-btn" type="button" data-action="preview" ' +
          'data-id="' + esc(app.id) + '" title="Voir les captures d\'écran" aria-label="Aperçu de ' +
          esc(app.name) + ' : ' + shots + (shots > 1 ? " captures" : " capture") + '">' +
          svg("images", 15) + "<span>" + shots + "</span></button>"
        : "") +
      '<span class="app-open">' + cta + svg("arrowUpRight", 15) + "</span>" +
      '<button class="btn btn-sm btn-primary" type="button" data-action="open" data-id="' +
      esc(app.id) + '">' + esc(cta) + "</button>" +
      "</div></article>"
    );
  }

  function viewAll() {
    var apps = visibleApps(state.apps);
    var html = pageHead(
      "Tous les outils",
      "grid",
      apps.length,
      "L'ensemble des ressources pédagogiques validées par l'établissement."
    );
    html += apps.length
      ? grid(apps)
      : emptyState(
          "star",
          "Aucun outil ne correspond",
          state.favOnly
            ? "Aucun favori dans ce périmètre. Retirez le filtre pour retrouver tous les outils."
            : "Modifiez votre recherche ou explorez les catégories depuis l'accueil.",
          state.favOnly
            ? [{ action: "fav-filter", label: "Retirer le filtre Favoris", primary: true }]
            : [{ action: "route", value: "home", label: "Revenir à l'accueil", primary: true }]
        );
    return html;
  }

  function viewCategory(name) {
    var meta = categoryMeta(name);
    var apps = visibleApps(appsIn(name));
    var html = pageHead(
      name,
      meta.icon,
      apps.length,
      meta.description || "Les outils de cette catégorie.",
      name
    );
    html += apps.length
      ? grid(apps)
      : emptyState(
          meta.icon,
          "Rien à afficher ici",
          state.query
            ? "Aucun outil de « " + name + " » ne correspond à votre recherche."
            : "Cette catégorie est vide pour le moment.",
          [{ action: "route", value: "home", label: "Revenir à l'accueil", primary: true }]
        );
    return html;
  }

  function viewFavorites() {
    var apps = visibleApps(favoriteApps());
    var html = pageHead(
      "Favoris",
      "star",
      apps.length,
      "Vos outils épinglés, accessibles en un clic depuis toutes les pages."
    );
    html += apps.length
      ? grid(apps)
      : emptyState(
          "star",
          "Aucun favori pour l'instant",
          "Survolez une fiche outil et cliquez sur l'étoile pour l'ajouter ici. " +
            "Vos favoris restent sur ce poste et vous suivent d'une session à l'autre.",
          [{ action: "route", value: "home", label: "Parcourir les catégories", primary: true }]
        );
    return html;
  }

  function viewRecents() {
    var apps = visibleApps(recentApps(50));
    var html = pageHead(
      "Récents",
      "clock",
      apps.length,
      "Les outils que vous avez ouverts, du plus récent au plus ancien."
    );
    html += apps.length
      ? grid(apps)
      : emptyState(
          "clock",
          "Aucune activité",
          "Les outils que vous ouvrez apparaîtront ici, pour les retrouver sans chercher.",
          [{ action: "route", value: "home", label: "Parcourir les catégories", primary: true }]
        );
    return html;
  }

  function viewSearchResults() {
    var results = visibleApps(state.apps);
    var html = pageHead(
      "Résultats",
      "search",
      results.length,
      "Recherche « " + state.query.trim() + " » dans l'ensemble du catalogue."
    );
    html += results.length
      ? grid(results)
      : emptyState(
          "search",
          "Aucun résultat",
          "Vérifiez l'orthographe, essayez un mot plus court, ou parcourez les catégories.",
          [
            { action: "clear-search", label: "Effacer la recherche", primary: true },
            { action: "route", value: "home", label: "Explorer les catégories" }
          ]
        );
    return html;
  }

  function emptyState(iconName, title, text, actions) {
    return (
      '<div class="empty">' +
      '<span class="empty-ico">' + svg(iconName, 34) + "</span>" +
      '<div class="empty-title">' + esc(title) + "</div>" +
      '<p class="empty-text">' + esc(text) + "</p>" +
      (actions && actions.length
        ? '<div class="empty-actions">' +
          actions
            .map(function (action) {
              return (
                '<button class="btn' + (action.primary ? " btn-primary" : "") +
                '" type="button" data-action="' + esc(action.action) + '"' +
                (action.value ? ' data-value="' + esc(action.value) + '"' : "") + ">" +
                esc(action.label) + "</button>"
              );
            })
            .join("") +
          "</div>"
        : "") +
      "</div>"
    );
  }

  /* ═══ 8. Palette de commandes ═══════════════════════════════════════════ */

  var paletteState = { items: [], active: 0 };

  function paletteActions() {
    var actions = [
      { label: "Aller à l'accueil", desc: "Vue d'ensemble et catégories", icon: "home", run: function () { navigate({ name: "home" }); } },
      { label: "Tous les outils", desc: "Parcourir le catalogue complet", icon: "grid", run: function () { navigate({ name: "all" }); } },
      { label: "Favoris", desc: "Vos outils épinglés", icon: "star", run: function () { navigate({ name: "favorites" }); } },
      { label: "Récents", desc: "Derniers outils ouverts", icon: "clock", run: function () { navigate({ name: "recents" }); } },
      { label: "Changer de thème", desc: "Clair, sombre ou thème de Windows", icon: "moon", run: function () { toggleTheme(); } },
      { label: "Réglages", desc: "Thème, densité, catalogue et mises à jour", icon: "settings", run: function () { openSettings(); } },
      { label: "Vérifier les mises à jour", desc: "Interroger le catalogue de l'établissement", icon: "refresh", run: function () { checkUpdates(); } },
      { label: "Aide et raccourcis", desc: "Toutes les astuces clavier", icon: "help", run: function () { openHelp(); } }
    ];
    if (state.capabilities.catalogPath) {
      actions.push({
        label: "Ouvrir le dossier du catalogue",
        desc: state.capabilities.catalogPath,
        icon: "folder",
        run: function () {
          bridge.revealCatalog();
        }
      });
    }
    return actions;
  }

  function buildPalette(query) {
    var tokens = tokensOf(query);
    var hasQuery = tokens.length > 0;
    var items = [];

    state.apps.forEach(function (app) {
      var best = hasQuery
        ? appScore(app, tokens)
        : usageOf(app.id).count * 2 + (isFavorite(app.id) ? 6 : 0);
      if (!hasQuery || best > 0) {
        items.push({
          group: "Outils",
          label: app.name,
          desc: app.category + (app.meta ? " · " + app.meta : ""),
          mark: app.mark || app.name.slice(0, 2),
          appIcon: app.icon || null,
          category: app.category,
          score: best + 40,
          run: function () {
            openApp(app.id);
          },
          favoriteToggle: app.id
        });
      }
    });

    state.categories.forEach(function (name) {
      var meta = categoryMeta(name);
      var best = hasQuery
        ? textScore(name + " " + (meta.description || ""), tokens) * 1.6
        : 0;
      if (!hasQuery || best > 0) {
        items.push({
          group: "Catégories",
          label: name,
          desc: appsIn(name).length + " outils" + (meta.description ? " · " + meta.description : ""),
          icon: meta.icon,
          category: name,
          score: best + 20,
          run: function () {
            navigate({ name: "cat", cat: name });
          }
        });
      }
    });

    paletteActions().forEach(function (action) {
      var best = hasQuery ? textScore(action.label + " " + action.desc, tokens) : 1;
      if (!hasQuery || best > 0) {
        items.push({
          group: "Actions",
          label: action.label,
          desc: action.desc,
          icon: action.icon,
          score: best + 10,
          run: action.run
        });
      }
    });

    if (hasQuery) {
      items.sort(function (a, b) {
        return b.score - a.score;
      });
    }
    return items.slice(0, 60);
  }

  function renderPalette() {
    var items = paletteState.items;
    var html = "";
    var lastGroup = null;

    items.forEach(function (item, index) {
      if (item.group !== lastGroup) {
        html += '<li class="palette-group" role="presentation">' + esc(item.group) + "</li>";
        lastGroup = item.group;
      }
      var marker = item.appIcon
        ? '<span class="palette-opt-mark">' + svg(item.appIcon, 17) + "</span>"
        : item.mark
          ? '<span class="palette-opt-mark">' + esc(item.mark) + "</span>"
          : '<span class="palette-opt-mark">' + svg(item.icon || "grid", 17) + "</span>";
      html +=
        '<li role="option" id="palette-opt-' + index + '" class="palette-opt" ' +
        'aria-selected="' + (index === paletteState.active ? "true" : "false") + '" ' +
        'data-index="' + index + '"' +
        (item.category ? ' data-cat="' + esc(item.category) + '"' : "") + ">" +
        marker +
        '<span class="palette-opt-body">' +
        '<span class="palette-opt-name">' + esc(item.label) + "</span>" +
        '<span class="palette-opt-desc">' + esc(item.desc) + "</span>" +
        "</span>" +
        '<span class="palette-opt-go">' + svg("arrowUpRight", 16) + "</span>" +
        "</li>";
    });

    if (!items.length) {
      html =
        '<li class="palette-empty" role="presentation">Aucun résultat pour « ' +
        esc(els.paletteInput.value) + " ».<br>Essayez un mot plus court ou le nom d'une catégorie.</li>";
    }

    els.paletteList.innerHTML = html;
    els.paletteCount.textContent = items.length
      ? items.length + (items.length > 1 ? " résultats" : " résultat")
      : "";

    var activeNode = els.paletteList.querySelector('[aria-selected="true"]');
    if (activeNode) {
      els.paletteInput.setAttribute("aria-activedescendant", activeNode.id);
      activeNode.scrollIntoView({ block: "nearest" });
    } else {
      els.paletteInput.removeAttribute("aria-activedescendant");
    }

    var nodes = els.paletteList.querySelectorAll("[data-cat]");
    Array.prototype.forEach.call(nodes, function (node) {
      node.style.setProperty("--cat-color", categoryMeta(node.getAttribute("data-cat")).color);
    });
  }

  function openPalette(prefill) {
    if (!state.ready) return;
    els.palette.hidden = false;
    els.paletteInput.value = prefill || state.query || "";
    paletteState.items = buildPalette(els.paletteInput.value);
    paletteState.active = 0;
    renderPalette();
    els.paletteInput.focus();
    els.paletteInput.select();
  }

  function closePalette() {
    els.palette.hidden = true;
    paletteState.items = [];
  }

  function paletteMove(delta) {
    if (!paletteState.items.length) return;
    var count = paletteState.items.length;
    paletteState.active = (paletteState.active + delta + count) % count;
    renderPalette();
  }

  function paletteRun(withFavorite) {
    var item = paletteState.items[paletteState.active];
    if (!item) return;
    if (withFavorite && item.favoriteToggle) {
      toggleFavorite(item.favoriteToggle);
      renderPalette();
      return;
    }
    closePalette();
    item.run();
  }

  /* ═══ 9. Boîtes de dialogue ═════════════════════════════════════════════ */

  var dialogOpen = false;

  function showDialog(title, bodyHtml, footHtml) {
    els.dialogTitle.textContent = title;
    els.dialogBody.innerHTML = bodyHtml;
    els.dialogFoot.innerHTML = footHtml || "";
    els.dialog.hidden = false;
    dialogOpen = true;
    var focusable = els.dialog.querySelector("button, input, [tabindex]");
    if (focusable) focusable.focus();
    var colored = els.dialog.querySelectorAll("[data-cat]");
    Array.prototype.forEach.call(colored, function (node) {
      decorate(node, node.getAttribute("data-cat"));
    });
  }

  function closeDialog() {
    els.dialog.hidden = true;
    dialogOpen = false;
  }

  function settingRow(name, help, controlHtml) {
    return (
      '<div class="setting">' +
      '<div class="setting-text"><div class="setting-name">' + esc(name) + "</div>" +
      (help ? '<div class="setting-help">' + esc(help) + "</div>" : "") +
      "</div>" + controlHtml + "</div>"
    );
  }

  function segmented(name, options, current) {
    return (
      '<div class="segmented" role="group" aria-label="' + esc(name) + '">' +
      options
        .map(function (option) {
          return (
            '<button type="button" data-action="pref" data-pref="' + esc(option.pref) +
            '" data-value="' + esc(option.value) + '" aria-pressed="' +
            (current === option.value ? "true" : "false") + '">' + esc(option.label) + "</button>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function switchControl(pref, value, label) {
    return (
      '<button class="switch" type="button" role="switch" data-action="pref-toggle" ' +
      'data-pref="' + esc(pref) + '" aria-checked="' + (value ? "true" : "false") +
      '" aria-label="' + esc(label) + '"></button>'
    );
  }

  function openSettings() {
    var caps = state.capabilities;
    var sync = state.sync;

    var body =
      settingRow(
        "Thème",
        "« Système » suit le réglage clair/sombre de Windows.",
        segmented(
          "Thème",
          [
            { pref: "theme", value: "system", label: "Système" },
            { pref: "theme", value: "light", label: "Clair" },
            { pref: "theme", value: "dark", label: "Sombre" }
          ],
          state.prefs.theme || "system"
        )
      ) +
      settingRow(
        "Densité d'affichage",
        "« Compact » affiche davantage d'outils à l'écran.",
        segmented(
          "Densité",
          [
            { pref: "density", value: "comfortable", label: "Confort" },
            { pref: "density", value: "compact", label: "Compact" }
          ],
          state.prefs.density || "comfortable"
        )
      ) +
      settingRow(
        "Effet Mica (Windows 11)",
        caps.windows11
          ? "Fond translucide dessiné par Windows, derrière l'interface."
          : "Disponible uniquement sur Windows 11 (détecté : " + esc(caps.osName || "inconnu") + ").",
        switchControl("mica", state.prefs.mica !== false && caps.windows11, "Effet Mica")
      ) +
      settingRow(
        "Menu latéral",
        "Le menu réduit affiche uniquement les icônes.",
        segmented(
          "Menu latéral",
          [
            { pref: "rail", value: "expanded", label: "Déployé" },
            { pref: "rail", value: "compact", label: "Réduit" }
          ],
          state.prefs.rail || "expanded"
        )
      ) +
      settingRow(
        "Démarrer en plein écran",
        "S'applique au prochain lancement — utile sur un poste de classe. " +
          "F11 bascule immédiatement, et Échap en sort.",
        switchControl("fullscreen", state.prefs.fullscreen === true, "Démarrage en plein écran")
      ) +
      settingRow(
        "Catalogue",
        // settingRow échappe déjà son texte : ne pas échapper une seconde fois,
        // sinon une apostrophe s'affiche « &#39; ».
        "Version " + ((state.catalog && state.catalog.version) || "?") +
          " · " + state.apps.length + " outils · mis à jour le " +
          ((state.catalog && state.catalog.lastUpdated) || "?") +
          (caps.remoteConfigured ? "" : " · aucune source distante configurée"),
        '<button class="btn btn-sm" type="button" data-action="check-update">' +
          svg("refresh", 15) + "Vérifier</button>"
      ) +
      settingRow(
        "Source du catalogue",
        caps.remoteSource
          ? caps.remoteSource +
            (sync.lastChecked
              ? " · vérifiée " + relativeTime(sync.lastChecked)
              : " · pas encore vérifiée")
          : "Aucune source distante : le poste utilise le catalogue livré avec l'application.",
        ""
      ) +
      settingRow(
        "Favoris",
        state.favorites.length + (state.favorites.length > 1 ? " outils épinglés" : " outil épinglé"),
        '<button class="btn btn-sm" type="button" data-action="reset-favorites">Tout retirer</button>'
      );

    var status =
      sync.text && sync.state !== "ok"
        ? '<div class="setting"><div class="setting-text"><div class="setting-name">Dernière synchronisation</div>' +
          '<div class="setting-help">' + esc(sync.text) + "</div></div></div>"
        : "";

    showDialog(
      "Réglages",
      body + status,
      '<button class="btn" type="button" data-action="open-help">Raccourcis clavier</button>' +
        '<button class="btn btn-primary" type="button" data-action="close-dialog">Terminé</button>'
    );
  }

  function openHelp() {
    var shortcuts = [
      ["Ctrl + K", "Ouvrir la recherche globale et les actions"],
      ["/", "Aller au champ de recherche"],
      ["F1", "Afficher cette aide"],
      ["F11", "Passer en plein écran, ou revenir à la fenêtre"],
      ["Ctrl + ,", "Ouvrir les réglages"],
      ["Alt + ←", "Revenir à la vue précédente"],
      ["Alt + 1 à 9", "Accueil, catalogue, favoris, récents, puis les catégories"],
      ["↑ ↓ puis Entrée", "Parcourir et ouvrir un résultat dans la recherche globale"],
      ["Ctrl + Entrée", "Mettre le résultat sélectionné en favori"],
      ["Échap", "Effacer la recherche ou fermer la fenêtre active"]
    ];

    var body =
      '<table class="shortcuts"><tbody>' +
      shortcuts
        .map(function (row) {
          return (
            '<tr><td class="shortcuts-key"><span class="kbd">' + esc(row[0]) + "</span></td>" +
            '<td class="shortcuts-desc">' + esc(row[1]) + "</td></tr>"
          );
        })
        .join("") +
      "</tbody></table>" +
      '<p class="setting-help about-line">' +
      "StrasEdu " + esc(state.capabilities.version || "") +
      " · " + state.apps.length + " outils référencés.</p>";

    showDialog("Aide et raccourcis", body, '<button class="btn btn-primary" type="button" data-action="close-dialog">Fermer</button>');
  }

  /* ═══ 10. Notifications, mises à jour, ouverture ════════════════════════ */

  function toast(title, text, tone, actionLabel, action) {
    var node = document.createElement("div");
    node.className = "toast";
    if (tone) node.setAttribute("data-tone", tone);
    node.innerHTML =
      '<div class="toast-body"><div class="toast-title">' + esc(title) + "</div>" +
      (text ? '<div class="toast-text">' + esc(text) + "</div>" : "") +
      "</div>";

    var close = document.createElement("button");
    close.className = "iconbtn";
    close.setAttribute("aria-label", "Fermer");
    close.innerHTML = svg("x", 15);
    close.addEventListener("click", function () {
      node.remove();
    });
    node.appendChild(close);

    if (actionLabel && action) {
      var button = document.createElement("button");
      button.className = "btn btn-sm btn-primary";
      button.textContent = actionLabel;
      button.addEventListener("click", function () {
        node.remove();
        action();
      });
      node.insertBefore(button, close);
    }

    els.toastHost.appendChild(node);
    setTimeout(function () {
      node.remove();
    }, tone === "warn" ? 9000 : 6000);
  }

  function openApp(id) {
    var app = state.byId[id];
    if (!app) return;

    // Lancer un outil referme l'aperçu ou les réglages restés ouverts.
    closeDialog();

    // Mise à jour optimiste : « Récents » réagit immédiatement.
    var entry = usageOf(id);
    state.usage[id] = { count: (entry.count || 0) + 1, last: Date.now() };
    render();

    if (!bridge) return;
    bridge.openApp(id).then(function (result) {
      if (result && result.ok === false) {
        toast(
          "Impossible d'ouvrir " + app.name,
          result.error || "Vérifiez que l'outil est bien installé sur ce poste.",
          "warn"
        );
      }
    });
  }

  function toggleFavorite(id) {
    var index = state.favorites.indexOf(id);
    if (index >= 0) state.favorites.splice(index, 1);
    else state.favorites.push(id);
    if (bridge) bridge.setFavorites(state.favorites);
    render();
    var app = state.byId[id];
    announce(
      (index >= 0 ? "Retiré des favoris : " : "Ajouté aux favoris : ") +
        (app ? app.name : id)
    );
  }

  function setTheme(pref) {
    savePrefs({ theme: pref });
    applyTheme();
    renderContent();
    if (bridge && bridge.setTheme) bridge.setTheme(pref);
  }

  function toggleTheme() {
    var next = resolvedTheme() === "dark" ? "light" : "dark";
    setTheme(next);
  }

  function checkUpdates() {
    if (!bridge || !bridge.checkUpdate) return;
    state.sync = { state: "checking", text: "Vérification en cours…" };
    renderStatus();
    bridge.checkUpdate().then(function (result) {
      applyUpdateResult(result);
      if (result && result.updated) {
        toast("Catalogue mis à jour", "Version " + result.version + " disponible.", null, "Recharger", reloadCatalog);
      } else {
        toast(
          "Catalogue à jour",
          result && result.reason === "no-remote-url"
            ? "Aucune source distante n'est configurée : le catalogue embarqué est utilisé."
            : "Aucune nouvelle version n'a été trouvée.",
          result && result.reason === "no-remote-url" ? "warn" : null
        );
      }
    });
  }

  function applyUpdateResult(result) {
    if (!result) return;
    if (result.updated) {
      state.sync = { state: "warn", text: "Nouvelle version " + result.version + " du catalogue." };
    } else if (result.reason === "no-remote-url") {
      state.sync = { state: "warn", text: "Catalogue local (aucune source distante)." };
    } else if (result.ok === false || result.reason) {
      state.sync = { state: "ok", text: "Catalogue à jour." };
    }
    renderStatus();
  }

  function reloadCatalog() {
    if (!bridge) return;
    bridge.getSnapshot().then(function (snapshot) {
      absorb(snapshot);
      render();
      toast("Catalogue rechargé", state.apps.length + " outils disponibles.");
    });
  }

  function renderStatus() {
    var sync = state.sync;
    els.statusSync.setAttribute("data-state", sync.state === "warn" ? "warn" : "ok");
    els.statusSync.textContent = sync.text || "Catalogue local";
    els.statusVersion.textContent = "v" + (state.capabilities.version || "");
  }

  /* ═══ 11. Absorption des données et démarrage ═══════════════════════════ */

  function absorb(snapshot) {
    state.catalog = snapshot.catalog || { apps: [], categories: [] };
    state.apps = Array.isArray(state.catalog.apps) ? state.catalog.apps : [];
    state.categories = Array.isArray(state.catalog.categories)
      ? state.catalog.categories.map(function (entry) {
          return typeof entry === "string" ? entry : entry && entry.name;
        }).filter(Boolean)
      : [];

    // Catégories déduites du catalogue si la liste déclarée est incomplète.
    state.apps.forEach(function (app) {
      if (app.category && state.categories.indexOf(app.category) < 0) {
        state.categories.push(app.category);
      }
    });

    state.byId = {};
    state.apps.forEach(function (app) {
      state.byId[app.id] = app;
    });

    // Informations du département informatique et mises en avant composées par
    // l'administration. Absentes d'un catalogue 1.x : l'accueil s'affiche alors
    // exactement comme avant.
    var news = state.catalog.news;
    state.news = news && Array.isArray(news.items) && news.items.length ? news : null;
    state.highlights = Array.isArray(state.catalog.highlights) ? state.catalog.highlights : [];

    state.favorites = (snapshot.favorites || []).filter(function (id) {
      return state.byId[id];
    });
    state.usage = snapshot.usage || {};
    state.prefs = snapshot.prefs || {};
    state.capabilities = snapshot.capabilities || {};
    state.fullscreen = !!state.capabilities.fullscreen;
    if (els.fullscreen) {
      els.fullscreen.setAttribute("aria-pressed", state.fullscreen ? "true" : "false");
    }
    state.sync = snapshot.sync || { state: "ok", text: "Catalogue local" };

    renderBranding();
  }

  function applyAllPreferences() {
    var caps = state.capabilities;
    var micaOn = state.prefs.mica !== false && !!caps.windows11;
    document.documentElement.setAttribute("data-mica", micaOn ? "on" : "off");
    applyTheme();
    applyDensity();
    applyRail();
  }

  var onSearchInput = debounce(function (value) {
    state.query = value;
    els.searchWrap.setAttribute("data-filled", value ? "true" : "false");
    renderContent();
    announce(
      value
        ? "Recherche « " + value + " » : " +
          els.content.querySelectorAll(".app-card").length + " résultat(s)"
        : "Recherche effacée"
    );
  }, 130);

  function wireEvents() {
    /* Délégation : un seul écouteur gère toutes les commandes de l'interface. */
    document.addEventListener("click", function (event) {
      var option = event.target.closest(".palette-opt");
      if (option) {
        paletteState.active = Number(option.getAttribute("data-index"));
        paletteRun(event.ctrlKey || event.metaKey);
        return;
      }

      var target = event.target.closest("[data-action]");
      if (!target) return;
      var action = target.getAttribute("data-action");

      if (target.tagName === "A") event.preventDefault();

      switch (action) {
        case "route":
          navigate(routeFromKey(target.getAttribute("data-route")));
          break;
        case "open":
          openApp(target.getAttribute("data-id"));
          break;
        case "preview":
          openPreview(target.getAttribute("data-id"));
          break;
        case "news-link":
          openNewsLink(target.getAttribute("data-id"));
          break;
        case "fav":
          toggleFavorite(target.getAttribute("data-id"));
          break;
        case "sort":
          state.sort = target.getAttribute("data-value");
          renderContent();
          break;
        case "fav-filter":
          state.favOnly = !state.favOnly;
          renderContent();
          break;
        case "clear-search":
          els.search.value = "";
          state.query = "";
          els.searchWrap.setAttribute("data-filled", "false");
          renderContent();
          break;
        case "palette":
          openPalette();
          break;
        case "close-dialog":
          closeDialog();
          break;
        case "open-settings":
          openSettings();
          break;
        case "open-help":
          closeDialog();
          openHelp();
          break;
        case "check-update":
          checkUpdates();
          break;
        case "reset-favorites":
          state.favorites = [];
          if (bridge) bridge.setFavorites([]);
          render();
          toast("Favoris réinitialisés", "La liste des outils épinglés est vide.");
          break;
        case "pref":
          handlePref(target.getAttribute("data-pref"), target.getAttribute("data-value"), target);
          break;
        case "pref-toggle":
          handlePrefToggle(target.getAttribute("data-pref"), target);
          break;
        default:
          break;
      }
    });

    els.search.addEventListener("input", function (event) {
      onSearchInput(event.target.value);
    });

    els.searchClear.addEventListener("click", function () {
      els.search.value = "";
      state.query = "";
      els.searchWrap.setAttribute("data-filled", "false");
      renderContent();
      els.search.focus();
    });

    els.theme.addEventListener("click", toggleTheme);

    if (els.fullscreen) {
      els.fullscreen.addEventListener("click", function () {
        setFullscreen();
      });
    }

    els.railToggle.addEventListener("click", function () {
      savePrefs({ rail: state.prefs.rail === "compact" ? "expanded" : "compact" });
      applyRail();
    });

    els.settings.addEventListener("click", openSettings);
    els.help.addEventListener("click", openHelp);
    els.dialogClose.addEventListener("click", closeDialog);

    els.palette.addEventListener("mousedown", function (event) {
      if (event.target === els.palette) closePalette();
    });
    els.dialog.addEventListener("mousedown", function (event) {
      if (event.target === els.dialog) closeDialog();
    });

    els.paletteInput.addEventListener("input", function () {
      paletteState.items = buildPalette(els.paletteInput.value);
      paletteState.active = 0;
      renderPalette();
    });

    // La barre de défilement ne se montre que pendant le défilement : elle
    // situe la page sans encombrer l'interface au repos.
    function fadeScrollbar(node) {
      node.setAttribute("data-scrolling", "true");
      window.clearTimeout(node.straseduScrollFade);
      node.straseduScrollFade = window.setTimeout(function () {
        node.removeAttribute("data-scrolling");
      }, 900);
    }
    els.content.addEventListener("scroll", function () {
      fadeScrollbar(els.content);
    });
    els.railNav.addEventListener("scroll", function () {
      fadeScrollbar(els.railNav);
    });

    // La molette agit partout dans la fenêtre : un utilisateur qui laisse le
    // pointeur sur le menu latéral, la barre du haut ou la barre d'état doit
    // pouvoir faire défiler la page, sinon elle paraît figée.
    document.addEventListener(
      "wheel",
      function (event) {
        if (event.defaultPrevented || event.ctrlKey) return;
        var node = event.target;
        // Ces zones défilent pour leur propre compte : ne pas s'en mêler.
        if (node && node.closest && node.closest(".content, .rail-scroll, .palette, .dialog")) {
          return;
        }
        if (!els.content) return;
        els.content.scrollTop += event.deltaY;
      },
      { passive: true }
    );

    document.addEventListener("keydown", onKeyDown);
  }

  function routeFromKey(key) {
    if (key === "home") return { name: "home" };
    if (key === "all") return { name: "all" };
    if (key === "favorites") return { name: "favorites" };
    if (key === "recents") return { name: "recents" };
    if (key.indexOf("cat:") === 0) return { name: "cat", cat: key.slice(4) };
    return { name: "home" };
  }

  function handlePref(pref, value, node) {
    savePrefs({ [pref]: value });
    if (pref === "theme") setTheme(value);
    if (pref === "density") applyDensity();
    if (pref === "rail") applyRail();

    var group = node.parentElement;
    Array.prototype.forEach.call(group.querySelectorAll("button"), function (button) {
      button.setAttribute(
        "aria-pressed",
        button.getAttribute("data-value") === value ? "true" : "false"
      );
    });
    renderContent();
  }

  function handlePrefToggle(pref, node) {
    var next = node.getAttribute("aria-checked") !== "true";
    node.setAttribute("aria-checked", next ? "true" : "false");
    savePrefs({ [pref]: next });
    if (pref === "mica") {
      document.documentElement.setAttribute("data-mica", next ? "on" : "off");
      if (bridge && bridge.setMica) bridge.setMica(next);
    }
  }

  /**
   * Plein écran. Le rendu ne peut pas piloter la fenêtre : il transmet l'état
   * voulu au processus principal, qui seul décide. Échap en sort, comme dans
   * n'importe quelle application Windows.
   */
  function setFullscreen(value) {
    if (!bridge || !bridge.setFullscreen) return;
    bridge.setFullscreen(value).then(function (result) {
      state.fullscreen = !!(result && result.fullscreen);
      if (els.fullscreen) {
        els.fullscreen.setAttribute("aria-pressed", state.fullscreen ? "true" : "false");
        var label = state.fullscreen ? "Quitter le plein écran (F11)" : "Plein écran (F11)";
        els.fullscreen.title = label;
        els.fullscreen.setAttribute("aria-label", label);
      }
      announce(state.fullscreen ? "Plein écran" : "Fenêtre");
    });
  }

  function onKeyDown(event) {
    var key = event.key;
    var ctrl = event.ctrlKey || event.metaKey;
    var inField =
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement;

    if (key === "Escape") {
      // Le plein écran se quitte avant tout le reste : c'est le geste attendu
      // par un utilisateur qui s'est retrouvé sans barre de titre.
      if (state.fullscreen) {
        setFullscreen(false);
        event.preventDefault();
        return;
      }
      if (!els.dialog.hidden) {
        closeDialog();
        event.preventDefault();
        return;
      }
      if (!els.palette.hidden) {
        closePalette();
        event.preventDefault();
        return;
      }
      if (state.query) {
        els.search.value = "";
        state.query = "";
        els.searchWrap.setAttribute("data-filled", "false");
        renderContent();
        els.search.blur();
      }
      return;
    }

    if (!els.palette.hidden) {
      if (key === "ArrowDown") {
        paletteMove(1);
        event.preventDefault();
      } else if (key === "ArrowUp") {
        paletteMove(-1);
        event.preventDefault();
      } else if (key === "Enter") {
        paletteRun(ctrl);
        event.preventDefault();
      } else if (key === "Home") {
        paletteState.active = 0;
        renderPalette();
        event.preventDefault();
      } else if (key === "End") {
        paletteState.active = Math.max(0, paletteState.items.length - 1);
        renderPalette();
        event.preventDefault();
      }
      return;
    }

    if (ctrl && (key === "k" || key === "K")) {
      openPalette();
      event.preventDefault();
      return;
    }
    if (ctrl && key === ",") {
      openSettings();
      event.preventDefault();
      return;
    }
    if (key === "F1") {
      openHelp();
      event.preventDefault();
      return;
    }
    if (key === "F11") {
      setFullscreen();
      event.preventDefault();
      return;
    }
    if (key === "/" && !inField) {
      els.search.focus();
      els.search.select();
      event.preventDefault();
      return;
    }
    if (event.altKey && key === "ArrowLeft") {
      goBack();
      event.preventDefault();
      return;
    }
    if (event.altKey && /^[1-9]$/.test(key) && !inField) {
      var keys = RAIL_PRIMARY.map(function (item) {
        return item.route;
      }).concat(state.categories.map(function (name) {
        return "cat:" + name;
      }));
      var picked = keys[Number(key) - 1];
      if (picked) {
        navigate(routeFromKey(picked));
        event.preventDefault();
      }
    }
  }

  /* ── Démarrage ─────────────────────────────────────────────────────────── */

  function fatal(message) {
    els.content.innerHTML =
      '<div class="content-inner"><div class="empty">' +
      '<span class="empty-ico">' + svg("alert", 34) + "</span>" +
      '<div class="empty-title">StrasEdu n\'a pas pu démarrer</div>' +
      '<p class="empty-text">' + esc(message) + "</p></div></div>";
  }

  function start() {
    if (!bridge) {
      fatal(
        "L'interface a été ouverte hors de l'application. Lancez « StrasEdu » " +
          "depuis le menu Démarrer pour accéder au catalogue."
      );
      return;
    }

    bridge.getSnapshot().then(function (snapshot) {
      absorb(snapshot);
      state.ready = true;
      applyAllPreferences();
      wireEvents();
      render();
      renderStatus();

      if (!state.apps.length) {
        toast(
          "Catalogue vide",
          "Aucun outil n'est référencé. Contactez l'administrateur de StrasEdu.",
          "warn"
        );
      }
    }).catch(function (error) {
      fatal(String(error && error.message ? error.message : error));
    });

    if (bridge.onEvent) {
      bridge.onEvent(function (event) {
        if (!event) return;
        if (event.type === "catalog-updated") {
          state.sync = { state: "warn", text: "Catalogue mis à jour (v" + event.version + ")." };
          renderStatus();
          toast(
            "Catalogue mis à jour",
            "Version " + event.version + " reçue de l'établissement.",
            null,
            "Recharger",
            reloadCatalog
          );
        } else if (event.type === "system-theme") {
          state.capabilities.dark = !!event.dark;
          applyAllPreferences();
        } else if (event.type === "sync-state") {
          state.sync = { state: event.state, text: event.text };
          renderStatus();
        }
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();

/* ==========================================================================
   StrasEdu — logique de l'application d'administration
   --------------------------------------------------------------------------
   Le catalogue est tenu en mémoire et modifié directement : chaque champ écrit
   dans l'objet, et seules les listes sont redessinées. Les champs de saisie ne
   sont jamais reconstruits pendant la frappe, ce qui préserve le curseur.
   ========================================================================== */

(function () {
  "use strict";

  var PO = window.PO || {};
  var svg = PO.svg;
  var bridge = window.admin;

  var state = {
    catalog: null,
    filePath: null,
    sharePath: "",
    dark: false,
    tab: "apps",
    appId: null,
    catName: null,
    newsIndex: null,
    highIndex: null,
    highFilter: "",
    idTouched: false,
    filter: "",
    validation: { ok: true, problems: [], badIds: [], warnings: [] }
  };

  // Plafonds du catalogue, recopiés de lib/catalog.js : le rendu n'a pas accès
  // au module Node, et l'outil doit désactiver la commande plutôt que laisser
  // saisir ce qui serait écarté en silence à la validation.
  var MAX_SCREENSHOTS = 4;
  var MAX_NEWS_ITEMS = 12;
  var MAX_HIGHLIGHTS = 3;
  var MAX_HIGHLIGHT_APPS = 12;

  // Libellé que la validation applique quand celui du groupe est vide.
  var DEFAULT_HIGHLIGHT_LABEL = "À la une";

  // Hauteur de réduction demandée au sélecteur d'image, selon l'usage : une
  // vignette d'outil se voit en grand, un bandeau d'information reste modeste.
  var APP_IMAGE_HEIGHT = 320;
  // Le bandeau du carrousel s'affiche sur 230 px de haut : l'enregistrer sur
  // 200 le ferait agrandir, donc paraître légèrement flou.
  var NEWS_IMAGE_HEIGHT = 240;

  var els = {};

  /* ═══ Utilitaires ═══════════════════════════════════════════════════════ */

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function $(id) {
    return document.getElementById(id);
  }

  /** Identifiant stable dérivé du nom : « Pix Junior » → « pix-junior ». */
  function slug(text) {
    return String(text || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "outil";
  }

  function uniqueId(base) {
    var taken = {};
    (state.catalog.apps || []).forEach(function (app) {
      taken[app.id] = true;
    });
    if (!taken[base]) return base;
    var n = 2;
    while (taken[base + "-" + n]) n += 1;
    return base + "-" + n;
  }

  function toast(title, text, tone) {
    var host = $("toasts");
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
    host.appendChild(node);
    setTimeout(function () {
      node.remove();
    }, tone === "warn" ? 9000 : 5000);
  }

  function apps() {
    return state.catalog.apps || (state.catalog.apps = []);
  }

  function meta() {
    return state.catalog.categoryMeta || (state.catalog.categoryMeta = {});
  }

  function categories() {
    return state.catalog.categories || (state.catalog.categories = []);
  }

  function findApp(id) {
    var list = apps();
    for (var i = 0; i < list.length; i += 1) if (list[i].id === id) return list[i];
    return null;
  }

  function colorOf(name) {
    var m = meta()[name] || {};
    return m.color || "#0f9d63";
  }

  /* ═══ Sélecteur d'icône ═════════════════════════════════════════════════ */

  var ICON_NAMES = Object.keys(PO.icons || {}).sort();

  /**
   * Construit la grille d'icônes. `allowNone` ajoute une entrée « aucune »
   * pour les outils, qui retombent alors sur leur pastille à deux lettres.
   */
  function buildIconPicker(container, current, allowNone, onPick) {
    var html = "";
    if (allowNone) {
      html +=
        '<button type="button" class="icon-choice icon-choice-none" data-icon="" ' +
        'role="radio" aria-checked="' + (!current ? "true" : "false") +
        '" title="Aucune icône (pastille à deux lettres)">—</button>';
    }
    ICON_NAMES.forEach(function (name) {
      html +=
        '<button type="button" class="icon-choice" data-icon="' + esc(name) + '" ' +
        'role="radio" aria-checked="' + (current === name ? "true" : "false") + '" ' +
        'title="' + esc(name) + '">' + svg(name, 20) + "</button>";
    });
    container.innerHTML = html;

    container.onclick = function (event) {
      var button = event.target.closest("[data-icon]");
      if (!button) return;
      Array.prototype.forEach.call(container.querySelectorAll("[data-icon]"), function (node) {
        node.setAttribute("aria-checked", node === button ? "true" : "false");
      });
      onPick(button.getAttribute("data-icon"));
    };
  }

  /* ═══ Onglets ═══════════════════════════════════════════════════════════ */

  function setTab(name) {
    state.tab = name;
    Array.prototype.forEach.call(document.querySelectorAll("[data-tab]"), function (button) {
      button.setAttribute("aria-pressed", button.getAttribute("data-tab") === name ? "true" : "false");
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-panel]"), function (panel) {
      panel.hidden = panel.getAttribute("data-panel") !== name;
    });
  }

  /* ═══ Liste des outils ══════════════════════════════════════════════════ */

  function renderApps() {
    var needle = state.filter.trim().toLowerCase();
    var bad = {};
    state.validation.badIds.forEach(function (id) {
      bad[id] = true;
    });

    var html = "";
    apps().forEach(function (app) {
      var haystack = (app.name + " " + app.category + " " + (app.url || app.path || "")).toLowerCase();
      if (needle && haystack.indexOf(needle) < 0) return;

      // La vignette choisie remplace la pastille : c'est elle que les
      // enseignants reconnaissent dans l'application.
      var mark = app.image
        ? '<img alt="" src="' + esc(app.image) + '">'
        : app.icon
          ? svg(app.icon, 17)
          : esc(app.mark || String(app.name || "").slice(0, 2));

      html +=
        '<li><button type="button" class="admin-item" data-app="' + esc(app.id) + '" ' +
        'aria-selected="' + (app.id === state.appId ? "true" : "false") + '">' +
        '<span class="admin-item-mark">' + mark + "</span>" +
        '<span class="admin-item-body">' +
        '<span class="admin-item-name">' + esc(app.name) + "</span>" +
        '<span class="admin-item-sub">' + esc(app.category) +
        (app.type === "local" ? " · logiciel installé" : "") + "</span>" +
        "</span>" +
        (bad[app.id] ? '<span class="admin-item-flag">à vérifier</span>' : "") +
        "</button></li>";
    });

    if (!html) html = '<li class="admin-hint admin-hint-item">Aucun outil.</li>';
    els.appList.innerHTML = html;
  }

  /* ═══ Formulaire d'un outil ═════════════════════════════════════════════ */

  function renderCategoryOptions(selected) {
    var html = "";
    categories().forEach(function (name) {
      html +=
        '<option value="' + esc(name) + '"' + (name === selected ? " selected" : "") + ">" +
        esc(name) + "</option>";
    });
    els.fCategory.innerHTML = html;
  }

  /** Captures d'écran de l'outil, sans matérialiser un tableau vide. */
  function appShots(app) {
    return Array.isArray(app.screenshots) ? app.screenshots : [];
  }

  /**
   * Affiche les visuels de l'outil sélectionné. La vignette et les captures
   * sont posées par la couche native (data URI), donc affichables directement.
   */
  function renderAppVisuals(app) {
    els.appImagePreview.innerHTML = app.image
      ? '<img alt="Vignette de l\'outil" src="' + esc(app.image) + '">'
      : "aucune";

    var shots = appShots(app);
    var html = "";
    shots.forEach(function (shot, index) {
      html +=
        '<li class="shot-item">' +
        '<span class="shot-thumb"><img alt="Capture d\'écran ' + (index + 1) +
        '" src="' + esc(shot) + '"></span>' +
        '<button class="btn btn-sm" type="button" data-act="shot-remove" data-shot="' + index +
        '" aria-label="Retirer la capture d\'écran ' + (index + 1) + '">Retirer</button>' +
        "</li>";
    });
    if (!html) html = '<li class="admin-hint">Aucune capture d\'écran.</li>';
    els.appShots.innerHTML = html;

    els.appShotAdd.disabled = shots.length >= MAX_SCREENSHOTS;
    els.appShotAdd.setAttribute("aria-disabled", shots.length >= MAX_SCREENSHOTS ? "true" : "false");
  }

  function loadAppForm() {
    var app = state.appId ? findApp(state.appId) : null;

    els.appEmpty.hidden = !!app;
    els.appFields.hidden = !app;
    if (!app) return;

    els.fName.value = app.name || "";
    els.fId.value = app.id || "";
    renderCategoryOptions(app.category);
    setType(app.type === "local" ? "local" : "web");
    els.fUrl.value = app.url || "";
    els.fPath.value = app.path || "";
    els.fDescription.value = app.description || "";
    els.fMark.value = app.mark || "";
    els.fBadge.value = Number(app.badge) || 0;
    els.fMeta.value = app.meta || "";
    els.fKeywords.value = (app.keywords || []).join(", ");

    buildIconPicker(els.appIconPicker, app.icon || "", true, function (name) {
      if (name) app.icon = name;
      else delete app.icon;
      renderApps();
      scheduleValidate();
    });

    renderAppVisuals(app);
  }

  function setType(type) {
    Array.prototype.forEach.call(els.fType.querySelectorAll("button"), function (button) {
      button.setAttribute("aria-pressed", button.getAttribute("data-type") === type ? "true" : "false");
    });
    $("row-url").hidden = type !== "web";
    $("row-path").hidden = type !== "local";
  }

  function currentType() {
    var active = els.fType.querySelector('[aria-pressed="true"]');
    return active ? active.getAttribute("data-type") : "web";
  }

  function addApp() {
    var base = "nouvel-outil";
    // Aucun visuel par défaut : tant qu'aucune vignette n'est choisie, l'outil
    // garde sa pastille à deux lettres. Les images ne sont embarquées dans le
    // catalogue que si l'administrateur en désigne une.
    var app = {
      id: uniqueId(base),
      name: "Nouvel outil",
      category: categories()[0] || "Autres",
      description: "",
      mark: "No",
      badge: 0,
      keywords: [],
      type: "web",
      url: "https://"
    };
    apps().push(app);
    state.appId = app.id;
    state.idTouched = false;
    renderApps();
    loadAppForm();
    els.fName.focus();
    els.fName.select();
    scheduleValidate();
  }

  function deleteApp() {
    var app = findApp(state.appId);
    if (!app) return;
    if (!window.confirm("Supprimer « " + app.name + " » du catalogue ?")) return;
    var list = apps();
    list.splice(list.indexOf(app), 1);
    state.appId = list.length ? list[0].id : null;
    renderApps();
    loadAppForm();
    scheduleValidate();
    toast("Outil supprimé", app.name);
  }

  /* ═══ Visuels d'un outil ════════════════════════════════════════════════ */

  /**
   * Demande une image à la couche native. Elle seule ouvre un dialogue et
   * réduit l'image ; le rendu se contente de ranger le data URI reçu, que la
   * validation du catalogue a déjà accepté.
   */
  function pickImage(options, apply) {
    bridge.pickImage(options).then(function (result) {
      if (!result || result.canceled) return;
      if (!result.ok) {
        toast("Image refusée", result.error, "warn");
        return;
      }
      apply(result.image, result.source);
    });
  }

  function pickAppImage() {
    var app = findApp(state.appId);
    if (!app) return;
    pickImage({ height: APP_IMAGE_HEIGHT, title: "Choisir la vignette de l'outil" },
      function (image, source) {
        // L'outil peut avoir changé pendant le dialogue : on relit la sélection.
        var target = findApp(state.appId);
        if (!target) return;
        target.image = image;
        renderAppVisuals(target);
        renderApps();
        scheduleValidate();
        toast("Vignette définie", source);
      });
  }

  function clearAppImage() {
    var app = findApp(state.appId);
    if (!app || !app.image) return;
    delete app.image;
    renderAppVisuals(app);
    renderApps();
    scheduleValidate();
  }

  function addScreenshot() {
    var app = findApp(state.appId);
    if (!app || appShots(app).length >= MAX_SCREENSHOTS) return;
    pickImage({ height: APP_IMAGE_HEIGHT, title: "Choisir une capture d'écran" },
      function (image, source) {
        var target = findApp(state.appId);
        if (!target || appShots(target).length >= MAX_SCREENSHOTS) return;
        target.screenshots = appShots(target).concat([image]);
        renderAppVisuals(target);
        renderApps();
        scheduleValidate();
        toast("Capture ajoutée", source);
      });
  }

  function removeScreenshot(index) {
    var app = findApp(state.appId);
    if (!app) return;
    var next = appShots(app).filter(function (shot, position) {
      return position !== index;
    });
    if (next.length) app.screenshots = next;
    else delete app.screenshots;
    renderAppVisuals(app);
    renderApps();
    scheduleValidate();
  }

  /* ═══ Département : informations du carrousel ═══════════════════════════ */

  /**
   * Le carrousel n'est écrit dans le catalogue qu'à partir de la première
   * information : un objet vide ne serait pas conservé par la validation, il
   * n'a donc rien à faire dans le fichier.
   */
  function news() {
    if (!state.catalog.news || typeof state.catalog.news !== "object" ||
        Array.isArray(state.catalog.news)) {
      state.catalog.news = { items: [] };
    }
    if (!Array.isArray(state.catalog.news.items)) state.catalog.news.items = [];
    return state.catalog.news;
  }

  function newsItems() {
    var node = state.catalog.news;
    return node && Array.isArray(node.items) ? node.items : [];
  }

  function currentNews() {
    var index = state.newsIndex;
    return index == null ? null : newsItems()[index] || null;
  }

  /** Retire l'en-tête vide laissé derrière la dernière suppression. */
  function pruneNews() {
    var node = state.catalog.news;
    if (!node) return;
    if (newsItems().length) return;
    if (String(node.title || "").trim() || String(node.subtitle || "").trim()) return;
    delete state.catalog.news;
  }

  function uniqueNewsId() {
    var taken = {};
    newsItems().forEach(function (item) {
      taken[item.id] = true;
    });
    var n = newsItems().length + 1;
    while (taken["info-" + n]) n += 1;
    return "info-" + n;
  }

  /** Un lien n'est publié qu'en http(s) : la validation écarte le reste. */
  function isHttpUrl(value) {
    try {
      var parsed = new URL(String(value).trim());
      return parsed.protocol === "https:" || parsed.protocol === "http:";
    } catch (error) {
      return false;
    }
  }

  function renderNews() {
    var items = newsItems();
    if (state.newsIndex != null && state.newsIndex >= items.length) {
      state.newsIndex = items.length ? items.length - 1 : null;
    }

    var html = "";
    items.forEach(function (item, index) {
      var thumb = item.image
        ? '<span class="news-thumb"><img alt="" src="' + esc(item.image) + '"></span>'
        : '<span class="news-thumb">' + svg("bullhorn", 16) + "</span>";
      html +=
        '<li class="news-item" data-news-index="' + index + '">' +
        '<button type="button" class="news-main" data-act="news-select" ' +
        'aria-selected="' + (index === state.newsIndex ? "true" : "false") + '">' +
        thumb +
        '<span class="news-item-body">' +
        '<span class="news-item-title">' +
        esc(item.title || item.text || "(sans titre)") + "</span>" +
        '<span class="news-item-text">' + esc(item.text || item.url || "") + "</span>" +
        "</span></button>" +
        '<span class="news-tools">' +
        '<button type="button" class="iconbtn" data-act="news-up" ' +
        'aria-label="Monter l\'information ' + (index + 1) + '"' +
        (index === 0 ? " disabled" : "") + ">" + svg("chevronRight", 16, "rot-up") + "</button>" +
        '<button type="button" class="iconbtn" data-act="news-down" ' +
        'aria-label="Descendre l\'information ' + (index + 1) + '"' +
        (index === items.length - 1 ? " disabled" : "") + ">" +
        svg("chevronRight", 16, "rot-down") + "</button>" +
        '<button type="button" class="iconbtn" data-act="news-delete" ' +
        'aria-label="Supprimer l\'information ' + (index + 1) + '">' + svg("x", 15) + "</button>" +
        "</span></li>";
    });

    if (!html) html = '<li class="admin-hint admin-hint-item">Aucune information.</li>';
    els.newsList.innerHTML = html;

    els.newsCount.textContent = items.length
      ? items.length + " / " + MAX_NEWS_ITEMS + " informations"
      : "Aucune information.";
    els.newsAdd.disabled = items.length >= MAX_NEWS_ITEMS;
    els.newsAdd.setAttribute("aria-disabled", items.length >= MAX_NEWS_ITEMS ? "true" : "false");
  }

  function loadNewsForm() {
    var item = currentNews();
    els.newsForm.hidden = !item;
    els.newsHint.hidden = !!item;
    if (!item) return;

    els.nTitle.value = item.title || "";
    els.nText.value = item.text || "";
    els.dDate.value = item.date || "";
    els.nUrl.value = item.url || "";
    // Le libellé par défaut est déjà celui de l'application : on laisse le
    // champ vide, son texte indicatif l'annonce.
    els.nLinkLabel.value = item.linkLabel === "En savoir plus" ? "" : item.linkLabel || "";
    els.nImagePreview.innerHTML = item.image
      ? '<img alt="Bandeau de l\'information" src="' + esc(item.image) + '">'
      : "aucun";

    renderNewsCounts();
    renderUrlState();
  }

  function renderNewsCounts() {
    els.nTitleCount.textContent = els.nTitle.value.length + " / 120";
    els.nTextCount.textContent = els.nText.value.length + " / 600";
    els.dDateCount.textContent = els.dDate.value.length + " / 32";
    els.nLinkCount.textContent = els.nLinkLabel.value.length + " / 60";
  }

  /**
   * Signale une adresse non http(s) : elle serait écartée en silence à la
   * publication, donc on refuse la saisie et on l'explique. Le libellé du lien
   * n'a de sens qu'avec un lien : il reste désactivé tant qu'il n'y en a pas.
   */
  function renderUrlState() {
    var item = currentNews();
    var raw = els.nUrl.value.trim();
    var bad = !!raw && !isHttpUrl(raw);
    els.nUrl.setAttribute("aria-invalid", bad ? "true" : "false");
    els.nUrlNote.textContent = bad
      ? "Adresse refusée : seuls http et https sont publiés."
      : "";

    var linked = !!(item && item.url);
    els.nLinkLabel.disabled = !linked;
    els.nLinkLabel.setAttribute("aria-disabled", linked ? "false" : "true");
    els.nLinkNote.textContent = linked ? "" : "Le libellé n'est publié qu'avec un lien.";
  }

  function selectNews(index) {
    state.newsIndex = index;
    renderNews();
    loadNewsForm();
  }

  function addNews() {
    var node = news();
    if (node.items.length >= MAX_NEWS_ITEMS) return;
    node.items.push({ id: uniqueNewsId(), title: "", text: "" });
    state.newsIndex = node.items.length - 1;
    renderNews();
    loadNewsForm();
    els.nTitle.focus();
    els.nTitle.select();
    scheduleValidate();
  }

  /**
   * Supprime l'information demandée. Le bouton d'une ligne vise sa propre
   * ligne (index donné) ; celui du formulaire vise la sélection.
   */
  function deleteNews(index) {
    var items = newsItems();
    var at = index >= 0 ? index : state.newsIndex;
    var item = items[at];
    if (!item) return;
    if (!window.confirm("Supprimer cette information du carrousel ?")) return;
    items.splice(at, 1);
    // La sélection glisse sur l'information suivante, comme dans la liste.
    state.newsIndex = items.length ? Math.min(at, items.length - 1) : null;
    pruneNews();
    renderNews();
    loadNewsForm();
    scheduleValidate();
  }

  /** Réordonner change l'ordre du carrousel : on garde la même information
   *  sélectionnée, l'index suit le déplacement. */
  function moveNews(index, delta) {
    var items = newsItems();
    var target = index + delta;
    if (index < 0 || index >= items.length || target < 0 || target >= items.length) return;
    var moved = items.splice(index, 1)[0];
    items.splice(target, 0, moved);
    state.newsIndex = target;
    // Le formulaire porte sur la même information : le recharger ferait
    // perdre la position du curseur pour rien.
    renderNews();
    scheduleValidate();
  }

  function pickNewsImage() {
    var item = currentNews();
    if (!item) return;
    pickImage({ height: NEWS_IMAGE_HEIGHT, title: "Choisir le bandeau de l'information" },
      function (image, source) {
        var target = currentNews();
        if (!target) return;
        target.image = image;
        els.nImagePreview.innerHTML =
          '<img alt="Bandeau de l\'information" src="' + esc(image) + '">';
        renderNews();
        scheduleValidate();
        toast("Bandeau défini", source);
      });
  }

  function clearNewsImage() {
    var item = currentNews();
    if (!item || !item.image) return;
    delete item.image;
    els.nImagePreview.innerHTML = "aucun";
    renderNews();
    scheduleValidate();
  }

  /* ═══ Mise en avant ═════════════════════════════════════════════════════ */

  /**
   * Groupes tels que le catalogue les porte. Lecture seule : un catalogue qui
   * n'en a pas ne doit pas en gagner par simple enregistrement.
   */
  function highlightGroups() {
    return Array.isArray(state.catalog.highlights) ? state.catalog.highlights : [];
  }

  /** Index des outils par identifiant : sert à n'accepter que l'existant. */
  function appIndex() {
    var map = {};
    apps().forEach(function (app) {
      map[app.id] = app;
    });
    return map;
  }

  /**
   * Identifiants retenus d'un groupe, dans l'ordre, limités aux outils qui
   * existent encore, sans doublon et sous le plafond. L'interface ne montre
   * jamais autre chose : un identifiant inconnu ne peut pas être coché.
   */
  function pickedIds(group) {
    if (!group || !Array.isArray(group.appIds)) return [];
    var known = appIndex();
    var ids = [];
    group.appIds.forEach(function (id) {
      if (typeof id !== "string" || !known[id]) return;
      if (ids.indexOf(id) >= 0) return;
      if (ids.length >= MAX_HIGHLIGHT_APPS) return;
      ids.push(id);
    });
    return ids;
  }

  function currentHigh() {
    var index = state.highIndex;
    return index == null ? null : highlightGroups()[index] || null;
  }

  /** Crée la liste au premier ajout seulement. */
  function newHighlights() {
    if (!Array.isArray(state.catalog.highlights)) state.catalog.highlights = [];
    return state.catalog.highlights;
  }

  /** Un tableau vide n'apprend rien au poste : on l'oublie. */
  function pruneHighlights() {
    if (Array.isArray(state.catalog.highlights) && !state.catalog.highlights.length) {
      delete state.catalog.highlights;
    }
  }

  function renderHighlights() {
    var list = highlightGroups();
    if (state.highIndex != null && state.highIndex >= list.length) {
      state.highIndex = list.length ? list.length - 1 : null;
    }

    var html = "";
    list.forEach(function (group, index) {
      var ids = pickedIds(group);
      html +=
        '<li class="admin-item-row" data-high-index="' + index + '">' +
        '<button type="button" class="admin-item" data-high="' + index + '" ' +
        'aria-selected="' + (index === state.highIndex ? "true" : "false") + '">' +
        '<span class="admin-item-mark">' + svg("star", 17) + "</span>" +
        '<span class="admin-item-body">' +
        '<span class="admin-item-name">' +
        esc(group.label || DEFAULT_HIGHLIGHT_LABEL) + "</span>" +
        '<span class="admin-item-sub">' + ids.length +
        (ids.length > 1 ? " outils" : " outil") + "</span>" +
        "</span>" +
        (ids.length ? "" : '<span class="admin-item-warn">sans outil</span>') +
        "</button>" +
        '<span class="admin-item-tools">' +
        '<button type="button" class="iconbtn" data-act="high-up" ' +
        'aria-label="Monter la mise en avant ' + (index + 1) + '"' +
        (index === 0 ? " disabled" : "") + ">" +
        svg("chevronRight", 16, "rot-up") + "</button>" +
        '<button type="button" class="iconbtn" data-act="high-down" ' +
        'aria-label="Descendre la mise en avant ' + (index + 1) + '"' +
        (index === list.length - 1 ? " disabled" : "") + ">" +
        svg("chevronRight", 16, "rot-down") + "</button>" +
        '<button type="button" class="iconbtn" data-act="high-delete" ' +
        'aria-label="Supprimer la mise en avant ' + (index + 1) + '">' +
        svg("x", 15) + "</button>" +
        "</span></li>";
    });

    if (!html) html = '<li class="admin-hint admin-hint-item">Aucune mise en avant.</li>';
    els.highList.innerHTML = html;

    els.highAdd.disabled = list.length >= MAX_HIGHLIGHTS;
    els.highAdd.setAttribute("aria-disabled", list.length >= MAX_HIGHLIGHTS ? "true" : "false");
  }

  function loadHighForm() {
    var group = currentHigh();
    els.highEmpty.hidden = !!group;
    els.highFields.hidden = !group;
    if (!group) return;

    els.hLabel.value = group.label || "";
    els.hFilter.value = state.highFilter;
    renderHighCounts();
    renderHighChoices();
  }

  function renderHighCounts() {
    els.hLabelCount.textContent = els.hLabel.value.length + " / 60";
  }

  /**
   * Liste de tous les outils, avec une case à cocher. Les outils retenus
   * portent leur numéro d'ordre — c'est l'ordre du tableau, donc l'ordre
   * d'affichage sur l'accueil — et un bouton pour les retirer.
   */
  function renderHighChoices() {
    var picked = pickedIds(currentHigh());
    var full = picked.length >= MAX_HIGHLIGHT_APPS;
    var needle = state.highFilter.trim().toLowerCase();
    var html = "";
    var shown = 0;

    apps().forEach(function (app) {
      var haystack = (app.name + " " + app.id + " " + app.category).toLowerCase();
      if (needle && haystack.indexOf(needle) < 0) return;
      shown += 1;

      var position = picked.indexOf(app.id);
      var checked = position >= 0;
      html +=
        '<li class="pick-item">' +
        '<label class="pick-check">' +
        '<input type="checkbox" data-pick="' + esc(app.id) + '"' +
        (checked ? " checked" : "") +
        // Au plafond, seules les cases déjà cochées restent actives : décocher
        // doit toujours être possible.
        (!checked && full ? " disabled" : "") +
        ' aria-label="' + esc(app.name) + '">' +
        '<span class="pick-name">' + esc(app.name) + "</span>" +
        '<span class="pick-cat">' + esc(app.category) + "</span>" +
        "</label>" +
        (checked
          ? '<span class="pick-order" title="Position ' + (position + 1) + '">' +
            (position + 1) + "</span>" +
            '<button type="button" class="iconbtn" data-act="high-drop" data-high-app="' +
            esc(app.id) + '" aria-label="Retirer ' + esc(app.name) + '">' +
            svg("x", 14) + "</button>"
          : "") +
        "</li>";
    });

    if (!shown) {
      html = '<li class="admin-hint admin-hint-item">Aucun outil ne correspond au filtre.</li>';
    }
    els.highChoices.innerHTML = html;

    els.hNote.textContent = picked.length + " / " + MAX_HIGHLIGHT_APPS +
      (picked.length > 1 ? " outils retenus" : " outil retenu") +
      (full ? " — plafond atteint, décochez pour en choisir un autre." : ".");
  }

  function selectHighlight(index) {
    state.highIndex = index;
    renderHighlights();
    loadHighForm();
  }

  function addHighlight() {
    if (highlightGroups().length >= MAX_HIGHLIGHTS) return;
    var list = newHighlights();
    list.push({ label: DEFAULT_HIGHLIGHT_LABEL, appIds: [] });
    state.highIndex = list.length - 1;
    renderHighlights();
    loadHighForm();
    els.hLabel.focus();
    els.hLabel.select();
    scheduleValidate();
  }

  /** Le bouton d'une ligne vise sa propre ligne ; sans index, la sélection. */
  function deleteHighlight(index) {
    var list = highlightGroups();
    var at = index >= 0 ? index : state.highIndex;
    var group = list[at];
    if (!group) return;
    if (!window.confirm("Supprimer la mise en avant « " +
        (group.label || DEFAULT_HIGHLIGHT_LABEL) + " » ?")) return;

    list.splice(at, 1);
    state.highIndex = list.length ? Math.min(at, list.length - 1) : null;
    pruneHighlights();
    renderHighlights();
    loadHighForm();
    scheduleValidate();
  }

  /** L'ordre des groupes est celui des cartes sur l'accueil. */
  function moveHighlight(index, delta) {
    var list = highlightGroups();
    var target = index + delta;
    if (index < 0 || index >= list.length || target < 0 || target >= list.length) return;
    var moved = list.splice(index, 1)[0];
    list.splice(target, 0, moved);
    state.highIndex = target;
    renderHighlights();
    scheduleValidate();
  }

  function toggleHighlightApp(id, checked) {
    var group = currentHigh();
    if (!group) return;
    // Repartir des identifiants connus retire au passage ceux qui ne le sont
    // plus : le catalogue ne peut pas conserver un outil supprimé.
    var ids = pickedIds(group);
    var position = ids.indexOf(id);
    if (checked) {
      if (position < 0 && ids.length < MAX_HIGHLIGHT_APPS) ids.push(id);
    } else if (position >= 0) {
      ids.splice(position, 1);
    }
    group.appIds = ids;
    renderHighChoices();
    renderHighlights();
    focusPick(id);
    scheduleValidate();
  }

  function dropHighlightApp(id) {
    toggleHighlightApp(id, false);
  }

  /**
   * Le rendu reconstruit les cases à cocher : on rend le focus à celle qui
   * vient d'être manipulée, pour que la sélection au clavier reste utilisable.
   */
  function focusPick(id) {
    var boxes = els.highChoices.querySelectorAll("input[data-pick]");
    for (var i = 0; i < boxes.length; i += 1) {
      if (boxes[i].getAttribute("data-pick") === id) {
        boxes[i].focus();
        return;
      }
    }
  }

  /**
   * Une mise en avant que les postes écarteraient n'a rien à faire dans le
   * catalogue : identifiants inconnus ou en double retirés, plafonds tenus,
   * groupe vide supprimé, libellé vide ramené à celui de l'application.
   * Rend le nombre de corrections, pour pouvoir le dire à l'administrateur.
   */
  function sanitizeHighlights() {
    var list = state.catalog.highlights;
    if (!Array.isArray(list)) return 0;

    var known = appIndex();
    var cleaned = [];
    var fixed = 0;

    list.forEach(function (group) {
      if (cleaned.length >= MAX_HIGHLIGHTS) {
        fixed += 1;
        return;
      }
      if (!group || typeof group !== "object") {
        fixed += 1;
        return;
      }

      var ids = [];
      (Array.isArray(group.appIds) ? group.appIds : []).forEach(function (id) {
        if (typeof id !== "string" || !known[id] || ids.indexOf(id) >= 0 ||
            ids.length >= MAX_HIGHLIGHT_APPS) {
          fixed += 1;
          return;
        }
        ids.push(id);
      });
      if (!ids.length) {
        fixed += 1;
        return;
      }

      var label = String(group.label == null ? "" : group.label).trim().slice(0, 60) ||
        DEFAULT_HIGHLIGHT_LABEL;
      if (label !== group.label) fixed += 1;
      cleaned.push({ label: label, appIds: ids });
    });

    if (!fixed) return 0;
    if (cleaned.length) state.catalog.highlights = cleaned;
    else delete state.catalog.highlights;
    return fixed;
  }

  /**
   * Appelé avant toute écriture : ce que l'outil enregistre doit être ce que
   * les postes accepteront, sans perte silencieuse à l'arrivée.
   */
  function sanitizeCatalog() {
    var fixed = sanitizeHighlights();
    if (fixed) {
      renderHighlights();
      loadHighForm();
      toast(
        "Mises en avant corrigées",
        fixed + " entrée(s) sans outil valide écartée(s) avant enregistrement.",
        "warn"
      );
    }
    return fixed;
  }

  /* ═══ Formulaire d'une catégorie ════════════════════════════════════════ */

  function renderCats() {
    var html = "";
    categories().forEach(function (name) {
      var m = meta()[name] || {};
      var count = apps().filter(function (a) {
        return a.category === name;
      }).length;
      html +=
        '<li><button type="button" class="admin-item" data-cat="' + esc(name) + '" ' +
        'aria-selected="' + (name === state.catName ? "true" : "false") + '">' +
        '<span class="admin-item-mark" data-cat-color="' + esc(colorOf(name)) + '">' +
        svg(m.icon || "layers", 17) + "</span>" +
        '<span class="admin-item-body">' +
        '<span class="admin-item-name">' + esc(name) + "</span>" +
        '<span class="admin-item-sub">' + count + (count > 1 ? " outils" : " outil") + "</span>" +
        "</span></button></li>";
    });
    if (!html) html = '<li class="admin-hint admin-hint-item">Aucune catégorie.</li>';
    els.catList.innerHTML = html;

    // La couleur est posée par CSSOM : une CSP stricte interdit l'attribut
    // style dans le balisage.
    Array.prototype.forEach.call(
      els.catList.querySelectorAll("[data-cat-color]"),
      function (node) {
        node.style.setProperty("color", node.getAttribute("data-cat-color"));
      }
    );
  }

  function loadCatForm() {
    var name = state.catName;
    els.catEmpty.hidden = !!name;
    els.catFields.hidden = !name;
    if (!name) return;

    var m = meta()[name] || {};
    els.cName.value = name;
    els.cDescription.value = m.description || "";
    var color = m.color || "#0f9d63";
    els.cColor.value = color;
    els.cColorText.value = color;
    renderCatPreview(name, m.icon || "layers", color);

    buildIconPicker(els.catIconPicker, m.icon || "layers", false, function (icon) {
      meta()[name] = Object.assign({}, meta()[name], { icon: icon });
      renderCatPreview(name, icon, els.cColor.value);
      renderCats();
      scheduleValidate();
    });
  }

  function renderCatPreview(name, icon, color) {
    els.cPreview.innerHTML =
      '<span class="sample">' + svg(icon, 18) +
      '<span class="dot"></span>' + esc(name) + "</span>";
    var sample = els.cPreview.querySelector(".sample");
    if (sample) {
      sample.style.setProperty("--cat-color", color);
      sample.style.setProperty("--cat-ink", color);
    }
  }

  function addCat() {
    var base = "Nouvelle catégorie";
    var name = base;
    var n = 2;
    while (categories().indexOf(name) >= 0) {
      name = base + " " + n;
      n += 1;
    }
    categories().push(name);
    meta()[name] = { icon: "layers", color: "#0f9d63", description: "" };
    state.catName = name;
    renderCats();
    renderCategoryOptions();
    loadCatForm();
    els.cName.focus();
    els.cName.select();
    scheduleValidate();
  }

  /** Renommer une catégorie propage le changement partout, sans casser les liens. */
  function renameCategory(oldName, rawNew) {
    var newName = String(rawNew || "").trim().slice(0, 60);
    if (!newName || newName === oldName) {
      els.cName.value = oldName;
      return;
    }
    if (categories().indexOf(newName) >= 0) {
      toast("Nom déjà utilisé", "Une autre catégorie porte ce nom.", "warn");
      els.cName.value = oldName;
      return;
    }

    var list = categories();
    list[list.indexOf(oldName)] = newName;

    var m = meta();
    if (m[oldName]) {
      m[newName] = m[oldName];
      delete m[oldName];
    }

    apps().forEach(function (app) {
      if (app.category === oldName) app.category = newName;
    });

    state.catName = newName;
    renderCats();
    renderCategoryOptions(findApp(state.appId) ? findApp(state.appId).category : undefined);
    loadCatForm();
    scheduleValidate();
  }

  function deleteCat() {
    var name = state.catName;
    if (!name) return;

    var used = apps().filter(function (a) {
      return a.category === name;
    });
    if (used.length) {
      toast(
        "Catégorie utilisée",
        used.length + " outil(s) y sont rangés. Déplacez-les d'abord.",
        "warn"
      );
      return;
    }
    if (categories().length <= 1) {
      toast("Dernière catégorie", "Le catalogue doit en conserver au moins une.", "warn");
      return;
    }
    if (!window.confirm("Supprimer la catégorie « " + name + " » ?")) return;

    var list = categories();
    list.splice(list.indexOf(name), 1);
    delete meta()[name];
    state.catName = list.length ? list[0] : null;
    renderCats();
    renderCategoryOptions();
    loadCatForm();
    scheduleValidate();
  }

  /* ═══ Application ═══════════════════════════════════════════════════════ */

  function renderApplication() {
    els.eVersion.value = state.catalog.version || "0.0.0";
    els.eShare.value = state.sharePath || "";
    renderLogo();
  }

  function renderDepartment() {
    var node = state.catalog.news || {};
    els.dTitle.value = node.title || "";
    els.dSubtitle.value = node.subtitle || "";
  }

  function renderLogo() {
    var logo = state.catalog.logo;
    els.logoPreview.innerHTML = logo
      ? '<img alt="Logo de StrasEdu" src="' + esc(logo) + '">'
      : "aucun";
    els.logoNote.textContent = logo
      ? "Le logo remplace la marque par défaut dans la barre latérale."
      : "Aucun logo : la marque par défaut est utilisée.";

    els.brandMark.classList.toggle("has-logo", !!logo);
    els.brandMark.innerHTML = logo
      ? '<img alt="" src="' + esc(logo) + '">'
      : svg("grid", 17);
  }

  /* ═══ Barre d'état et validation ════════════════════════════════════════ */

  function renderStatus() {
    els.stFile.textContent = state.filePath || "Catalogue non enregistré";
    els.stFile.title = state.filePath || "";
    var count = apps().length;
    els.stCount.textContent = count + (count > 1 ? " outils" : " outil") +
      " · " + categories().length + " catégories · v" + (state.catalog.version || "?");

    var v = state.validation;
    els.stState.setAttribute("data-state", v.ok ? "ok" : "warn");
    // Le détail au survol : « 2 avertissement(s) » n'apprend rien à lui seul.
    var details = (v.ok ? v.warnings : v.problems) || [];
    els.stState.title = details.join("\n");
    if (v.ok) {
      els.stState.textContent = v.warnings.length
        ? v.warnings.length + " avertissement(s)"
        : "Catalogue conforme";
    } else {
      els.stState.textContent = v.problems.length + " problème(s) à corriger";
    }
  }

  var validateTimer = null;

  function scheduleValidate() {
    if (validateTimer) clearTimeout(validateTimer);
    validateTimer = setTimeout(function () {
      bridge.validate(state.catalog).then(function (result) {
        state.validation = result || { ok: true, problems: [], badIds: [], warnings: [] };
        renderApps();
        renderStatus();
      });
    }, 350);
  }

  /* ═══ Actions de haut niveau ════════════════════════════════════════════ */

  function absorb(payload) {
    if (!payload || !payload.catalog) return;
    state.catalog = payload.catalog;
    if (!state.catalog.apps) state.catalog.apps = [];
    if (!state.catalog.categories) state.catalog.categories = [];
    if (!state.catalog.categoryMeta) state.catalog.categoryMeta = {};
    state.filePath = payload.filePath || null;

    state.appId = state.catalog.apps.length ? state.catalog.apps[0].id : null;
    state.catName = state.catalog.categories.length ? state.catalog.categories[0] : null;
    state.newsIndex = newsItems().length ? 0 : null;
    state.highIndex = highlightGroups().length ? 0 : null;
    state.highFilter = "";

    renderApps();
    loadAppForm();
    renderCats();
    loadCatForm();
    renderHighlights();
    loadHighForm();
    renderDepartment();
    renderNews();
    loadNewsForm();
    renderApplication();
    renderStatus();
    scheduleValidate();
  }

  function reportProblems(result, title) {
    var html = '<div class="publish-report"><span class="title">' + esc(title) + "</span><ul>";
    (result.problems || []).forEach(function (p) {
      html += "<li>" + esc(p) + "</li>";
    });
    html += "</ul></div>";
    toast(title, (result.problems || []).join(" "), "warn");
    return html;
  }

  function doSave() {
    if (!state.catalog) return;
    sanitizeCatalog();
    bridge.save(state.catalog, state.filePath).then(function (result) {
      if (result.ok) {
        state.filePath = result.filePath;
        renderStatus();
        toast("Catalogue enregistré", result.filePath);
      } else {
        toast("Enregistrement refusé", (result.problems || []).join(" "), "warn");
      }
    });
  }

  function doSaveAs() {
    if (!state.catalog) return;
    sanitizeCatalog();
    bridge.saveAs(state.catalog).then(function (result) {
      if (result.canceled) return;
      if (result.ok) {
        state.filePath = result.filePath;
        renderStatus();
        toast("Catalogue enregistré", result.filePath);
      } else {
        toast("Enregistrement refusé", (result.problems || []).join(" "), "warn");
      }
    });
  }

  function doPublish() {
    if (!state.catalog) return;
    if (!state.sharePath) {
      toast("Aucun partage configuré", "Onglet Application → choisir le dossier de publication.", "warn");
      setTab("application");
      return;
    }
    sanitizeCatalog();
    bridge.publish(state.catalog).then(function (result) {
      if (!result.ok) {
        toast("Publication refusée", (result.problems || []).join(" "), "warn");
        return;
      }
      state.catalog = result.catalog;
      renderApplication();
      renderStatus();
      toast(
        "Catalogue publié — v" + result.version,
        "Version " + result.previousVersion + " → " + result.version + " · " + result.path
      );
    });
  }

  function doOpen() {
    bridge.open().then(function (result) {
      if (result.canceled) return;
      if (!result.ok) {
        toast("Ouverture impossible", result.error, "warn");
        return;
      }
      absorb({ catalog: result.catalog, filePath: result.filePath });
      toast("Catalogue ouvert", result.filePath);
    });
  }

  /* ═══ Liaison des champs ════════════════════════════════════════════════ */

  /** Écrit dans l'outil sélectionné dès la frappe, sans redessiner le champ. */
  function bindAppField(element, apply, after) {
    element.addEventListener("input", function () {
      var app = findApp(state.appId);
      if (!app) return;
      apply(app, element.value);
      renderApps();
      renderStatus();
      scheduleValidate();
      if (after) after(app);
    });
  }

  /**
   * Même motif pour une information du carrousel : la liste est redessinée à
   * chaque frappe (son extrait en dépend), jamais le champ de saisie.
   */
  function bindNewsField(element, apply, after) {
    element.addEventListener("input", function () {
      var item = currentNews();
      if (!item) return;
      apply(item, element.value);
      renderNews();
      renderNewsCounts();
      scheduleValidate();
      if (after) after(item);
    });
  }

  /**
   * Même motif pour une mise en avant : le libellé apparaît dans la liste,
   * qui est redessinée à chaque frappe, mais le champ lui-même ne l'est pas.
   */
  function bindHighField(element, apply) {
    element.addEventListener("input", function () {
      var group = currentHigh();
      if (!group) return;
      apply(group, element.value);
      renderHighCounts();
      renderHighlights();
      scheduleValidate();
    });
  }

  /** Index de la ligne de liste à laquelle appartient un bouton d'action. */
  function rowIndex(node, attribute) {
    var row = node.closest("[" + attribute + "]");
    return row ? parseInt(row.getAttribute(attribute), 10) : -1;
  }

  function wire() {
    document.addEventListener("click", function (event) {
      var tab = event.target.closest("[data-tab]");
      if (tab) return setTab(tab.getAttribute("data-tab"));

      var item = event.target.closest("[data-app]");
      if (item) {
        state.appId = item.getAttribute("data-app");
        state.idTouched = true;
        renderApps();
        loadAppForm();
        return;
      }

      var cat = event.target.closest("[data-cat]");
      if (cat) {
        state.catName = cat.getAttribute("data-cat");
        renderCats();
        loadCatForm();
        return;
      }

      var high = event.target.closest("[data-high]");
      if (high) {
        selectHighlight(parseInt(high.getAttribute("data-high"), 10));
        return;
      }

      var type = event.target.closest("[data-type]");
      if (type) {
        var app = findApp(state.appId);
        if (app) app.type = type.getAttribute("data-type");
        setType(type.getAttribute("data-type"));
        renderApps();
        scheduleValidate();
        return;
      }

      var act = event.target.closest("[data-act]");
      if (!act) return;

      switch (act.getAttribute("data-act")) {
        case "open": doOpen(); break;
        case "save": doSave(); break;
        case "save-as": doSaveAs(); break;
        case "publish": doPublish(); break;
        case "app-add": addApp(); break;
        case "app-delete": deleteApp(); break;
        case "cat-add": addCat(); break;
        case "cat-delete": deleteCat(); break;
        case "logo-pick": pickLogo(); break;
        case "logo-clear": state.catalog.logo = null; renderLogo(); scheduleValidate(); break;
        case "share-choose": chooseShare(); break;
        case "share-load": loadShare(); break;
        case "app-image-pick": pickAppImage(); break;
        case "app-image-clear": clearAppImage(); break;
        case "shot-add": addScreenshot(); break;
        case "shot-remove": removeScreenshot(parseInt(act.getAttribute("data-shot"), 10)); break;
        case "news-add": addNews(); break;
        case "news-select": selectNews(rowIndex(act, "data-news-index")); break;
        case "news-up": moveNews(rowIndex(act, "data-news-index"), -1); break;
        case "news-down": moveNews(rowIndex(act, "data-news-index"), 1); break;
        case "news-delete": deleteNews(rowIndex(act, "data-news-index")); break;
        case "news-image-pick": pickNewsImage(); break;
        case "news-image-clear": clearNewsImage(); break;
        case "high-add": addHighlight(); break;
        case "high-up": moveHighlight(rowIndex(act, "data-high-index"), -1); break;
        case "high-down": moveHighlight(rowIndex(act, "data-high-index"), 1); break;
        case "high-delete": deleteHighlight(rowIndex(act, "data-high-index")); break;
        case "high-drop": dropHighlightApp(act.getAttribute("data-high-app")); break;
        default: break;
      }
    });

    els.appFilter.addEventListener("input", function () {
      state.filter = els.appFilter.value;
      renderApps();
    });

    bindAppField(els.fName, function (app, value) {
      app.name = value;
      if (!state.idTouched) {
        app.id = uniqueId(slug(value));
        els.fId.value = app.id;
        state.appId = app.id;
      }
      if (!app.mark) app.mark = String(value).slice(0, 2);
    });

    els.fId.addEventListener("input", function () {
      state.idTouched = true;
      var app = findApp(state.appId);
      if (!app) return;
      var clean = slug(els.fId.value);
      app.id = clean || app.id;
      state.appId = app.id;
      renderApps();
      scheduleValidate();
    });

    bindAppField(els.fUrl, function (app, value) { app.url = value.trim(); });
    bindAppField(els.fPath, function (app, value) { app.path = value.trim(); });
    bindAppField(els.fDescription, function (app, value) { app.description = value; });
    bindAppField(els.fMark, function (app, value) { app.mark = value; });
    bindAppField(els.fMeta, function (app, value) { app.meta = value; });
    bindAppField(els.fBadge, function (app, value) {
      app.badge = Math.max(0, Math.min(999, parseInt(value, 10) || 0));
    });
    bindAppField(els.fKeywords, function (app, value) {
      app.keywords = value.split(",").map(function (w) { return w.trim(); }).filter(Boolean);
    });

    els.fCategory.addEventListener("change", function () {
      var app = findApp(state.appId);
      if (!app) return;
      app.category = els.fCategory.value;
      renderApps();
      scheduleValidate();
    });

    els.cName.addEventListener("change", function () {
      renameCategory(state.catName, els.cName.value);
    });

    els.cDescription.addEventListener("input", function () {
      if (!state.catName) return;
      meta()[state.catName] = Object.assign({}, meta()[state.catName], {
        description: els.cDescription.value
      });
      scheduleValidate();
    });

    function applyColor(value) {
      if (!/^#[0-9a-fA-F]{6}$/.test(value) || !state.catName) return;
      meta()[state.catName] = Object.assign({}, meta()[state.catName], { color: value });
      els.cColorText.value = value;
      els.cColor.value = value;
      var m = meta()[state.catName];
      renderCatPreview(state.catName, m.icon || "layers", value);
      renderCats();
      scheduleValidate();
    }

    els.cColor.addEventListener("input", function () { applyColor(els.cColor.value); });
    els.cColorText.addEventListener("change", function () { applyColor(els.cColorText.value.trim()); });

    // L'outil est commun à tous les utilisateurs du poste : ni nom
    // d'établissement, ni identité. Seuls la version et le logo se règlent ici.
    els.eVersion.addEventListener("input", function () {
      state.catalog.version = els.eVersion.value.trim();
      scheduleValidate();
    });

    // En-tête du carrousel : sans information, l'objet n'est pas conservé par
    // la validation, donc on l'oublie dès qu'il redevient vide.
    els.dTitle.addEventListener("input", function () {
      news().title = els.dTitle.value;
      pruneNews();
      scheduleValidate();
    });

    els.dSubtitle.addEventListener("input", function () {
      news().subtitle = els.dSubtitle.value;
      pruneNews();
      scheduleValidate();
    });

    bindNewsField(els.nTitle, function (item, value) { item.title = value; });
    bindNewsField(els.nText, function (item, value) { item.text = value; });
    bindNewsField(els.dDate, function (item, value) {
      // Une information sans date reste valide : le rendu n'affiche rien.
      var clean = value.trim();
      if (clean) item.date = clean;
      else delete item.date;
    });

    bindNewsField(els.nUrl, function (item, value) {
      var clean = value.trim();
      if (!clean) {
        delete item.url;
        delete item.linkLabel;
        return;
      }
      // Une adresse qui n'est pas http(s) serait écartée en silence par la
      // validation du catalogue : on la refuse à la saisie et on le dit.
      if (!isHttpUrl(clean)) return;
      item.url = clean;
    }, function () { renderUrlState(); });

    bindNewsField(els.nLinkLabel, function (item, value) {
      var clean = value.trim();
      if (!item.url) return;
      if (clean) item.linkLabel = clean;
      else delete item.linkLabel;
    });

    bindHighField(els.hLabel, function (group, value) { group.label = value; });

    // Le filtre ne redessine que la liste : le champ de recherche n'est jamais
    // reconstruit pendant la frappe.
    els.hFilter.addEventListener("input", function () {
      state.highFilter = els.hFilter.value;
      renderHighChoices();
    });

    els.highChoices.addEventListener("change", function (event) {
      var box = event.target.closest("input[data-pick]");
      if (!box) return;
      toggleHighlightApp(box.getAttribute("data-pick"), box.checked);
    });

    document.addEventListener("keydown", function (event) {
      if ((event.ctrlKey || event.metaKey) && event.key === "s") {
        event.preventDefault();
        doSave();
      }
    });
  }

  function pickLogo() {
    bridge.pickLogo().then(function (result) {
      if (result.canceled) return;
      if (!result.ok) {
        toast("Image refusée", result.error, "warn");
        return;
      }
      state.catalog.logo = result.logo;
      renderLogo();
      scheduleValidate();
      toast("Logo défini", result.source);
    });
  }

  function chooseShare() {
    bridge.chooseShare().then(function (result) {
      if (result.canceled) return;
      state.sharePath = result.sharePath;
      els.eShare.value = state.sharePath;
      toast("Dossier de publication défini", state.sharePath);
    });
  }

  function loadShare() {
    bridge.loadShare().then(function (result) {
      if (!result.ok) {
        toast("Lecture impossible", result.error, "warn");
        return;
      }
      // Le contenu publié remplace celui de l'éditeur, mais la cible
      // d'enregistrement ne change pas. Le partage n'est écrit que par
      // « Publier », qui incrémente la version : enregistrer directement
      // dessus diffuserait des changements sans changer la version, donc sans
      // que les postes ne se mettent à jour.
      absorb({ catalog: result.catalog, filePath: state.filePath });
      toast("Catalogue publié chargé", "Modifiez, puis « Publier » pour le diffuser.");
    });
  }

  /* ═══ Démarrage ════════════════════════════════════════════════════════ */

  function boot() {
    els = {
      appList: $("app-list"),
      appFilter: $("app-filter"),
      appEmpty: $("app-empty"),
      appFields: $("app-fields"),
      appIconPicker: $("app-icon-picker"),
      fName: $("f-name"),
      fId: $("f-id"),
      fCategory: $("f-category"),
      fType: $("f-type"),
      fUrl: $("f-url"),
      fPath: $("f-path"),
      fDescription: $("f-description"),
      fMark: $("f-mark"),
      fBadge: $("f-badge"),
      fMeta: $("f-meta"),
      fKeywords: $("f-keywords"),
      appImagePreview: $("app-image-preview"),
      appShots: $("app-shots"),
      appShotAdd: $("app-shot-add"),
      highList: $("high-list"),
      highAdd: $("high-add"),
      highEmpty: $("high-empty"),
      highFields: $("high-fields"),
      hLabel: $("h-label"),
      hLabelCount: $("h-label-count"),
      hFilter: $("h-filter"),
      highChoices: $("h-choices"),
      hNote: $("h-note"),
      dTitle: $("d-title"),
      dSubtitle: $("d-subtitle"),
      newsList: $("news-list"),
      newsCount: $("news-count"),
      newsAdd: $("news-add"),
      newsForm: $("news-form"),
      newsHint: $("news-hint"),
      nTitle: $("n-title"),
      nTitleCount: $("n-title-count"),
      nText: $("n-text"),
      nTextCount: $("n-text-count"),
      dDate: $("d-date"),
      dDateCount: $("d-date-count"),
      nUrl: $("n-url"),
      nUrlNote: $("n-url-note"),
      nLinkLabel: $("n-link-label"),
      nLinkCount: $("n-link-count"),
      nLinkNote: $("n-link-note"),
      nImagePreview: $("n-image-preview"),
      catList: $("cat-list"),
      catEmpty: $("cat-empty"),
      catFields: $("cat-fields"),
      catIconPicker: $("cat-icon-picker"),
      cName: $("c-name"),
      cDescription: $("c-description"),
      cColor: $("c-color"),
      cColorText: $("c-color-text"),
      cPreview: $("c-preview"),
      eVersion: $("e-version"),
      eShare: $("e-share"),
      logoPreview: $("logo-preview"),
      logoNote: $("logo-note"),
      brandMark: $("brand-mark"),
      brandSub: $("brand-sub"),
      stFile: $("st-file"),
      stCount: $("st-count"),
      stState: $("st-state")
    };

    bridge.getState().then(function (payload) {
      state.sharePath = payload.sharePath || "";
      state.dark = !!payload.dark;
      document.documentElement.setAttribute("data-theme", state.dark ? "dark" : "light");

      if (!payload.catalog) {
        els.stFile.textContent = payload.error || "Aucun catalogue chargé";
        state.catalog = {
          version: "1.0.0",
          categories: [],
          categoryMeta: {},
          apps: []
        };
        renderApps();
        renderCats();
        renderApplication();
        renderStatus();
        return;
      }

      wire();
      absorb(payload);
      document.title = "StrasEdu Administration";
      // Exposé pour l'auto-vérification : permet de piloter l'interface sans
      // dépendre d'une souris.
      window.__adminState = state;
      // Réaffiche tout depuis l'état en mémoire. L'auto-vérification s'en sert
      // pour éprouver les plafonds et les aperçus après avoir écrit directement
      // dans le catalogue, sans ouvrir les sélecteurs de fichier natifs — qu'un
      // automate ne peut pas piloter.
      window.__adminRefresh = function () {
        renderApps();
        loadAppForm();
        renderCats();
        loadCatForm();
        renderHighlights();
        loadHighForm();
        renderDepartment();
        renderNews();
        loadNewsForm();
        renderApplication();
        renderStatus();
      };
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();

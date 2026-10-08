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
    idTouched: false,
    filter: "",
    validation: { ok: true, problems: [], badIds: [], warnings: [] }
  };

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

      var mark = app.icon
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

    renderApps();
    loadAppForm();
    renderCats();
    loadCatForm();
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
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();

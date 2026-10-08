/* ==========================================================================
   StrasEdu — publication d'une version sur GitHub
   --------------------------------------------------------------------------
   Crée la release du tag demandé et y dépose les exécutables produits par
   `npm run build:all`, accompagnés de leurs empreintes SHA-256.

   Les binaires ne sont pas versionnés dans le dépôt : 300 Mo par version
   l'alourdiraient définitivement. Une release GitHub est faite pour cela, et
   offre en plus un lien de téléchargement stable.

   Le jeton est lu depuis l'aide-mémoire de Git (celui qu'utilise déjà
   `git push`). Il n'est jamais affiché ni écrit sur le disque.

   Usage :
     node scripts/publish-release.js                 # version de package.json
     node scripts/publish-release.js --tag v2.0.1
     node scripts/publish-release.js --dry-run
     node scripts/publish-release.js --delete v2.0.0  # retire une release
   ========================================================================== */

"use strict";

const { execFileSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OWNER = "mytil67";
const REPO = "strasedu";

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const deleteArg = (() => {
  const i = argv.indexOf("--delete");
  return i >= 0 ? argv[i + 1] : null;
})();
const tagArg = (() => {
  const i = argv.indexOf("--tag");
  return i >= 0 ? argv[i + 1] : null;
})();

/* ─── Jeton ──────────────────────────────────────────────────────────────── */

function githubToken() {
  const output = execFileSync("git", ["credential", "fill"], {
    input: "protocol=https\nhost=github.com\n\n",
    encoding: "utf-8"
  });
  const line = output.split("\n").find((l) => l.startsWith("password="));
  const token = line ? line.slice("password=".length).trim() : "";
  if (!token) throw new Error("aucun jeton GitHub dans l'aide-mémoire de Git");
  return token;
}

/* ─── API ────────────────────────────────────────────────────────────────── */

async function api(token, method, url, body, extraHeaders) {
  const headers = Object.assign(
    {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "StrasEdu-release"
    },
    extraHeaders || {}
  );

  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const detail = data && data.message ? data.message : response.statusText;
    throw new Error(method + " " + url + " → " + response.status + " " + detail);
  }
  return data;
}

/* ─── Empreintes et signature ────────────────────────────────────────────── */

function sha256(file) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(file));
  return hash.digest("hex");
}

/**
 * État de la signature Authenticode d'un fichier.
 *
 * « Valid »      : signé et chaîne de confiance complète.
 * « UnknownError » : signé, mais la racine n'est pas approuvée sur ce poste —
 *                    le cas d'un certificat interne distribué par GPO.
 * « NotSigned »  : aucune signature.
 */
function signatureStatus(file) {
  const script =
    "(Get-AuthenticodeSignature -LiteralPath " +
    JSON.stringify(file) +
    ").Status";
  try {
    return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      encoding: "utf-8"
    }).trim();
  } catch {
    return "Indetermine";
  }
}

/* ─── Retrait d'une release ──────────────────────────────────────────────── */

/**
 * Retire la release et ses fichiers. Le tag Git n'est pas touché : il continue
 * de désigner le commit qu'il marquait, ce qui préserve l'historique.
 */
async function remove(token, tag) {
  const base = "https://api.github.com/repos/" + OWNER + "/" + REPO;

  let release;
  try {
    release = await api(token, "GET", base + "/releases/tags/" + tag);
  } catch (error) {
    if (/→ 404/.test(error.message)) {
      console.log("Aucune release pour le tag " + tag + ".");
      return;
    }
    throw error;
  }

  const total = release.assets.reduce((sum, a) => sum + a.size, 0);
  console.log(
    "Release " + tag + " — « " + release.name + " », " +
    release.assets.length + " fichier(s), " + Math.round(total / 1048576) + " Mo"
  );
  release.assets.forEach((a) => console.log("  " + a.name));

  if (dryRun) {
    console.log("\n--dry-run : rien n'a été supprimé.");
    return;
  }

  await api(token, "DELETE", base + "/releases/" + release.id);
  console.log("\nRelease " + tag + " supprimée, fichiers compris.");
  console.log("Le tag " + tag + " subsiste : il désigne toujours le commit qu'il marquait.");
}

/* ─── Programme ──────────────────────────────────────────────────────────── */

async function main() {
  if (deleteArg) {
    await remove(githubToken(), deleteArg);
    return;
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8"));
  const version = pkg.version;
  const tag = tagArg || "v" + version;

  const assets = [
    ["dist/StrasEdu-" + version + "-x64-setup.exe", "StrasEdu — installateur (enseignants)"],
    ["dist/StrasEdu-" + version + "-portable.exe", "StrasEdu — version portable (enseignants)"],
    ["dist-admin/StrasEdu-Administration-" + version + "-setup.exe", "Administration — installateur"],
    ["dist-admin/StrasEdu-Administration-" + version + "-portable.exe", "Administration — version portable"]
  ].map(([relative, description]) => {
    const file = path.join(ROOT, relative);
    if (!fs.existsSync(file)) throw new Error("fichier absent : " + relative + " (lancez npm run build:all)");
    return { file, name: path.basename(file), description, size: fs.statSync(file).size };
  });

  // Somme de contrôle : indispensable pour un déploiement de parc, où les
  // fichiers transitent par des partages réseau.
  const checksumPath = path.join(ROOT, "SHA256SUMS.txt");
  const checksumBody = assets.map((a) => sha256(a.file) + "  " + a.name).join("\n") + "\n";
  fs.writeFileSync(checksumPath, checksumBody, "utf-8");
  assets.push({
    file: checksumPath,
    name: "SHA256SUMS.txt",
    description: "Empreintes SHA-256 des fichiers",
    size: fs.statSync(checksumPath).size
  });

  console.log("Version : " + version + "   tag : " + tag);

  // Contrôle de signature : un binaire non signé déclenche « Éditeur inconnu »
  // et l'avertissement SmartScreen. Mieux vaut s'en apercevoir ici qu'après
  // avoir diffusé 305 Mo sur 2000 postes.
  const unsigned = [];
  const untrusted = [];
  for (const asset of assets) {
    if (!asset.name.endsWith(".exe")) continue;
    asset.signature = signatureStatus(asset.file);
    if (asset.signature === "NotSigned") unsigned.push(asset.name);
    else if (asset.signature === "UnknownError") untrusted.push(asset.name);
  }
  for (const asset of assets) {
    const note = asset.signature ? "  signature=" + asset.signature : "";
    console.log("  " + asset.name + "  (" + Math.round(asset.size / 1024 / 1024) + " Mo)" + note);
  }

  if (untrusted.length && !argv.includes("--allow-internal-cert")) {
    console.error(
      "\n  Refus : " + untrusted.length + " fichier(s) sont signes par un certificat dont la\n" +
      "  racine n'est approuvee sur aucun poste. Sur une page de telechargement\n" +
      "  publique, une signature non reconnue est plus suspecte qu'une absence de\n" +
      "  signature.\n" +
      "    " + untrusted.join("\n    ") + "\n\n" +
      "  Utilisez un certificat delivre par une autorite (docs/SIGNATURE.md), ou\n" +
      "  relancez avec --allow-internal-cert si cette version est destinee a un\n" +
      "  deploiement interne dont la racine est distribuee par GPO."
    );
    process.exit(1);
  }
  if (unsigned.length && !argv.includes("--allow-unsigned")) {
    console.error(
      "\n  Refus : " + unsigned.length + " fichier(s) ne sont pas signes.\n" +
      "    " + unsigned.join("\n    ") + "\n\n" +
      "  Renseignez un certificat avant de publier (voir docs/SIGNATURE.md), ou\n" +
      "  relancez avec --allow-unsigned si c'est vraiment voulu."
    );
    process.exit(1);
  }

  if (dryRun) {
    console.log("\n--dry-run : rien n'a été envoyé.");
    return;
  }

  const token = githubToken();
  const base = "https://api.github.com/repos/" + OWNER + "/" + REPO;

  const body = [
    "## StrasEdu " + version,
    "",
    "### Pour les enseignants",
    "",
    "- `StrasEdu-" + version + "-x64-setup.exe` — installation (menu Démarrer et raccourci bureau).",
    "- `StrasEdu-" + version + "-portable.exe` — sans installation.",
    "",
    "### Pour le service informatique",
    "",
    "- `StrasEdu-Administration-" + version + "-setup.exe` — outil d'administration du catalogue.",
    "- `StrasEdu-Administration-" + version + "-portable.exe` — le même, sans installation.",
    "",
    "Au premier lancement, l'outil d'administration travaille sur une copie du catalogue",
    "livré, dans le profil de l'utilisateur. Le catalogue des postes n'est modifié que par",
    "le bouton **Publier**.",
    "",
    "### Vérification",
    "",
    "`SHA256SUMS.txt` contient l'empreinte de chaque fichier :",
    "",
    "```powershell",
    "Get-FileHash .\\StrasEdu-Administration-" + version + "-setup.exe -Algorithm SHA256",
    "```",
    "",
    "> Les exécutables ne sont pas signés : SmartScreen affiche un avertissement au premier",
    "> lancement. Voir la section « Signature de code » de `docs/DEPLOIEMENT.md`."
  ].join("\n");

  // Réutiliser la release si elle existe déjà : l'outil est rejouable.
  let release = null;
  try {
    release = await api(token, "GET", base + "/releases/tags/" + tag);
    console.log("\nRelease " + tag + " déjà présente (id " + release.id + ") — mise à jour des fichiers.");
  } catch (error) {
    if (!/→ 404/.test(error.message)) throw error;
  }

  if (!release) {
    release = await api(token, "POST", base + "/releases", {
      tag_name: tag,
      target_commitish: "main",
      name: "StrasEdu " + version,
      body,
      draft: false,
      prerelease: false
    });
    console.log("\nRelease " + tag + " créée (id " + release.id + ").");
  }

  const existing = await api(token, "GET", base + "/releases/" + release.id + "/assets");

  for (const asset of assets) {
    const already = existing.find((a) => a.name === asset.name);
    if (already) {
      await api(token, "DELETE", base + "/releases/assets/" + already.id);
      console.log("  " + asset.name + " : ancienne version retirée");
    }

    const started = Date.now();
    process.stdout.write("  " + asset.name + " : envoi… ");
    const upload = await fetch(
      "https://uploads.github.com/repos/" + OWNER + "/" + REPO +
        "/releases/" + release.id + "/assets?name=" + encodeURIComponent(asset.name),
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/octet-stream",
          "Content-Length": String(asset.size),
          "User-Agent": "StrasEdu-release"
        },
        body: fs.readFileSync(asset.file)
      }
    );
    if (!upload.ok) {
      const detail = await upload.text();
      throw new Error("envoi de " + asset.name + " refusé (" + upload.status + ") " + detail);
    }
    const seconds = Math.round((Date.now() - started) / 1000);
    console.log("ok (" + seconds + " s)");
  }

  console.log("\nRelease publiée : https://github.com/" + OWNER + "/" + REPO + "/releases/tag/" + tag);
}

main().catch((error) => {
  console.error("\nÉchec : " + (error && error.message ? error.message : error));
  process.exit(1);
});

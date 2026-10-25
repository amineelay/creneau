# Créneau 5:50

App web installable (PWA) pour les séances maison : programme du jour, séance en direct, suivi de la
régularité et coach IA. Tout tient dans `index.html` (sans dépendance ni build) ; les données restent
sur le téléphone (`localStorage`), avec export/import JSON dans l'onglet Semaine.

## Tester en local

```bash
npx serve -l 8080
```

Puis ouvrir http://localhost:8080.

## Déploiement

- **App** : chaque push sur `main` publie sur GitHub Pages (`.github/workflows/pages.yml`).
  Activer une fois : Settings → Pages → Source : *GitHub Actions*.
  Après une modification de l'app, incrémenter `CACHE_VERSION` dans `sw.js`, sinon les téléphones
  gardent l'ancienne version en cache.
- **Coach IA** (`worker/`, Cloudflare Worker qui garde la clé API Anthropic) :

  ```bash
  cd worker && npm install && npx wrangler login
  npx wrangler secret put ANTHROPIC_API_KEY
  npx wrangler secret put ACCESS_CODE
  npx wrangler deploy
  ```

  Dans l'app, onglet Semaine → Coach IA : coller l'URL `*.workers.dev` et le code d'accès.
  Les origines autorisées sont dans `worker/wrangler.toml` (`ALLOWED_ORIGINS`).

## Installer sur le téléphone

- **iPhone** (Safari) : Partager → *Sur l'écran d'accueil*.
- **Android** (Chrome) : menu ⋮ → *Installer l'application*.

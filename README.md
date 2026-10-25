# Créneau 5:50

App web installable (PWA) pour un actif de bureau qui veut gagner en santé : séances maison à 5:50,
pauses mobilité au bureau, bilans de forme et coach IA. Tout tient dans `index.html` (sans dépendance
ni build).

- **Séance** : rotation santé sur 3 jours (force full body A, cardio modéré, force full body B), bloc
  mobilité posture en fin de séance, séance express de 12′, semaine allégée automatique (1 semaine
  active sur 5, ou après 3 séances à RPE ≥ 9), repos entre les tours et annonces vocales en option.
- **Mobilité** : 48 exercices illustrés (bonhomme animé, consigne, minuteur, annonce vocale avec
  changement de côté), réveil 10′ qui change chaque jour, souplesse 15′ (focus tournant sur 3 jours),
  pauses bureau 3′, routine sur mesure (zones, durée, style) et bibliothèque par zone.
- **Bibliothèque** : 64 exercices de musculation (haltères, élastique en kg, poids du corps) et 48 de
  mobilité, illustrés, avec recherche et filtres ; kg, élastique et répétitions réglables par exercice.
- **Semaine** : régularité (semaine validée dès objectif − 1 séances), réglages, données, coach.
- **Suivi** : bilan de forme toutes les 6 semaines, courbes de tendance, charges, historique.
- **Données** : `localStorage` du téléphone, export/import JSON, et sauvegarde automatique sur le
  Worker (KV) dès que le coach est configuré.

## Tester en local

```bash
python -m http.server 8080
```

Puis ouvrir http://localhost:8080. Pour le Worker en local (KV simulé) : créer `worker/.dev.vars`
(ignoré par git) avec `ACCESS_CODE=...` et `ANTHROPIC_API_KEY=...`, puis
`npx wrangler dev --port 8787 --local --ip 127.0.0.1`.

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
  La sauvegarde automatique utilise le namespace KV `BACKUP` déclaré dans `wrangler.toml`
  (créé avec `npx wrangler kv namespace create BACKUP`).

## Installer sur le téléphone

- **iPhone** (Safari) : Partager → *Sur l'écran d'accueil*.
- **Android** (Chrome) : menu ⋮ → *Installer l'application*.

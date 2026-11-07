# Les Émirs — site du restaurant

Site public lesemirs.com (Port El Kantaoui) et outils du restaurant : réservations, page QR, réclamations, tableaux de bord du personnel.
Réalisé et maintenu par l'agence **Autopat** (Mehdi Karoui, +216 24 692 211). Tout ce qui est livré porte la marque Autopat.

## Qui fait quoi

- **Mahassen** (community manager) : textes, SEO, traductions, photos, mise en page des pages publiques.
- **Mehdi** : relit, fusionne et **déploie**. Lui seul touche à Cloudflare, à la base de données et aux secrets.

## Méthode de travail

1. Partir de `master` à jour (`git pull`), créer une branche par sujet (ex. `seo-titres`, `texte-snacks`).
2. Faire de petits commits, en français, qui disent ce qui change pour le visiteur.
3. Pousser la branche et ouvrir une pull request vers `master`. Ne jamais pousser directement sur `master`.
4. Après la fusion, rien n'est en ligne tant que Mehdi n'a pas déployé (le projet Cloudflare n'est pas relié à GitHub).

## Interdit

- **Déployer** : pas de `wrangler pages deploy`, pas de `scripts/deploy.sh`, pas de `wrangler login`.
- **Base de données et secrets** : pas de `wrangler d1`, pas de `wrangler secret`. Ne jamais lire, créer ou modifier `.env`, `.dev.vars`, `wrangler.local.toml`, ni le dossier `backup/` (données clients).
- **Données personnelles** : ne jamais copier de nom, téléphone ou email de client dans le code, un commit ou une pull request. Le dépôt GitHub est **public**.
- **Aucune trace d'IA**, ni sur le site ni dans l'historique Git :
  - pas de ligne `Co-Authored-By`, pas de lien `Claude-Session`, pas de « Generated with … » dans les commits ou les pull requests ;
  - auteur des commits : `Mahassen <restaurant.lesemirs@gmail.com>`, sans « via Claude » ;
  - aucune mention de Claude, Anthropic ou d'une IA dans les pages, les commentaires ou les textes.
- **Code serveur** : ne pas modifier `netlify/functions/`, `functions/`, `mail-worker/`, `cron/`, `db/`, `scripts/` sans accord de Mehdi. Ces dossiers gèrent les réservations, les emails et les dettes clients : une erreur s'y voit chez les clients.

## Où sont les choses

- `public/index.html` : la page d'accueil, avec le menu (fenêtre « La Carte ») et le formulaire de réservation. HTML, CSS et JS dans le même fichier.
- `public/i18n.js` : la version anglaise (bouton FR | EN, `?lang=en`).
- `public/qr.html` : page ouverte par le QR code sur les tables.
- `public/reclamation.html` : page de réclamation (FR et EN dans le même fichier).
- `public/sitemap.xml`, `public/robots.txt` : SEO.
- `public/assets/media/` : photos. Les nouvelles photos vont ici, en `.jpg` ou `.webp`, nommées en minuscules avec des tirets.
- `public/admin.html` : tableau de bord du personnel. **Ne pas modifier** (`gerant.html`, `reception.html` et `watcher.html` en sont des copies automatiques).

## Règles de texte

- Le site est **en français d'abord**. Toute phrase française visible ajoutée ou changée dans `index.html` doit avoir son entrée dans le dictionnaire de `public/i18n.js`, avec **exactement** le même texte français comme clé (mêmes apostrophes `’`, mêmes `…`). Sinon elle reste en français sur la version anglaise.
- Après un changement dans `i18n.js`, changer le numéro de version dans `index.html` (`/i18n.js?v=AAAAMMJJx`) pour que les téléphones chargent la nouvelle version.
- Apostrophe typographique `’` et points de suspension `…`. Espace insécable (`&nbsp;`) avant `? ! : ;` en français.
- Nom : « Les Émirs » (avec accent) dans les textes, « Restaurant Les Émirs » pour le SEO.

## Style visuel

- Couleurs (variables CSS en haut de `index.html`) : vert marine `--marine #1f473f`, or `--gold #a98c4b`, fond `--bone #f3efe6`, texte `--ink #17150f`, gris `--stone #726a5c`. Ne pas en inventer d'autres.
- Polices : Fraunces (titres, italique pour les phrases d'ambiance) et Inter (texte courant).
- Pas de curseur personnalisé. Vérifier chaque changement sur téléphone (375 px de large) : c'est là que la plupart des clients voient le site.
- Quand on demande d'améliorer la qualité d'un élément, garder sa place et sa taille : améliorer l'élément, pas la mise en page.

## Vérifier avant la pull request

```bash
node --check public/i18n.js
node tests/run.mjs
```

Ouvrir `public/index.html` dans un navigateur, en français puis en anglais, en largeur téléphone.

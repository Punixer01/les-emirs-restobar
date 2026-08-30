# Les Émirs — déploiement (self-serve)

> ⚠️ L'ancien site Netlify `les-emirs-premium` (id `0108b08c-…`) **n'existe plus**
> (supprimé du compte) — c'est pourquoi les déploiements échouaient (404).
> On crée donc un **nouveau site**. Le lien mort a été retiré (`.netlify/state.json`).

## Déployer (terminal, dans ce dossier)

```bash
cd C:\Users\0000\Desktop\demo\les-emirs-app
npx netlify-cli login
npm install
npx netlify-cli deploy --build --prod
```

À la première exécution, la CLI propose **« Create & configure a new site »** →
choisis ton équipe et un nom (ex. `les-emirs`). L'URL sera `https://<nom>.netlify.app`.

> Après avoir choisi le nom, **mets à jour** `PUBLIC_BASE_URL` et le `og:image` /
> `canonical` dans `public/index.html` si l'URL diffère de `les-emirs-premium`.

### Base de données (Neon) — automatique
Le build provisionne **Netlify DB** (via `@netlify/neon`) et définit
`NETLIFY_DATABASE_URL`. Sinon : Dashboard → le projet → **Extensions → Neon →
Add database**, puis redéployer.

### Créer les tables (une seule fois, après le déploiement)
```powershell
curl.exe -X POST https://<TON-SITE>.netlify.app/api/setup `
  -H "content-type: application/json" -d '{"code":"VOTRE_CODE_DIRECTION"}'
```
Réponse attendue : `{"ok":true,"executed":...}`.

### Variables d'environnement (optionnel — valeurs par défaut déjà intégrées)
Codes / secret / clés push fonctionnent déjà. À personnaliser plus tard :
```bash
npx netlify-cli env:set RESEND_API_KEY re_xxx
npx netlify-cli env:set MAIL_FROM "Les Émirs <reservations@SON-DOMAINE>"
npx netlify-cli env:set RESTAURANT_EMAIL contact@SON-DOMAINE
npx netlify-cli env:set OWNER_CODE "un-code-prive"
npx netlify-cli env:set RECEPTION_CODE "un-autre-code"
```

## Accès
| App | URL | Code |
|-----|-----|------|
| Site public | / | — |
| Direction | /admin | `VOTRE_CODE_DIRECTION` |
| Réception | /reception | `VOTRE_CODE_RECEPTION` |

## Test de bout en bout
1. Ouvrir le site → réserver une table (choisir Intérieur / Terrasse).
2. `/admin` → la demande apparaît → **Accepter**.
3. `/reception` → la réservation acceptée apparaît → **Installé**.
4. Marquer **No-show** → le numéro passe en **Blacklist**.

## Notes déploiement
- **Ne pas** committer / uploader `node_modules` (la CI l'installe). `.gitignore` l'exclut.
- Médias réels : `public/assets/media/` (vidéos hero + gargoulette, photos), logo : `public/assets/logo-*.png` + `logo.svg`.

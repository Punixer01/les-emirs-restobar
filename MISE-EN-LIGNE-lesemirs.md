# Mise en ligne — lesemirs.com / lesemirs.tn

Document de migration. Préparé par **Autopat** — Mehdi Karoui · +216 24 692 211

---

## 1. Situation actuelle (relevée le 2 septembre 2026)

| Élément | lesemirs.com | lesemirs.tn |
|---|---|---|
| Serveurs DNS | `dns10.ovh.net` / `ns10.ovh.net` | `dns1.tn.ovh.net` / `ns1.tn.ovh.net` |
| Site web | WordPress sur hébergement OVH (`5.135.23.164`) | redirigé vers lesemirs.com |
| Email | OVH — `mx1/mx2/mx3.mail.ovh.net` | OVH — idem |
| SPF | `v=spf1 include:mx.ovh.com -all` | idem |
| DKIM / DMARC | aucun | aucun |

Le nouveau site (site public + `/carte` + tableau de bord `/admin` + `/reception` +
QR codes + emails) tourne aujourd'hui sur **Cloudflare Pages**, à l'adresse
provisoire `https://les-emirs.pages.dev`.

> Le nouveau système **ne peut pas** tourner sur l'hébergement WordPress OVH :
> il utilise une base de données et des fonctions serveur (réservations, QR,
> emails) que l'hébergement mutualisé OVH n'exécute pas. L'hébergement web OVH
> devient donc inutile — **l'email OVH, lui, doit être conservé.**

---

## 2. La zone DNS complète, à recréer à l'identique

**C'est la partie critique : si un seul de ces enregistrements est perdu, l'email
du restaurant s'arrête.** Relevé complet, rien d'autre n'existe dans la zone.

### lesemirs.com

| Nom | Type | Priorité | Valeur |
|---|---|---|---|
| `@` | MX | 1 | `mx1.mail.ovh.net` |
| `@` | MX | 5 | `mx2.mail.ovh.net` |
| `@` | MX | 100 | `mx3.mail.ovh.net` |
| `@` | TXT | — | `v=spf1 include:mx.ovh.com -all` |
| `@` | TXT | — | `1\|www.lesemirs.com` *(marqueur interne OVH — facultatif)* |
| `www` | TXT | — | `3\|welcome` *(marqueur interne OVH — facultatif)* |
| `ftp` | CNAME | — | `lesemirs.com` *(inutile si l'hébergement OVH est résilié)* |
| `@` | A | — | `5.135.23.164` → **à remplacer** (voir §3) |
| `www` | A | — | `5.135.23.164` → **à remplacer** (voir §3) |

### lesemirs.tn

Zone identique, en remplaçant `lesemirs.com` par `lesemirs.tn`.

---

## 3. Ce qui change

| Nom | Type | Nouvelle valeur |
|---|---|---|
| `@` (lesemirs.com) | CNAME* | `les-emirs.pages.dev` |
| `www` | CNAME | `les-emirs.pages.dev` |

\* Un CNAME à la racine d'un domaine n'est pas autorisé par le DNS. C'est
possible chez Cloudflare (aplatissement automatique), **pas chez OVH** — d'où le
choix des serveurs DNS ci-dessous.

Le certificat HTTPS est émis automatiquement par Cloudflare, gratuitement, et se
renouvelle seul. Rien à acheter, rien à renouveler.

---

## 4. Deux chemins possibles

### Chemin A — serveurs DNS chez Cloudflare *(retenu)*

1. Ajouter `lesemirs.com` au compte Cloudflare existant : Cloudflare lit la zone
   en place — **vérifier que les 3 MX et le SPF du §2 sont bien présents avant
   de continuer.**
2. Cloudflare donne 2 serveurs DNS. Les saisir chez OVH (espace client → domaine
   → *Serveurs DNS*).
3. Attendre la propagation (de 30 min à 24 h).
4. Ajouter `lesemirs.com` et `www.lesemirs.com` comme domaines du projet Pages.
5. Idem pour `lesemirs.tn`, ou le laisser chez OVH avec une simple redirection.

**Pour :** la racine `lesemirs.com` fonctionne, HTTPS automatique, tout au même
endroit, l'hébergement web OVH peut être résilié.
**Contre :** l'email dépend d'une zone DNS recréée — d'où la vérification à l'étape 2.

### Chemin B — tout reste chez OVH

1. Chez OVH : `www` en CNAME vers `les-emirs.pages.dev`.
2. Toujours chez OVH : redirection 301 de `lesemirs.com` vers `https://www.lesemirs.com`.
3. Ajouter `www.lesemirs.com` comme domaine du projet Pages.

**Pour :** l'email n'est jamais touché — risque nul.
**Contre :** l'adresse officielle devient `www.lesemirs.com`, et l'hébergement
web OVH doit être conservé (payant) uniquement pour assurer la redirection.

---

## 5. Emails aux clients (Resend)

Les emails partent aujourd'hui d'une adresse de test. Pour qu'ils partent de
`reservation@lesemirs.com`, Resend demande de vérifier le domaine.

**À faire sur un sous-domaine dédié — `send.lesemirs.com` — et surtout pas sur la
racine :** les enregistrements MX de la racine appartiennent à l'email OVH du
restaurant et ne doivent pas être modifiés.

Resend fournira 3 enregistrements (MX + SPF + DKIM) à créer sur ce sous-domaine.

---

## 6. Ordre des opérations le jour du basculement

1. Sauvegarder la base de données. *(déjà automatisé)*
2. Créer les enregistrements DNS du §3.
3. Ajouter les domaines au projet Pages, attendre le certificat HTTPS.
4. Vérifier : le site s'ouvre en `https://lesemirs.com`, la carte, une
   réservation test de bout en bout, le QR reçu par email.
5. **Envoyer et recevoir un email** sur une adresse `@lesemirs.com` — la
   vérification qui compte.
6. Passer `PUBLIC_BASE_URL` sur `https://lesemirs.com` *(sinon les QR envoyés par
   email pointent vers l'ancien site)*.
7. Vérifier `lesemirs.tn` → `lesemirs.com`.
8. Soumettre `https://lesemirs.com/sitemap.xml` à Google Search Console.

---

## 7. Accès nécessaires

| Accès | Pourquoi | Qui |
|---|---|---|
| Espace client OVH | changer les serveurs DNS | le restaurant |
| Compte Cloudflare | hébergement du site — **compte existant, conservé** | Autopat |
| Compte Resend | emails de confirmation | Autopat |

Les noms de domaine `lesemirs.com` et `lesemirs.tn`, la boîte email et le contenu
du site restent la propriété pleine et entière du restaurant. L'hébergement
technique est assuré sur le compte Cloudflare d'Autopat ; la zone DNS y sera
donc gérée. Le restaurant conserve à tout moment la main sur ses domaines chez
OVH et peut faire pointer ses serveurs DNS ailleurs.

La maintenance courante est assurée par le restaurant ; Autopat intervient sur
consultation.

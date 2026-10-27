# WhatsApp (Meta Cloud API) — mise en service

Le code envoie déjà les messages WhatsApp aux mêmes moments que les emails
(demande reçue, réservation confirmée, réservation refusée). Il reste **3 choses
à faire côté Meta**, une seule fois. Tant que ce n'est pas fait, WhatsApp est
simplement ignoré (les emails/SMS continuent normalement).

## 1) Compte + numéro
1. Créer un compte **Meta Business** : business.facebook.com
2. Sur **developers.facebook.com** → créer une app → produit **WhatsApp**.
3. Ajouter un **numéro dédié** au WhatsApp Business API.
   ⚠️ Ce numéro ne doit **pas** être utilisé dans l'application WhatsApp normale.
4. Noter le **Phone number ID** (identifiant du numéro).

## 2) Créer les 3 modèles (templates)
Dans **WhatsApp Manager → Modèles de messages**, catégorie **Utilitaire**,
langue **Français (fr)**. Les noms doivent être EXACTEMENT ceux-ci :

**`reservation_recue`** — 4 variables
> Bonjour {{1}}, nous avons bien reçu votre demande de réservation : {{2}}, {{3}} couverts. Référence {{4}}. Elle sera confirmée après validation de notre équipe. Merci ! — Restaurant Les Émirs

**`reservation_confirmee`** — 4 variables
> Bonjour {{1}}, votre réservation au Restaurant Les Émirs est confirmée : {{2}}, {{3}} personnes. Référence {{4}}. En cas d'empêchement, merci de nous prévenir. À très bientôt !

**`reservation_refusee`** — 2 variables
> Bonjour {{1}}, nous sommes désolés de ne pouvoir honorer votre demande pour le {{2}} par manque de disponibilité. N'hésitez pas à réessayer un autre créneau. Merci de votre compréhension. — Restaurant Les Émirs

L'ordre des variables est important (il correspond au code). L'approbation Meta
prend en général quelques minutes à ~1 jour.

## 3) Clés (secrets) dans Cloudflare Pages
Projet **les-emirs** → Settings → Environment variables (Production) :

| Nom | Valeur |
|---|---|
| `WHATSAPP_TOKEN` | jeton d'accès permanent (System User, permission `whatsapp_business_messaging`) |
| `WHATSAPP_PHONE_ID` | le Phone number ID de l'étape 1 |
| `WHATSAPP_LANG` | `fr` (optionnel) |
| `WHATSAPP_API_VERSION` | `v21.0` (optionnel) |

Puis redéployer. C'est tout — les prochains messages partiront aussi sur WhatsApp.

## Coût
Palier gratuit Meta (~1000 conversations utilitaires / mois), puis facturation
Meta à la conversation (quelques centimes). Aucun coût de licence côté code.

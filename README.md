# Blackjack — SPA avec compteur de cartes

Mini-jeu de **Blackjack** réalisé en HTML / CSS / JavaScript pur (zéro
dépendance), pensé comme un **outil d'entraînement au comptage de cartes**.
L'utilisateur démarre avec **100 €** virtuels (rejouables à l'infini — pas
d'argent réel).

## Lancer le projet

Aucune installation. Ouvrez `index.html` dans un navigateur moderne
(Chrome, Firefox, Edge, Safari).

> ⚠️ **Caméra** : pour personnaliser votre avatar avec une photo, le
> navigateur doit autoriser l'accès à la webcam. Sur certaines plateformes,
> `getUserMedia` n'est disponible qu'en HTTPS ou via `http://localhost`.
> Si nécessaire, servez le dossier avec `python -m http.server` puis
> ouvrez `http://localhost:8000`.

## Règles & déroulé

- Vous démarrez avec **100 €**. Si vous tombez à 0 €, la maison vous
  recrédite automatiquement.
- **Mise libre** — uniquement plafonnée par votre solde courant. Saisissez
  un montant ou cliquez sur les jetons (5, 10, 25, 50, 100, 500 €) pour
  composer votre mise.
- Cartes : 2–10 valent leur rang, J/Q/K valent 10, l'As vaut **1 ou 11**
  (la valeur la plus avantageuse est calculée automatiquement).
- Actions : **Tirer** (Hit `H`), **Rester** (Stand `S`), **Doubler**
  (Double `D` — double la mise et tire une carte unique).
- Le croupier tire jusqu'à **17**.
- Un **Blackjack** naturel paie **3 pour 2**.

## Sabot multi-paquets — pour s'entraîner au comptage

Contrairement à un blackjack jouet où le paquet est ré-mélangé à chaque
main, ce projet simule **un vrai sabot de casino** :

- **6 paquets** mélangés au démarrage (312 cartes).
- Une **carte de coupe** placée vers 75 % du sabot. Quand on la franchit,
  le sabot est rebattu uniquement à la main suivante.
- Aucun mélange entre les mains tant que la carte de coupe n'est pas
  atteinte → **vous pouvez réellement compter les cartes** comme dans un
  casino réel.

## Compteur de cartes (sidebar gauche)

Le système de comptage utilisé est le **Hi-Lo** :

| Cartes        | Valeur |
|---------------|--------|
| 2, 3, 4, 5, 6 | **+1** |
| 7, 8, 9       |   0    |
| 10, J, Q, K, A| **−1** |

La sidebar affiche en temps réel :

- **Compte courant** — somme Hi-Lo de toutes les cartes vues depuis le
  dernier mélange.
- **Vrai compte** — compte courant ÷ paquets restants. C'est cette valeur
  que les joueurs utilisent pour ajuster leur mise.
- **Paquets restants** dans le sabot.
- **Cartes vues / 312** + barre de progression.

### Mode "auto-test"

Cliquez sur l'œil 👁 en haut de la sidebar pour **masquer** les valeurs.
Vous pouvez alors entrer votre estimation du compte courant et la
**vérifier** d'un clic. Idéal pour s'entraîner sans triche.

## Avatars

- Le **croupier** est représenté par une silhouette SVG inline (homme en
  nœud papillon).
- **Vous** apparaissez par défaut comme une **ombre noire**. Cliquez sur
  l'icône 📷 dans la barre supérieure pour ouvrir la caméra et **prendre
  une photo** qui remplace la silhouette. La photo est stockée localement
  dans `localStorage` (jamais envoyée nulle part).
- Le bouton « Retirer l'avatar » remet la silhouette par défaut.

## Animation des jetons

Quand vous distribuez, une **pile de jetons** apparaît au centre de la
table (décomposée en coupures de 500/100/50/25/10/5/1 €). À la fin de la
main :

- **Gain** → la pile **glisse vers vous** (vers le bas).
- **Perte** → la pile **glisse vers le croupier** (vers le haut).
- **Égalité** → la pile fait un aller-retour, signe de la mise rendue.

## Persistance (LocalStorage)

Sauvegardé sous la clé `blackjack.state.v2` :

- solde,
- statistiques (mains jouées, gains, pertes, égalités, blackjacks),
- thème (clair / sombre),
- photo d'avatar (data URL),
- préférence d'affichage du compteur (visible / masqué).

> Le sabot et le compte courant ne sont **pas** sauvegardés volontairement :
> chaque session démarre avec un sabot frais.

## Structure des fichiers

```
BJ/
├── index.html   ← Squelette + modale caméra + avatars SVG inline
├── style.css    ← Thèmes, table, cartes, sidebar, animations
├── script.js    ← Sabot, compteur Hi-Lo, jeu, événements, webcam
└── README.md    ← Ce fichier
```

## Conformité aux spécifications

| Critère                     | Implémentation |
|-----------------------------|----------------|
| Manipulation dynamique du DOM | Cartes, jetons, statistiques, jetons sur la table, avatars créés via `createElement` / `appendChild` ; libellés via *template literals*. Aucun contenu de jeu codé en dur. |
| 3+ types d'événements       | **5 types** : `submit` (mise), `click` (actions/jetons/thème/reset/caméra/compteur), `keyup` (raccourcis H/S/D), `change` (validation mise), `input` (feedback immédiat). |
| Persistance LocalStorage    | Solde, stats, thème, avatar et préférence du compteur sauvegardés dans `localStorage` ; restaurés au chargement. |
| Tableaux et objets          | Sabot = tableau d'objets `{suit, color, label, value}` ; état global = objet structuré. |
| Méthodes itératives         | `flatMap`, `map`, `forEach`, `filter`, `reduce` utilisés dans `buildShoe`, `handValue`, `chipBreakdown`, `renderHand`, `renderHud`. |
| UI / UX & responsive        | Layout deux colonnes, table feutrée, animations de jetons, mobile-friendly via `@media`. |
| Organisation & nommage      | Fichiers séparés, sections numérotées et commentées en français. |

## Idées d'amélioration

- Split de paire (séparer deux cartes identiques en deux mains).
- Assurance contre un As du croupier.
- Animation 3D de retournement de la carte cachée.
- Tableau d'écarts de mise recommandés en fonction du vrai compte.
- Statistiques de précision sur le mode auto-test.

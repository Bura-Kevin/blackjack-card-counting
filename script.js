/* =====================================================================
   Blackjack — SPA avec sabot multi-paquets et compteur Hi-Lo
   ---------------------------------------------------------------------
   Fonctionnalités :
   - Sabot de 6 paquets (312 cartes) avec carte de coupe — pas de
     re-mélange entre les mains, ce qui rend le comptage de cartes possible.
   - Compteur Hi-Lo automatique (compte courant + vrai compte).
   - Mode "auto-test" : valeurs masquées, le joueur saisit son estimation.
   - Animation des jetons : pile sur la table, glissement vers le joueur
     (gain) ou vers le croupier (perte).
   - Avatars : croupier en SVG inline ; joueur via webcam (getUserMedia)
     ou silhouette par défaut. Photo persistée en LocalStorage.
   - Persistance : solde, statistiques, thème, photo, paramètres compteur.
   ---------------------------------------------------------------------
   Critères techniques :
   - DOM dynamique : createElement, appendChild, template literals.
   - 5 types d'événements : submit, click, keyup, change, input.
   - LocalStorage pour la persistance.
   - Tableaux + objets, méthodes itératives forEach/map/filter/reduce.
   ===================================================================== */

"use strict";

// ---------- 1. Constantes -----------------------------------------------

const SUITS = [
  { symbol: "♠", color: "black" },
  { symbol: "♥", color: "red" },
  { symbol: "♦", color: "red" },
  { symbol: "♣", color: "black" },
];

const RANKS = [
  { label: "A",  value: 11 },
  { label: "2",  value: 2  },
  { label: "3",  value: 3  },
  { label: "4",  value: 4  },
  { label: "5",  value: 5  },
  { label: "6",  value: 6  },
  { label: "7",  value: 7  },
  { label: "8",  value: 8  },
  { label: "9",  value: 9  },
  { label: "10", value: 10 },
  { label: "J",  value: 10 },
  { label: "Q",  value: 10 },
  { label: "K",  value: 10 },
];

const STORAGE_KEY      = "blackjack.state.v2";
const STARTING_BALANCE = 100;
const NUM_DECKS        = 6;             // taille du sabot (comme dans la plupart des casinos)
const CUT_RATIO        = 0.75;          // carte de coupe à ~75 % du sabot
const CHIP_VALUES      = [5, 10, 25, 50, 100, 500];
const CHIP_DENOMS      = [500, 100, 50, 25, 10, 5, 1]; // pour décomposer une mise

// ---------- 2. État global ----------------------------------------------

const state = {
  balance: STARTING_BALANCE,
  bet: 0,
  shoe: [],            // toutes les cartes restantes
  cutIndex: 0,         // position de la carte de coupe (déclencheur de re-mélange)
  reshuffleAfter: false,
  player: [],
  dealer: [],
  phase: "betting",    // betting | playing | dealer | settled
  runningCount: 0,     // compte Hi-Lo (mis à jour à chaque carte visible)
  cardsSeen: 0,
  stats: { wins: 0, losses: 0, pushes: 0, blackjacks: 0, hands: 0 },
  theme: "dark",
  avatar: null,        // dataURL de la photo du joueur ou null
  counterHidden: false,
};

// ---------- 3. Persistance LocalStorage ---------------------------------

function saveState() {
  const persist = {
    balance: state.balance,
    stats: state.stats,
    theme: state.theme,
    avatar: state.avatar,
    counterHidden: state.counterHidden,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(persist));
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const data = JSON.parse(raw);
    if (typeof data.balance === "number") state.balance = data.balance;
    if (data.stats && typeof data.stats === "object") {
      state.stats = { ...state.stats, ...data.stats };
    }
    if (data.theme === "dark" || data.theme === "light") state.theme = data.theme;
    if (typeof data.avatar === "string" || data.avatar === null) state.avatar = data.avatar;
    if (typeof data.counterHidden === "boolean") state.counterHidden = data.counterHidden;
  } catch (e) {
    console.warn("État LocalStorage corrompu, ignoré.", e);
  }
}

// ---------- 4. Sabot multi-paquets --------------------------------------

/** Construit un paquet unique de 52 cartes. */
function buildSingleDeck() {
  // Produit cartésien via flatMap : 4 × 13 = 52 cartes
  return SUITS.flatMap((suit) =>
    RANKS.map((rank) => ({
      suit: suit.symbol,
      color: suit.color,
      label: rank.label,
      value: rank.value,
    }))
  );
}

/** Construit un sabot de NUM_DECKS paquets, mélangé. */
function buildShoe() {
  // Array.from + flatMap pour générer NUM_DECKS paquets
  const shoe = Array.from({ length: NUM_DECKS }).flatMap(() => buildSingleDeck());
  shuffle(shoe);
  return shoe;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** (Re)met en place un nouveau sabot et réinitialise compteur + carte de coupe. */
function freshShoe() {
  state.shoe = buildShoe();
  // Carte de coupe placée légèrement aléatoirement autour de CUT_RATIO
  const total = state.shoe.length;
  const offset = Math.floor((Math.random() * 0.05 - 0.025) * total);
  state.cutIndex = Math.floor(total * CUT_RATIO) + offset;
  state.reshuffleAfter = false;
  state.runningCount = 0;
  state.cardsSeen = 0;
}

/** Tire une carte du sommet du sabot (depuis la fin du tableau). */
function drawCard() {
  if (state.shoe.length === 0) freshShoe();
  const card = state.shoe.pop();
  // La carte de coupe est franchie quand le nombre restant passe sous (total - cutIndex)
  if (state.shoe.length <= (NUM_DECKS * 52 - state.cutIndex)) {
    state.reshuffleAfter = true;
  }
  return card;
}

// ---------- 5. Comptage Hi-Lo -------------------------------------------

/** Valeur Hi-Lo d'une carte : 2-6 → +1, 7-9 → 0, 10-A → -1. */
function hiLoValue(card) {
  const lowRanks  = ["2", "3", "4", "5", "6"];
  const highRanks = ["10", "J", "Q", "K", "A"];
  if (lowRanks.includes(card.label))  return 1;
  if (highRanks.includes(card.label)) return -1;
  return 0;
}

/** Met à jour le compteur quand une carte devient visible. */
function observeCard(card) {
  state.runningCount += hiLoValue(card);
  state.cardsSeen++;
  renderCounter();
}

/** Vrai compte = compte courant / paquets restants (arrondi 1 décimale). */
function trueCount() {
  const decksLeft = state.shoe.length / 52;
  if (decksLeft < 0.5) return state.runningCount; // évite divisions instables
  return state.runningCount / decksLeft;
}

// ---------- 6. Logique des mains ----------------------------------------

function handValue(hand) {
  let total = hand.reduce((sum, c) => sum + c.value, 0);
  let aces  = hand.filter((c) => c.label === "A").length;
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

function isBlackjack(hand) {
  return hand.length === 2 && handValue(hand) === 21;
}

// ---------- 7. Rendu DOM ------------------------------------------------

const $ = (id) => document.getElementById(id);

/** Crée un élément DOM représentant une carte. */
function createCardEl(card, faceDown = false) {
  const el = document.createElement("div");
  el.className = "card" + (card.color === "red" ? " red" : "")
                       + (faceDown ? " facedown" : "");
  el.innerHTML = `
    <div class="card-corner top">
      <span>${card.label}</span>
      <span>${card.suit}</span>
    </div>
    <div class="card-suit-big">${card.suit}</div>
    <div class="card-corner bottom">
      <span>${card.label}</span>
      <span>${card.suit}</span>
    </div>
  `;
  return el;
}

function renderHand(containerId, hand, hideHole = false) {
  const container = $(containerId);
  container.innerHTML = "";
  hand.forEach((card, idx) => {
    const faceDown = hideHole && idx === 1;
    container.appendChild(createCardEl(card, faceDown));
  });
}

function renderScores(hideDealer) {
  $("player-score").textContent = state.player.length ? handValue(state.player) : "—";
  if (hideDealer && state.dealer.length) {
    const up = state.dealer[0];
    $("dealer-score").textContent = up.value === 11 ? 11 : up.value;
  } else {
    $("dealer-score").textContent = state.dealer.length ? handValue(state.dealer) : "—";
  }
}

function renderHud(message, status) {
  $("balance").textContent = `${state.balance} €`;
  const msgEl = $("message");
  msgEl.textContent = message ?? "";
  msgEl.className = "message" + (status ? ` ${status}` : "");

  // Statistiques (template literal + map)
  const s = state.stats;
  const items = [
    ["Mains",      s.hands],
    ["Gagnées",    s.wins],
    ["Perdues",    s.losses],
    ["Égalités",   s.pushes],
    ["Blackjacks", s.blackjacks],
  ];
  $("stats").innerHTML = items
    .map(([k, v]) => `<span>${k} : <b>${v}</b></span>`)
    .join("");
}

function renderControls() {
  const isBetting = state.phase === "betting";
  const isPlaying = state.phase === "playing";
  $("actions").hidden  = !isPlaying;
  $("bet-form").hidden = !isBetting;

  const doubleBtn = document.querySelector('[data-action="double"]');
  if (doubleBtn) {
    doubleBtn.disabled =
      !isPlaying || state.player.length !== 2 || state.balance < state.bet;
  }
}

function renderTheme() {
  document.body.dataset.theme = state.theme;
  $("theme-icon").textContent = state.theme === "dark" ? "☀" : "☾";
}

/** Compteur de cartes (sidebar gauche). */
function renderCounter() {
  const decksLeft = state.shoe.length / 52;
  const total     = NUM_DECKS * 52;
  $("running-count").textContent = (state.runningCount > 0 ? "+" : "") + state.runningCount;
  $("true-count").textContent    = trueCount().toFixed(1);
  $("decks-left").textContent    = decksLeft.toFixed(1);
  $("cards-seen").textContent    = `${state.cardsSeen} / ${total}`;
  $("shoe-bar-fill").style.width = `${(state.cardsSeen / total) * 100}%`;
}

function renderCounterVisibility() {
  const body = $("counter-body");
  if (state.counterHidden) {
    body.classList.add("hidden-values");
    $("self-test").hidden = false;
  } else {
    body.classList.remove("hidden-values");
    $("self-test").hidden = true;
    $("guess-result").textContent = "";
  }
}

/** Avatar du joueur : photo prise au webcam ou silhouette par défaut. */
function renderAvatar() {
  const wrap = $("player-avatar");
  wrap.innerHTML = "";
  if (state.avatar) {
    const img = document.createElement("img");
    img.src = state.avatar;
    img.alt = "Avatar du joueur";
    wrap.appendChild(img);
  } else {
    // SVG silhouette (re-créé pour rester un cercle parfait)
    wrap.innerHTML = `
      <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="playerGrad2" cx="50%" cy="40%" r="65%">
            <stop offset="0%" stop-color="#1a1a1a" />
            <stop offset="100%" stop-color="#000000" />
          </radialGradient>
        </defs>
        <circle cx="32" cy="32" r="32" fill="url(#playerGrad2)" />
        <circle cx="32" cy="24" r="9" fill="#0a0a0a" />
        <path d="M14 60 Q32 38 50 60 Z" fill="#0a0a0a" />
      </svg>
    `;
  }
}

// ---------- 8. Pile de jetons sur la table ------------------------------

/** Décompose un montant en jetons standards. */
function chipBreakdown(amount) {
  const result = [];
  let remaining = amount;
  CHIP_DENOMS.forEach((d) => {
    while (remaining >= d) {
      result.push(d);
      remaining -= d;
    }
  });
  return result;
}

/**
 * Dessine la pile de jetons au centre de la table, avec un libellé du montant.
 * Limite l'affichage à 10 jetons pour rester lisible.
 */
function renderTableBet(amount) {
  const stage = $("table-bet");
  stage.className = "table-bet";
  stage.innerHTML = "";
  if (amount <= 0) {
    stage.classList.add("empty");
    return;
  }
  // Libellé du montant
  const label = document.createElement("div");
  label.className = "bet-amount";
  label.textContent = `${amount} €`;
  stage.appendChild(label);

  // Représentation des jetons (max 10 visibles, empilés avec offset vertical)
  const chips = chipBreakdown(amount).slice(0, 10);
  chips.forEach((d, idx) => {
    const chip = document.createElement("div");
    chip.className = "stack-chip";
    chip.dataset.d = d;
    chip.style.bottom = `${idx * 7}px`;
    stage.appendChild(chip);
  });
}

/** Anime la pile de jetons après résolution de la main. */
function animateBetResult(status) {
  const stage = $("table-bet");
  if (!stage.children.length) return;
  if (status === "win")  stage.classList.add("slide-win");
  if (status === "lose") stage.classList.add("slide-lose");
  if (status === "push") stage.classList.add("slide-push");
}

// ---------- 9. Chips (boutons de mise) ----------------------------------

function renderChips() {
  const container = $("chips");
  container.innerHTML = "";
  CHIP_VALUES
    .map((amount) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.dataset.amount = amount;
      chip.textContent = `${amount}`;
      chip.title = `Ajouter ${amount} € à la mise`;
      return chip;
    })
    .forEach((el) => container.appendChild(el));
}

// ---------- 10. Flux de jeu ---------------------------------------------

function startHand(bet) {
  if (!Number.isFinite(bet) || bet <= 0) {
    renderHud("Mise invalide.", "lose");
    return;
  }
  if (bet > state.balance) {
    renderHud(`Mise > solde (${state.balance} €).`, "lose");
    return;
  }

  state.bet = bet;
  state.balance -= bet;
  state.player = [];
  state.dealer = [];
  state.phase = "playing";

  // Si la carte de coupe est franchie, on remet un sabot neuf — et on
  // RÉINITIALISE le compteur (on a tout vu une fois).
  let reshuffleNotice = "";
  if (state.reshuffleAfter || state.shoe.length < 15) {
    freshShoe();
    reshuffleNotice = "Sabot rebattu — compteur reset. ";
  }

  // Distribution alternée — la carte cachée du croupier n'est PAS comptée.
  state.player.push(drawCard());  observeCard(state.player[0]);
  state.dealer.push(drawCard());  observeCard(state.dealer[0]); // up-card visible
  state.player.push(drawCard());  observeCard(state.player[1]);
  state.dealer.push(drawCard());  // hole card cachée → pas comptée pour l'instant

  renderHand("player-cards", state.player);
  renderHand("dealer-cards", state.dealer, true);
  renderScores(true);
  renderTableBet(state.bet);
  renderHud(reshuffleNotice + "À vous de jouer.", reshuffleNotice ? "push" : null);
  renderControls();

  if (isBlackjack(state.player)) finishHand();
}

function playerHit() {
  if (state.phase !== "playing") return;
  const card = drawCard();
  state.player.push(card);
  observeCard(card);
  renderHand("player-cards", state.player);
  renderScores(true);
  if (handValue(state.player) >= 21) finishHand();
  renderControls();
}

function playerStand() {
  if (state.phase !== "playing") return;
  finishHand();
}

function playerDouble() {
  if (state.phase !== "playing" || state.player.length !== 2) return;
  if (state.balance < state.bet) return;
  state.balance -= state.bet;
  state.bet *= 2;
  renderTableBet(state.bet);
  const card = drawCard();
  state.player.push(card);
  observeCard(card);
  renderHand("player-cards", state.player);
  renderScores(true);
  finishHand();
}

function dealerPlay() {
  state.phase = "dealer";
  // Révèle la carte cachée → on la prend en compte dans le compteur
  observeCard(state.dealer[1]);

  // Tire jusqu'à 17 (s'arrête sur un 17, soft inclus pour simplifier)
  while (handValue(state.dealer) < 17) {
    const card = drawCard();
    state.dealer.push(card);
    observeCard(card);
  }
}

function finishHand() {
  if (handValue(state.player) <= 21) {
    dealerPlay();
  } else {
    // Joueur burst : on révèle quand même la carte cachée pour le compteur
    observeCard(state.dealer[1]);
  }

  const playerTotal = handValue(state.player);
  const dealerTotal = handValue(state.dealer);
  const playerBJ = isBlackjack(state.player);
  const dealerBJ = isBlackjack(state.dealer);

  let message = "";
  let status  = "";

  if (playerTotal > 21) {
    message = `Vous brûlez à ${playerTotal}. Vous perdez ${state.bet} €.`;
    status = "lose"; state.stats.losses++;
  } else if (playerBJ && !dealerBJ) {
    const payout = Math.floor(state.bet * 2.5);
    state.balance += payout;
    message = `BLACKJACK ! Vous gagnez ${payout - state.bet} €.`;
    status = "win"; state.stats.wins++; state.stats.blackjacks++;
  } else if (dealerBJ && !playerBJ) {
    message = `Le croupier a un blackjack. Vous perdez ${state.bet} €.`;
    status = "lose"; state.stats.losses++;
  } else if (dealerTotal > 21) {
    state.balance += state.bet * 2;
    message = `Le croupier brûle à ${dealerTotal}. Vous gagnez ${state.bet} €.`;
    status = "win"; state.stats.wins++;
  } else if (playerTotal > dealerTotal) {
    state.balance += state.bet * 2;
    message = `${playerTotal} contre ${dealerTotal}. Vous gagnez ${state.bet} €.`;
    status = "win"; state.stats.wins++;
  } else if (playerTotal < dealerTotal) {
    message = `${playerTotal} contre ${dealerTotal}. Vous perdez ${state.bet} €.`;
    status = "lose"; state.stats.losses++;
  } else {
    state.balance += state.bet;
    message = `Égalité à ${playerTotal}. Mise rendue.`;
    status = "push"; state.stats.pushes++;
  }

  state.stats.hands++;
  state.phase = "settled";

  renderHand("dealer-cards", state.dealer, false);
  renderScores(false);
  renderHud(message, status);
  animateBetResult(status);

  // Filet de sécurité — on ne laisse jamais le joueur à 0 €
  if (state.balance <= 0) {
    setTimeout(() => {
      state.balance = STARTING_BALANCE;
      renderHud("Vous étiez ruiné — la maison vous re-crédite 100 €.", "push");
      saveState();
      goToBetting();
    }, 1500);
  } else {
    setTimeout(goToBetting, 1400);
  }
  saveState();
}

function goToBetting() {
  state.phase = "betting";
  state.bet = 0;
  $("table-bet").className = "table-bet empty";
  $("table-bet").innerHTML = "";
  renderHud("Placez votre mise pour commencer.", null);
  renderControls();
}

function resetSession() {
  if (!confirm("Réinitialiser le solde à 100 €, les stats et le sabot ?")) return;
  state.balance = STARTING_BALANCE;
  state.bet = 0;
  state.player = [];
  state.dealer = [];
  state.stats = { wins: 0, losses: 0, pushes: 0, blackjacks: 0, hands: 0 };
  state.phase = "betting";
  freshShoe();
  $("player-cards").innerHTML = "";
  $("dealer-cards").innerHTML = "";
  $("table-bet").innerHTML = "";
  renderScores(false);
  renderCounter();
  renderHud("Session réinitialisée.", "push");
  renderControls();
  saveState();
}

// ---------- 11. Webcam : capture d'avatar -------------------------------

let camStream = null;

function openCamera() {
  $("camera-modal").hidden = false;
  $("cam-preview").hidden = true;
  $("cam-canvas").hidden  = true;
  $("cam-video").hidden   = false;
  $("cam-shoot").disabled = true;
  $("cam-save").hidden    = true;
}

function closeCamera() {
  $("camera-modal").hidden = true;
  stopCamera();
}

function stopCamera() {
  if (camStream) {
    camStream.getTracks().forEach((t) => t.stop());
    camStream = null;
  }
}

async function startCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert("Votre navigateur ne supporte pas l'accès à la caméra.");
    return;
  }
  try {
    camStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: 320, height: 320 },
      audio: false,
    });
    const video = $("cam-video");
    video.srcObject = camStream;
    $("cam-shoot").disabled = false;
  } catch (err) {
    alert("Impossible d'accéder à la caméra : " + err.message);
  }
}

function shootPhoto() {
  const video  = $("cam-video");
  const canvas = $("cam-canvas");
  const size   = 240;
  canvas.width  = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  // Calcule le crop carré centré
  const vw = video.videoWidth, vh = video.videoHeight;
  const s  = Math.min(vw, vh);
  const sx = (vw - s) / 2, sy = (vh - s) / 2;
  ctx.drawImage(video, sx, sy, s, s, 0, 0, size, size);

  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  $("cam-preview").src = dataUrl;
  $("cam-preview").hidden = false;
  $("cam-video").hidden = true;
  $("cam-save").hidden = false;
  $("cam-shoot").disabled = true;
  $("cam-save").dataset.url = dataUrl;
}

function saveAvatar() {
  state.avatar = $("cam-save").dataset.url;
  renderAvatar();
  saveState();
  closeCamera();
}

function clearAvatar() {
  state.avatar = null;
  renderAvatar();
  saveState();
}

// ---------- 12. Événements ----------------------------------------------

function bindEvents() {
  // (1) submit — formulaire de mise
  $("bet-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const value = parseInt($("bet-input").value, 10);
    startHand(value);
  });

  // (2) click — actions de jeu (Hit / Stand / Double)
  $("actions").addEventListener("click", (e) => {
    const action = e.target.dataset.action;
    if (!action) return;
    if (action === "hit")    playerHit();
    if (action === "stand")  playerStand();
    if (action === "double") playerDouble();
  });

  // click — jetons : ajoutent leur valeur à la mise saisie
  $("chips").addEventListener("click", (e) => {
    const amount = parseInt(e.target.dataset.amount, 10);
    if (!amount) return;
    const input = $("bet-input");
    const current = parseInt(input.value, 10) || 0;
    // Plus de plafond fixe à 100 € — uniquement le solde du joueur
    const next = Math.min(current + amount, state.balance);
    input.value = next;
  });

  // click — bouton "Effacer la mise"
  $("clear-bet").addEventListener("click", () => {
    $("bet-input").value = 0;
  });

  // (3) keyup — raccourcis H / S / D
  document.addEventListener("keyup", (e) => {
    if (state.phase !== "playing") return;
    if (e.target.tagName === "INPUT") return;
    const k = e.key.toLowerCase();
    if (k === "h") playerHit();
    if (k === "s") playerStand();
    if (k === "d") playerDouble();
  });

  // (4) change — validation finale du champ mise
  $("bet-input").addEventListener("change", (e) => {
    let v = parseInt(e.target.value, 10);
    if (Number.isNaN(v) || v < 0) v = 0;
    if (v > state.balance) v = state.balance;
    e.target.value = v;
  });

  // (5) input — feedback immédiat (limite douce au solde)
  $("bet-input").addEventListener("input", (e) => {
    const v = parseInt(e.target.value, 10);
    if (!Number.isNaN(v) && v > state.balance) {
      e.target.value = state.balance;
    }
  });

  // Bascule du thème
  $("theme-toggle").addEventListener("click", () => {
    state.theme = state.theme === "dark" ? "light" : "dark";
    renderTheme();
    saveState();
  });

  // Réinitialisation de session
  $("reset-btn").addEventListener("click", resetSession);

  // Bouton de masquage du compteur (mode auto-test)
  $("toggle-counter").addEventListener("click", () => {
    state.counterHidden = !state.counterHidden;
    renderCounterVisibility();
    saveState();
  });

  // Vérification de l'estimation du joueur
  $("guess-btn").addEventListener("click", () => {
    const guess = parseInt($("guess-input").value, 10);
    const result = $("guess-result");
    if (Number.isNaN(guess)) {
      result.textContent = "Saisissez un nombre.";
      result.className = "self-test-result ko";
      return;
    }
    if (guess === state.runningCount) {
      result.textContent = `✓ Exact ! Compte = ${state.runningCount}`;
      result.className = "self-test-result ok";
    } else {
      result.textContent = `✗ Faux. Vrai compte courant : ${state.runningCount}`;
      result.className = "self-test-result ko";
    }
  });

  // Caméra : ouverture / activation / capture / sauvegarde / nettoyage
  $("camera-btn").addEventListener("click", openCamera);
  $("cam-close").addEventListener("click", closeCamera);
  $("cam-start").addEventListener("click", startCamera);
  $("cam-shoot").addEventListener("click", shootPhoto);
  $("cam-save").addEventListener("click", saveAvatar);
  $("cam-clear").addEventListener("click", () => {
    clearAvatar();
    closeCamera();
  });
}

// ---------- 13. Initialisation ------------------------------------------

function init() {
  loadState();
  freshShoe();
  renderTheme();
  renderAvatar();
  renderChips();
  renderCounter();
  renderCounterVisibility();
  bindEvents();
  renderHud("Placez votre mise pour commencer.", null);
  renderControls();
}

init();

(() => {
  const STYLE_ID = "productivity-loading-style";

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
#loading-screen{
  position: fixed;
  inset: 0;
  z-index: 999999;
  background: rgba(0,0,0,.5);
  display: none;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
}
#loading-screen.is-visible{ display:flex; }

/* bloque toute interaction sur la page */
body.productivity-is-loading{ overflow: hidden; }
body.productivity-is-loading > :not(#loading-screen){
  pointer-events: none;
  user-select: none;
}

#loading-screen .loading-card{
  background: rgba(20,20,20,.92);
  border: 1px solid rgba(255,255,255,.10);
  border-radius: 14px;
  padding: 20px 22px;
  min-width: 260px;
  max-width: 420px;
  text-align: center;
  box-shadow: 0 14px 50px rgba(0,0,0,.55);
}

#loading-screen .spinner{
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 4px solid rgba(255,255,255,.25);
  border-top-color: rgba(255,255,255,.95);
  animation: product-loading-spin .9s linear infinite;
  margin: 0 auto;
}

#loading-screen .loading-msg{
  margin-top: 12px;
  font: 600 14px/1.35 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
  color: rgba(255,255,255,.92);
}

@keyframes product-loading-spin{ to{ transform: rotate(360deg); } }
`; 
    document.head.appendChild(style);
  }

  function ensureMarkup(loadingScreen) {
    // Si tu as déjà ton propre HTML dans #loading-screen, supprime ce block.
    if (loadingScreen.querySelector(".loading-card")) return;

    const card = document.createElement("div");
    card.className = "loading-card";

    const spinner = document.createElement("div");
    spinner.className = "spinner";

    const msg = document.createElement("div");
    msg.className = "loading-msg";
    msg.textContent = "Chargement…";

    card.appendChild(spinner);
    card.appendChild(msg);

    loadingScreen.textContent = "";
    loadingScreen.appendChild(card);
  }

  function showLoading(message = "Chargement…") {
    const loadingScreen = document.getElementById("loading-screen");
    if (!loadingScreen) return;

    ensureStyles();
    ensureMarkup(loadingScreen);

    const msgEl = loadingScreen.querySelector(".loading-msg");
    if (msgEl) msgEl.textContent = message;

    document.body.classList.add("productivity-is-loading");
    loadingScreen.classList.add("is-visible");

    // a11y
    loadingScreen.setAttribute("role", "dialog");
    loadingScreen.setAttribute("aria-live", "polite");
    loadingScreen.setAttribute("aria-label", "Chargement");
  }

  function hideLoading() {
    const loadingScreen = document.getElementById("loading-screen");
    if (!loadingScreen) return;

    loadingScreen.classList.remove("is-visible");
    document.body.classList.remove("productivity-is-loading");
  }

  function setMessage(m) {
    const loadingScreen = document.getElementById("loading-screen");
    if (!loadingScreen) return;

    ensureStyles();
    ensureMarkup(loadingScreen);

    const el = loadingScreen.querySelector(".loading-msg");
    if (el) el.textContent = String(m ?? "");
  }

  // Expose une mini API globale (pratique côté CEP/JSX)
  // -> dispo immédiatement, même si tu appelles avant DOMContentLoaded
  window.ProductivityLoading = {
    show: showLoading,
    hide: hideLoading,
    setMessage,
    isVisible: () => !!document.getElementById("loading-screen")?.classList.contains("is-visible")
  };

  // Alias simples (si tu préfères appeler des fonctions directes)
  window.showLoadingScreen = showLoading;
  window.setLoadingMessage = setMessage;
  window.hideLoadingScreen = hideLoading;
    // Signal "ready" pour les autres fichiers (utile si un script s'exécute avant que loading.js ne soit évalué)
  try {
    window.dispatchEvent(new Event("ProductivityLoadingReady"));
  } catch (e) {
    // ignore
  }


})();


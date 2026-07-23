// ==UserScript==
// @name         Leitor Infinito de Mangá
// @version      1.2
// @description  Rolagem infinita, lazy loading e interface minimalista para leitura de mangás
// @match        *://toonlivre.net/*
// @match        *://*.toonlivre.net/*
// @run-at       document-start
// @require      https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.2.0/crypto-js.min.js
// @license      MIT
// ==/UserScript==

(function () {
  "use strict";

  (function () {
    var _origSetInterval = window.setInterval;
    var _origSetTimeout = window.setTimeout;
    var _origRaf = window.requestAnimationFrame;
    function _hasDbg(fn) {
      try { return /\bdebugger\b/.test(fn.toString()); } catch (e) { return false; }
    }
    window.setInterval = function (fn, d) {
      if (typeof fn === "function" && d < 2000 && _hasDbg(fn)) return 0;
      return _origSetInterval.call(window, fn, d);
    };
    window.setTimeout = function (fn, d) {
      if (typeof fn === "function" && d < 2000 && _hasDbg(fn)) return 0;
      return _origSetTimeout.call(window, fn, d);
    };
    window.requestAnimationFrame = function (fn) {
      if (typeof fn === "function" && _hasDbg(fn)) return 0;
      return _origRaf.call(window, fn);
    };
    function _wrapConsole(orig) {
      return function () {
        if (arguments.length > 1 && typeof arguments[0] === "string" && arguments[0].indexOf("%c") !== -1) return;
        return orig.apply(console, arguments);
      };
    }
    console.log = _wrapConsole(console.log);
    console.warn = _wrapConsole(console.warn);
    console.error = _wrapConsole(console.error);
  })();

  const AUTO_START = true;
  const STORAGE_KEY = "mangalivre_custom_lib_v1";
  const AUTO_SCROLL_SPEEDS = [1.9, 3.4];
  const SCROLL_THRESHOLD = 10000;
  const SCROLL_INTERVAL = 16;
  const DOUBLE_TAP_DELAY = 300;
  const EAGER_LOAD_COUNT = 5;
  const SAVE_DEBOUNCE_DELAY = 500;
  const MAX_LIBRARY_SIZE = 100;
  const AD_SELECTOR =
    'iframe, object, embed, [id*="google_ads"], [id*="ad-"], [class*="ads"], [class*="ad-"]';

  const SITES = [
    {
      id: "toonlivre",
      domain: /^https?:\/\/([a-z0-9-]+\.)?toonlivre\.net/,
      apiUrl: "https://toonlivre.net/api",
      _signature: null,
      _sigPromise: null,
      _cryptoKey: null,
      _cryptoKeyDate: null,
      ensureSignature: function () {
        const self = this;
        if (self._signature) return Promise.resolve(self._signature);
        if (self._sigPromise) return self._sigPromise;
        self._sigPromise = fetch(self.apiUrl + "/seed", {
          credentials: "include",
          headers: { Accept: "application/json" },
        })
          .then(function (r) {
            return r.json();
          })
          .then(
            function (data) {
              console.log("[TL] seed body:", JSON.stringify(data).slice(0, 80));
              let sig =
                data.signature || data.token || data.key || data.seed || "";
              if (
                !sig &&
                typeof data === "string" &&
                data.split(".").length === 3
              )
                sig = data;
              self._signature = sig;
              self._sigPromise = null;
              return sig;
            },
            function (err) {
              self._sigPromise = null;
              throw err;
            },
          );
        return self._sigPromise;
      },
      _getCryptoKey: function () {
        const self = this;
        const today = new Date().toISOString().slice(0, 10);
        if (self._cryptoKey && self._cryptoKeyDate === today)
          return self._cryptoKey;
        const s = today + "toonlivre.net::w3" + "r7_5m2_k";
        const hash = CryptoJS.SHA256(s).toString(CryptoJS.enc.Hex).slice(0, 8);
        self._cryptoKey = "Phantom-Tide-Harvest8" + hash;
        self._cryptoKeyDate = today;
        return self._cryptoKey;
      },
      apiFetch: function (path) {
        const self = this;
        return self.ensureSignature().then(function (sig) {
          return fetch(self.apiUrl + path, {
            credentials: "include",
            headers: {
              Accept: "application/json",
              "x-toon-signature": sig,
            },
          }).then(function (r) {
            console.log("[TL] apiFetch response", path, r.status);
            const sig2 = r.headers.get("x-toon-signature");
            if (sig2) {
              console.log("[TL] refreshed signature");
              self._signature = sig2;
            }
            const dataKey = r.headers.get("x-toon-datakey");
            if (dataKey && r.ok) {
              console.log("[TL] decrypting", path, "key:", dataKey);
              return r.json().then(function (body) {
                const enc = body && body[dataKey];
                if (!enc) return body;
                const pass = self._getCryptoKey();
                const dec = CryptoJS.Rabbit.decrypt(enc, pass).toString(
                  CryptoJS.enc.Utf8,
                );
                if (!dec) return body;
                const result = JSON.parse(dec);
                console.log(
                  "[TL] decrypted OK, keys:",
                  Object.keys(result).join(","),
                );
                return result;
              });
            }
            return r.json();
          });
        });
      },
      isChapterPage: function () {
        var match = window.location.pathname.match(
          /^\/([\w-]+)\/([\d]+(?:[\.\-][\d]+)?)/,
        );
        return match !== null;
      },
      getTitle: function () {
        var match = window.location.pathname.match(/^\/([\w-]+)\/[\d]+/);
        if (match) {
          return match[1].replace(/-/g, " ").replace(/\b\w/g, function (c) {
            return c.toUpperCase();
          });
        }
        return document.title.trim();
      },
      getMangaId: function () {
        var match = window.location.pathname.match(/^\/([\w-]+)\/[\d]+/);
        return match ? match[1] : null;
      },
      getChapterNumber: function () {
        var match = window.location.pathname.match(
          /^\/([\w-]+)\/([\d]+(?:[\.\-][\d]+)?)/,
        );
        return match ? match[2].replace(/-/g, ".") : null;
      },
      fetchChapterPages: function (mangaSlug, chapterNum) {
        const self = this;
        return self
          .apiFetch("/manga-by-slug/" + mangaSlug)
          .then(function (data) {
            if (!data || !data.chapters) return null;
            const chs = data.chapters;
            console.log(
              "[TL] fetching ch",
              chapterNum,
              "total chapters:",
              chs.length,
              "sample:",
              chs[0] ? chs[0].number + "/" + chs[0].id : "none",
            );
            let idx = -1;
            for (let i = 0; i < chs.length; i++) {
              const an = String(chs[i].number).replace(/^0+/, "") || "0";
              const bn = String(chapterNum).replace(/^0+/, "") || "0";
              if (an === bn) {
                idx = i;
                break;
              }
            }
            if (idx === -1) {
              console.log("[TL] chapter", chapterNum, "not found");
              return null;
            }
            const ch = chs[idx];
            const isDesc =
              chs.length > 1 &&
              !isNaN(Number(chs[0].number)) &&
              Number(chs[0].number) > Number(chs[chs.length - 1].number);
            const nextIdx = isDesc ? idx - 1 : idx + 1;
            const nextCh =
              nextIdx >= 0 && nextIdx < chs.length ? chs[nextIdx] : null;
            console.log(
              "[TL] ch match idx:",
              idx,
              "nextIdx:",
              nextIdx,
              "isDesc:",
              isDesc,
              "nextNum:",
              nextCh ? nextCh.number : "none",
            );
            return self
              .apiFetch("/mangas/" + data.id + "/chapters/" + ch.id)
              .then(function (pageData) {
                return {
                  pages: pageData.pages || [],
                  nextChapter: nextCh
                    ? {
                        mangaSlug: mangaSlug,
                        chapterNum: nextCh.number,
                        url:
                          window.location.origin +
                          "/" +
                          mangaSlug +
                          "/" +
                          nextCh.number,
                      }
                    : null,
                  title: data.title,
                };
              });
          });
      },
    },
  ];

  var activeSite = null;
  var isZenModeActive = false;
  var isChapterLoading = false;
  var currentFetchPromise = null;
  var isUiVisible = true;
  var currentTitle = "";
  var urlObserver = null;
  var lastPersistedChapter = null;
  var isAutoScrollEnabled = false;
  var autoScrollSpeedIndex = 1;
  var lastTapTimestamp = 0;
  var tapCount = 0;
  var touchStartY = 0;
  var touchMoved = false;
  var onScrollHandler = null;
  var onWheelHandler = null;
  var onBeforeUnloadHandler = null;
  var autoScrollAnimationFrameId = null;
  var statusHud = null;
  var loaderBar = null;
  var autoScrollButton = null;
  var saveDebounceTimeout = null;
  var doubleTapTimer = null;
  var loaderHideTimeout = null;
  var lazyLoadIntersectionObserver = null;
  var onModalClose = null;
  var adCleaner = null;
  var adBlockClickHandler = null;
  var uiToggleClickHandler = null;
  var readerEatClickHandler = null;
  var autoScrollTouchStartHandler = null;
  var autoScrollTouchMoveHandler = null;
  var autoScrollTouchEndHandler = null;
  var autoScrollTouchCancelHandler = null;
  var pendingNextChapter = null;
  var _readerSession = 0;
  var _origPushState = history.pushState,
    _origReplaceState = history.replaceState;

  function isValidMangaUrl(url) {
    for (let i = 0; i < SITES.length; i++) {
      if (SITES[i].domain.test(url)) return true;
    }
    return false;
  }

  function detectSite() {
    var url = window.location.href;
    for (let i = 0; i < SITES.length; i++) {
      if (SITES[i].domain.test(url)) return SITES[i];
    }
    return null;
  }

  const styleElement = document.createElement("style");
  styleElement.id = "mangalivre-custom-styles";
  styleElement.textContent = `
        img[data-src] {
            background: linear-gradient(90deg, #111 25%, #1a1a1a 50%, #111 75%);
            background-size: 200% 100%;
            animation: loading 1.5s infinite;
            min-height: 500px;
            width: 100%;
        }

        @keyframes loading {
            0% { background-position: 200% 0; }
            100% { background-position: -200% 0; }
        }

        .manga-fab-btn {
            position: fixed;
            z-index: 10000;
            cursor: pointer;
            transition: opacity 0.3s ease, transform 0.3s ease;
            opacity: 1;
            background: #222;
            color: white;
            border: 1px solid #444;
            border-radius: 50%;
            width: 48px;
            height: 48px;
            min-width: 48px;
            min-height: 48px;
            display: flex;
            align-items: center;
            justify-content: center;
            text-shadow: 0 2px 4px rgba(0,0,0,0.3);
            font-size: 20px;
            font-weight: bold;
            font-family: sans-serif;
        }
        .manga-fab-btn:hover {
            opacity: 0.8;
        }
        .manga-fab-btn:active {
            transform: scale(0.95);
            transition: transform 0.1s ease, opacity 0.1s ease;
        }
        .manga-fab-hidden { opacity: 0 !important; pointer-events: none; }
        .manga-modal {
            position: fixed;
            bottom: 80px;
            left: 20px;
            width: 300px;
            max-height: 400px;
            background: #1a1a1a;
            border: 1px solid #333;
            border-radius: 10px;
            z-index: 10001;
            overflow-y: auto;
            scroll-behavior: smooth;
            -webkit-overflow-scrolling: touch;
            box-shadow: 0 10px 30px rgba(0,0,0,0.8);
            color: #eee;
            font-family: sans-serif;
        }
        .manga-modal-header {
            padding: 15px;
            border-bottom: 1px solid #333;
            font-weight: bold;
        }
        .manga-modal-row {
            display: block;
            padding: 15px;
            border-bottom: 1px solid #2a2a2a;
            text-decoration: none;
            color: inherit;
        }
        body { background-color: #050505; margin: 0; padding: 0; font-family: -apple-system, sans-serif; }
        .manga-container { width: 100%; display: flex; flex-direction: column; align-items: center; min-height: 100vh; padding-bottom: 100px; }
        img { max-width: 100%; height: auto; display: block; touch-action: pan-y pinch-zoom; user-select: none; -webkit-user-select: none; pointer-events: auto; }

        #manga-hud {
            position: fixed;
            top: max(10px, env(safe-area-inset-top));
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0, 0, 0, 0.8);
            backdrop-filter: blur(4px);
            padding: 4px 12px;
            border-radius: 20px;
            border: 1px solid rgba(255,255,255,0.05);
            color: #aaa;
            font-size: 11px;
            font-weight: 500;
            letter-spacing: 0.5px;
            pointer-events: none;
            z-index: 10002;
            transition: opacity 0.3s ease;
        }

        #manga-loader { position: fixed; top: 0; left: 0; height: 2px; background: #ff5500; width: 0%; transition: width 0.2s; z-index: 10003; }

        .manga-chapter-wrapper {
            width: 100%;
            display: flex;
            flex-direction: column;
            align-items: center;
            min-height: 500px;
        }
        .manga-chapter-divider {
            width: 100%;
            padding: 20px 0;
            text-align: center;
            color: #ff5500;
            font-size: 18px;
            font-weight: bold;
            text-transform: uppercase;
            position: relative;
            margin: 30px 0;
            letter-spacing: 1px;
        }
        .manga-chapter-divider::after {
            content: '';
            position: absolute;
            bottom: 0;
            left: 50%;
            transform: translateX(-50%);
            width: 100%;
            height: 1px;
            background: linear-gradient(to right, transparent, #ff5500, transparent);
        }
        .manga-end-message {
            width: 100%;
            padding: 40px 20px;
            text-align: center;
            color: #ff5500;
            font-size: 16px;
            font-weight: bold;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin: 20px 0;
        }

        #manga-autoscroll-btn {
            bottom: max(20px, env(safe-area-inset-bottom));
            left: 80px;
        }

        #manga-exit-btn {
            top: max(20px, env(safe-area-inset-top));
            right: 20px;
        }

        #manga-library-btn {
            bottom: max(20px, env(safe-area-inset-bottom));
            left: 20px;
        }
    `;

  const linkElement = document.createElement("link");
  linkElement.rel = "stylesheet";
  linkElement.href =
    "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css";
  linkElement.id = "mangalivre-fontawesome";

  function injectStylesToHead() {
    if (!document.getElementById("mangalivre-fontawesome")) {
      document.head.appendChild(linkElement);
    }
    if (!document.getElementById("mangalivre-custom-styles")) {
      document.head.appendChild(styleElement);
    }
  }

  function initLazyLoadObserver() {
    if ("IntersectionObserver" in window && !lazyLoadIntersectionObserver) {
      console.log(
        "[TL] initLazyLoadObserver — criando observer com rootMargin 500px",
      );
      lazyLoadIntersectionObserver = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) {
              var img = entry.target;
              var src = img.dataset.src;
              if (src) {
                img.src = src;
                img.removeAttribute("data-src");
                lazyLoadIntersectionObserver.unobserve(img);
              }
            }
          });
        },
        { rootMargin: "500px" },
      );
    }
  }

  var allowedDomains = [
    "toonlivre.net",
    "cdnjs.cloudflare.com",
    "fonts.googleapis.com",
    "fonts.gstatic.com",
  ];
  function isAllowed(url) {
    try {
      var host = new URL(url, location.href).hostname;
      return allowedDomains.some(function (d) {
        return host === d || host.endsWith("." + d);
      });
    } catch (e) {
      return false;
    }
  }

  (function () {
    var _origFetch = window.fetch;
    window.fetch = function (url, opts) {
      var u = typeof url === "string" ? url : url && url.url ? url.url : "";
      if (u.includes("/api/pub") || (u && !isAllowed(u))) {
        console.log("[TL] blocked fetch:", u);
        return Promise.resolve(new Response("{}", { status: 204 }));
      }
      return _origFetch.call(window, url, opts);
    };
    var _origXhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function () {
      if (
        arguments[1] &&
        typeof arguments[1] === "string" &&
        !isAllowed(arguments[1])
      ) {
        console.log("[TL] blocked XHR:", arguments[1]);
        arguments[1] = "about:blank";
      }
      return _origXhrOpen.apply(this, arguments);
    };
    var _origSendBeacon = navigator.sendBeacon;
    navigator.sendBeacon = function (url, data) {
      if (url && typeof url === "string" && !isAllowed(url)) {
        console.log("[TL] blocked beacon:", url);
        return false;
      }
      return _origSendBeacon.call(this, url, data);
    };
    window.open = function () { return null; };
  })();

  var _adBlockOverrides = false;
  function applyAdBlockers() {
    if (_adBlockOverrides) {
      if (adCleaner) adCleaner.disconnect();
      if (adBlockClickHandler) {
        document.removeEventListener("click", adBlockClickHandler, true);
      }
    }
    _adBlockOverrides = true;
    Array.from(document.querySelectorAll(AD_SELECTOR)).forEach(function (el) {
      el.remove();
    });
    document.addEventListener(
      "click",
      (adBlockClickHandler = function (e) {
        var t = e.target;
        for (let i = 0; i < 10 && t; i++) {
          if (t.tagName === "A" && t.href && !isAllowed(t.href)) {
            e.preventDefault();
            e.stopPropagation();
            break;
          }
          t = t.parentElement;
        }
      }),
      true,
    );
    adCleaner = new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        m.addedNodes.forEach(function (n) {
          if (n.nodeType === 1) {
            var el = n;
            if (el.matches && el.matches(AD_SELECTOR)) {
              el.remove();
            }
            if (el.querySelectorAll) {
              Array.from(el.querySelectorAll(AD_SELECTOR)).forEach(
                function (sub) {
                  sub.remove();
                },
              );
            }
          }
        });
      });
    });
    adCleaner.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  applyAdBlockers();
  injectStylesToHead();
  if (document.body) createLibraryButton();

  function getLibrary() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const lib = JSON.parse(raw || "{}");
      const validLib = {};
      Object.keys(lib).forEach(function (key) {
        const item = lib[key];
        if (item.lastUrl && isValidMangaUrl(item.lastUrl)) {
          validLib[key] = item;
        }
      });
      console.log("[TL] getLibrary:", Object.keys(validLib).length, "entries");
      return validLib;
    } catch (e) {
      console.error("[TL] erro ao carregar biblioteca:", e);
      return {};
    }
  }

  function saveLibraryToStorage(lib) {
    try {
      const entries = Object.entries(lib).sort(function (a, b) {
        return b[1].timestamp - a[1].timestamp;
      });
      if (entries.length > MAX_LIBRARY_SIZE) {
        const trimmedLib = {};
        entries.slice(0, MAX_LIBRARY_SIZE).forEach(function (entry) {
          trimmedLib[entry[0]] = entry[1];
        });
        localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmedLib));
        console.log("[TL] saveLibrary: trimmed to", MAX_LIBRARY_SIZE);
      } else {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(lib));
        console.log("[TL] saveLibrary:", entries.length, "entries");
      }
      return true;
    } catch (e) {
      console.error("[TL] erro ao salvar localStorage:", e);
      return false;
    }
  }

  function saveReadingProgress(url, chapterNum) {
    if (!currentTitle || !url || !chapterNum) {
      console.log("[TL] saveReadingProgress skipped: missing data", {
        t: !!currentTitle,
        u: !!url,
        c: !!chapterNum,
      });
      return;
    }
    clearTimeout(saveDebounceTimeout);
    saveDebounceTimeout = setTimeout(function () {
      try {
        var sanitizedTitle = currentTitle.trim().substring(0, 200);
        var sanitizedChapter = String(chapterNum).substring(0, 50);
        var slug = currentTitle
          .trim()
          .toLowerCase()
          .replace(/\s+/g, "-")
          .replace(/[^\w\-]+/g, "");
        console.log(
          "[TL] saving progress:",
          sanitizedTitle,
          "cap",
          sanitizedChapter,
        );
        var lib = getLibrary();
        if (
          Object.keys(lib).length === 0 &&
          localStorage.getItem(STORAGE_KEY)
        ) {
          console.warn(
            "[TL] getLibrary returned empty but localStorage has data — aborting save to prevent data loss",
          );
          return;
        }
        lib[slug] = {
          slug: slug,
          lastChapter: sanitizedChapter,
          lastUrl: url,
          title: sanitizedTitle,
          timestamp: Date.now(),
        };
        console.log(
          "[TL] salvando biblioteca — slug:",
          slug,
          "cap:",
          sanitizedChapter,
        );
        saveLibraryToStorage(lib);
      } catch (e) {
        console.error("[TL] erro ao salvar progresso:", e);
      }
    }, SAVE_DEBOUNCE_DELAY);
  }

  function createReaderUI() {
    console.log("[TL] createReaderUI — criando HUD, loader, botoes");
    statusHud = document.createElement("div");
    statusHud.id = "manga-hud";
    statusHud.textContent = "Carregando...";
    document.body.appendChild(statusHud);

    loaderBar = document.createElement("div");
    loaderBar.id = "manga-loader";
    document.body.appendChild(loaderBar);

    autoScrollButton = document.createElement("div");
    autoScrollButton.className = "manga-fab-btn";
    autoScrollButton.id = "manga-autoscroll-btn";
    autoScrollButton.addEventListener("click", function (e) {
      e.stopPropagation();
      toggleAutoScroll();
    });
    autoScrollButton.addEventListener("contextmenu", function (e) {
      e.preventDefault();
      e.stopPropagation();
      cycleAutoScrollSpeed();
    });
    autoScrollButton.addEventListener(
      "touchstart",
      (autoScrollTouchStartHandler = handleAutoScrollTouchStart),
      { passive: true },
    );
    autoScrollButton.addEventListener(
      "touchmove",
      (autoScrollTouchMoveHandler = handleAutoScrollTouchMove),
      { passive: true },
    );
    autoScrollButton.addEventListener(
      "touchend",
      (autoScrollTouchEndHandler = handleAutoScrollTouchEnd),
    );
    autoScrollButton.addEventListener(
      "touchcancel",
      (autoScrollTouchCancelHandler = handleAutoScrollTouchCancel),
    );
    document.body.appendChild(autoScrollButton);
    updateAutoScrollButtonIcon();

    var exitBtn = document.createElement("div");
    exitBtn.className = "manga-fab-btn";
    exitBtn.id = "manga-exit-btn";
    var exitIcon = document.createElement("i");
    exitIcon.className = "fas fa-arrow-left";
    exitBtn.appendChild(exitIcon);
    exitBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      var currentUrl = window.location.href;
      var seriesUrl = window.location.origin;
      try {
        var parsed = new URL(currentUrl);
        var pathParts = parsed.pathname.split("/").filter(Boolean);
        seriesUrl = parsed.origin + "/" + pathParts[0];
      } catch(e) {
        seriesUrl = window.location.origin;
      }
      console.log("[TL] exit — navegando para", seriesUrl);
      window.location.href = seriesUrl;
    });
    document.body.appendChild(exitBtn);

    document.addEventListener(
      "click",
      (uiToggleClickHandler = function (e) {
        if (
          e.target.closest("#manga-lib-modal") ||
          e.target.closest(".manga-fab-btn")
        )
          return;
        console.log("[TL] toggle UI visibility");
        toggleReaderUI();
      }),
    );

    console.log("[TL] createReaderUI completo");
    return { hud: statusHud };
  }

  function toggleReaderUI() {
    isUiVisible = !isUiVisible;
    console.log(
      "[TL] toggleReaderUI — agora",
      isUiVisible ? "visivel" : "oculto",
    );
    var els = document.querySelectorAll(".manga-fab-btn, #manga-hud");
    Array.from(els).forEach(function (el) {
      return el.classList.toggle("manga-fab-hidden", !isUiVisible);
    });
  }

  function cycleAutoScrollSpeed() {
    autoScrollSpeedIndex =
      (autoScrollSpeedIndex + 1) % AUTO_SCROLL_SPEEDS.length;
    console.log(
      "[TL] cycleAutoScrollSpeed — velocidade",
      AUTO_SCROLL_SPEEDS[autoScrollSpeedIndex],
    );
    updateAutoScrollButtonIcon();
  }

  function toggleAutoScroll() {
    isAutoScrollEnabled = !isAutoScrollEnabled;
    console.log(
      "[TL] toggleAutoScroll —",
      isAutoScrollEnabled ? "ligado" : "desligado",
    );
    if (isAutoScrollEnabled) {
      startAutoScrollLoop();
    } else {
      if (autoScrollAnimationFrameId) {
        cancelAnimationFrame(autoScrollAnimationFrameId);
        autoScrollAnimationFrameId = null;
      }
    }
    updateAutoScrollButtonIcon();
  }

  function handleAutoScrollTouchStart(e) {
    console.log("[TL] touchStart no autoScroll");
    touchStartY = e.touches[0].clientY;
    touchMoved = false;
  }

  function handleAutoScrollTouchMove(e) {
    var touchY = e.touches[0].clientY;
    if (Math.abs(touchY - touchStartY) > 10) {
      touchMoved = true;
      console.log("[TL] touchMove — movimento detectado, cancelando tap");
    }
  }

  function handleAutoScrollTouchEnd(e) {
    if (touchMoved) {
      console.log("[TL] touchMove detectado, ignorando tap");
      return;
    }
    console.log(
      "[TL] touchEnd — tap no autoScroll, timeDiff:",
      Date.now() - lastTapTimestamp,
      "tapCount:",
      tapCount,
    );
    e.preventDefault();
    e.stopPropagation();
    var currentTime = Date.now();
    var timeDiff = currentTime - lastTapTimestamp;
    clearTimeout(doubleTapTimer);
    if (timeDiff < DOUBLE_TAP_DELAY && tapCount === 1) {
      cycleAutoScrollSpeed();
      tapCount = 0;
    } else {
      tapCount = 1;
      doubleTapTimer = setTimeout(function () {
        if (tapCount === 1) toggleAutoScroll();
        tapCount = 0;
      }, DOUBLE_TAP_DELAY);
    }
    lastTapTimestamp = currentTime;
  }

  function handleAutoScrollTouchCancel() {
    touchMoved = false;
    tapCount = 0;
    clearTimeout(doubleTapTimer);
  }

  function updateAutoScrollButtonIcon() {
    if (!autoScrollButton) return;
    var icon = document.createElement("i");
    icon.className = "fas";
    if (!isAutoScrollEnabled) {
      icon.classList.add("fa-play");
    } else if (autoScrollSpeedIndex === 0) {
      icon.classList.add("fa-angle-down");
    } else {
      icon.classList.add("fa-angle-double-down");
    }
    autoScrollButton.replaceChildren(icon);
  }

  function startAutoScrollLoop() {
    if (autoScrollAnimationFrameId)
      cancelAnimationFrame(autoScrollAnimationFrameId);
    if (!isAutoScrollEnabled) return;
    var lastTime = 0;
    function scrollStep() {
      var now = Date.now();
      if (now - lastTime >= SCROLL_INTERVAL) {
        window.scrollBy(0, AUTO_SCROLL_SPEEDS[autoScrollSpeedIndex]);
        lastTime = now;
      }
      if (isAutoScrollEnabled)
        autoScrollAnimationFrameId = requestAnimationFrame(scrollStep);
    }
    autoScrollAnimationFrameId = requestAnimationFrame(scrollStep);
  }

  function getMostVisibleChapterWrapper(wrappers) {
    var mostVisibleWrapper = null;
    var maxVisibility = 0;
    var mostVisibleCap = null;
    var mostVisibleUrl = null;
    wrappers.forEach(function (wrapper) {
      var rect = wrapper.getBoundingClientRect();
      var windowHeight = window.innerHeight;
      if (rect.bottom < 0 || rect.top > windowHeight) return;
      var visibleTop = Math.max(0, rect.top);
      var visibleBottom = Math.min(windowHeight, rect.bottom);
      var visibleHeight = Math.max(0, visibleBottom - visibleTop);
      if (rect.height <= 0) return;
      var visibility = visibleHeight / rect.height;
      if (visibility > maxVisibility) {
        maxVisibility = visibility;
        mostVisibleWrapper = wrapper;
        mostVisibleCap = wrapper.getAttribute("data-cap");
        mostVisibleUrl = wrapper.getAttribute("data-url");
      }
    });
    return {
      wrapper: mostVisibleWrapper,
      cap: mostVisibleCap,
      url: mostVisibleUrl,
    };
  }

  function updateUIOnScroll() {
    var wrappers = Array.from(
      document.querySelectorAll(".manga-chapter-wrapper"),
    ).filter(function (w) {
      return !w.querySelector(".manga-end-message");
    });
    if (wrappers.length === 0) return;
    var result = getMostVisibleChapterWrapper(wrappers);
    if (!result.wrapper) return;
    if (statusHud && result.cap)
      statusHud.textContent = "Capítulo " + result.cap;
    if (result.cap && result.cap !== lastPersistedChapter) {
      saveReadingProgress(result.url, result.cap);
      lastPersistedChapter = result.cap;
    }
  }

  function initVisibilityObserver() {
    console.log(
      "[TL] initVisibilityObserver — criando urlObserver com threshold 0.05",
    );
    urlObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            var cap = entry.target.getAttribute("data-cap");
            var url = entry.target.getAttribute("data-url");
              if (cap && url) {
              _origReplaceState.call(window.history, {}, "", url);
            }
          }
        });
      },
      { threshold: 0.05, rootMargin: "0px 0px -50% 0px" },
    );
  }

  function cleanupListeners() {
    isAutoScrollEnabled = false;
    if (autoScrollAnimationFrameId) {
      cancelAnimationFrame(autoScrollAnimationFrameId);
      autoScrollAnimationFrameId = null;
    }
    if (urlObserver) {
      urlObserver.disconnect();
      urlObserver = null;
    }
    if (lazyLoadIntersectionObserver) {
      lazyLoadIntersectionObserver.disconnect();
      lazyLoadIntersectionObserver = null;
    }
    if (adCleaner) {
      adCleaner.disconnect();
      adCleaner = null;
    }
    if (adBlockClickHandler) {
      document.removeEventListener("click", adBlockClickHandler, true);
      adBlockClickHandler = null;
    }
    if (uiToggleClickHandler) {
      document.removeEventListener("click", uiToggleClickHandler);
      uiToggleClickHandler = null;
    }
    if (readerEatClickHandler) {
      document.removeEventListener("click", readerEatClickHandler, true);
      readerEatClickHandler = null;
    }
    if (autoScrollTouchStartHandler) {
      autoScrollButton &&
        autoScrollButton.removeEventListener(
          "touchstart",
          autoScrollTouchStartHandler,
        );
      autoScrollTouchStartHandler = null;
    }
    if (autoScrollTouchMoveHandler) {
      autoScrollButton &&
        autoScrollButton.removeEventListener(
          "touchmove",
          autoScrollTouchMoveHandler,
        );
      autoScrollTouchMoveHandler = null;
    }
    if (autoScrollTouchEndHandler) {
      autoScrollButton &&
        autoScrollButton.removeEventListener(
          "touchend",
          autoScrollTouchEndHandler,
        );
      autoScrollTouchEndHandler = null;
    }
    if (autoScrollTouchCancelHandler) {
      autoScrollButton &&
        autoScrollButton.removeEventListener(
          "touchcancel",
          autoScrollTouchCancelHandler,
        );
      autoScrollTouchCancelHandler = null;
    }
    if (onScrollHandler) {
      window.removeEventListener("scroll", onScrollHandler);
      onScrollHandler = null;
    }
    if (onWheelHandler) {
      window.removeEventListener("wheel", onWheelHandler);
      onWheelHandler = null;
    }
    if (onBeforeUnloadHandler) {
      window.removeEventListener("beforeunload", onBeforeUnloadHandler);
      onBeforeUnloadHandler = null;
    }
    if (onModalClose) {
      document.removeEventListener("click", onModalClose);
      onModalClose = null;
    }
    var modal = document.getElementById("manga-lib-modal");
    if (modal) modal.remove();
    if (saveDebounceTimeout) {
      clearTimeout(saveDebounceTimeout);
      saveDebounceTimeout = null;
    }
    if (doubleTapTimer) {
      clearTimeout(doubleTapTimer);
      doubleTapTimer = null;
    }
    if (loaderHideTimeout) {
      clearTimeout(loaderHideTimeout);
      loaderHideTimeout = null;
    }
  }

  function getCurrentChapterData() {
    currentTitle = activeSite.getTitle();
    var currentUrl = window.location.href;
    var capNum = activeSite.getChapterNumber();
    lastPersistedChapter = null;
    return {
      currentCap: capNum || "Inicial",
      currentUrl: currentUrl,
      currentImages: [],
    };
  }

  function setupEventHandlers(mainContainer) {
    onScrollHandler = function () {
      var nearBottom =
        window.innerHeight + window.scrollY >=
        document.documentElement.scrollHeight - SCROLL_THRESHOLD;
      if (nearBottom)
        console.log(
          "[TL] scroll near bottom, pendingNext:",
          !!pendingNextChapter,
          "loading:",
          isChapterLoading,
        );
      if (!isChapterLoading && pendingNextChapter) {
        if (nearBottom) {
          console.log("[TL] triggering fetchAndAppendNextChapter");
          fetchAndAppendNextChapter(mainContainer);
        }
      }
      updateUIOnScroll();
    };
    console.log(
      "[TL] setupEventHandlers — registrando scroll, wheel, beforeunload, click",
    );
    window.addEventListener("scroll", onScrollHandler, { passive: true });

    var lastScrollY = window.scrollY;
    onWheelHandler = function (e) {
      if (isAutoScrollEnabled) {
        console.log("[TL] wheel detectado durante autoScroll — desligando");
        var currentScrollY = window.scrollY;
        if (Math.abs(currentScrollY - lastScrollY) > 30) toggleAutoScroll();
        lastScrollY = currentScrollY;
      }
    };
    window.addEventListener("wheel", onWheelHandler, { passive: true });

    onBeforeUnloadHandler = function () {
      console.log("[TL] beforeunload — limpando listeners");
      cleanupListeners();
    };
    window.addEventListener("beforeunload", onBeforeUnloadHandler);
  }

  function onReaderClick(e) {
    var our = e.target.closest(
      ".manga-fab-btn, #manga-hud, #manga-lib-modal, #manga-loader, .manga-container, .manga-chapter-wrapper, .manga-chapter-divider, .manga-end-message",
    );
    if (!our) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  function rebuildReaderPage() {
    console.log("[TL] rebuildReaderPage — limpando DOM e reconstruindo");
    document.body.replaceChildren();
    document.head.insertAdjacentHTML(
      "afterbegin",
      '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">',
    );
    injectStylesToHead();
    applyAdBlockers();
    document.addEventListener(
      "click",
      (readerEatClickHandler = onReaderClick),
      true,
    );
    console.log("[TL] rebuildReaderPage — criando UI");
    var ui = createReaderUI();
    var mainContainer = document.createElement("div");
    mainContainer.className = "manga-container";
    document.body.appendChild(mainContainer);
    createLibraryButton();
    console.log("[TL] rebuildReaderPage completo");
    return { hud: ui.hud, mainContainer: mainContainer };
  }

  function renderChapterSection(container, images, capNum, url) {
    console.log(
      "[TL] renderChapterSection cap:",
      capNum,
      "pages:",
      images.length,
    );
    var wrapper = document.createElement("div");
    wrapper.className = "manga-chapter-wrapper";
    wrapper.setAttribute("data-cap", capNum);
    wrapper.setAttribute("data-url", url);

    if (capNum !== "Inicial") {
      var divider = document.createElement("div");
      divider.className = "manga-chapter-divider";
      divider.textContent = "Capítulo " + capNum;
      wrapper.appendChild(divider);
    }

    if (!Array.isArray(images) || images.length === 0) {
      console.warn("[TL] renderChapterSection: no images");
      return;
    }
    var frag = document.createDocumentFragment();
    images.forEach(function (src, index) {
      var img = document.createElement("img");
      if (index < EAGER_LOAD_COUNT) {
        img.src = src;
      } else {
        img.dataset.src = src;
        img.src =
          "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
        if (lazyLoadIntersectionObserver)
          lazyLoadIntersectionObserver.observe(img);
      }
      img.onerror = function () {
        this.style.display = "none";
        console.error("Falha ao carregar imagem:", src);
      };
      frag.appendChild(img);
    });
    wrapper.appendChild(frag);

    container.appendChild(wrapper);
    console.log(
      "[TL] capitulo",
      capNum,
      "renderizado com",
      images.length,
      "imagens",
    );
    if (urlObserver) urlObserver.observe(wrapper);
  }

  function showChapterError(container) {
    var errorMsg = document.createElement("div");
    errorMsg.className = "manga-end-message";
    errorMsg.textContent =
      "Não foi possível exibir o próximo capítulo. Verifique se a disponibilidade no site original sem o script.";
    container.appendChild(errorMsg);
  }

  function fetchAndAppendNextChapter(container) {
    console.log(
      "[TL] fetchAndAppendNextChapter — loading:",
      isChapterLoading,
      "pendingNext:",
      !!pendingNextChapter,
    );
    if (currentFetchPromise) {
      console.log("[TL] fetch ja em andamento, retornando promise existente");
      return currentFetchPromise;
    }
    isChapterLoading = true;

    currentFetchPromise = (async function () {
      var session = _readerSession;
      if (loaderBar) loaderBar.style.width = "70%";

      if (!pendingNextChapter) {
        console.warn("[TL] pendingNextChapter vazio, nada a buscar");
        isChapterLoading = false;
        currentFetchPromise = null;
        return;
      }

      try {
        var info = pendingNextChapter;
        pendingNextChapter = null;
        console.log(
          "[TL] buscando proximo capitulo:",
          info.chapterNum,
          "slug:",
          info.mangaSlug,
          "url:",
          info.url,
        );

        var result = await activeSite.fetchChapterPages(
          info.mangaSlug,
          info.chapterNum,
        );
        console.log(
          "[TL] resultado fetchNextChapter:",
          result
            ? "pages:" +
                result.pages.length +
                " nextCh:" +
                (result.nextChapter ? result.nextChapter.chapterNum : "none")
            : "null",
        );

        if (session !== _readerSession) {
          console.log("[TL] sessão desatualizada, ignorando resultado");
          return;
        }

        if (result && result.pages.length > 0) {
          console.log(
            "[TL] renderizando capitulo",
            info.chapterNum,
            "com",
            result.pages.length,
            "paginas",
          );
          renderChapterSection(
            container,
            result.pages,
            info.chapterNum,
            info.url,
          );
          _origReplaceState.call(window.history, {}, "", info.url);
          if (result.nextChapter) {
            pendingNextChapter = result.nextChapter;
            console.log(
              "[TL] pendingNextChapter atualizado:",
              pendingNextChapter.chapterNum,
            );
          } else {
            console.log("[TL] ultimo capitulo alcancado");
            if (!document.querySelector(".manga-end-message"))
              appendEndMessage(container);
          }
        } else {
          console.error("[TL] fetchChapterPages retornou sem paginas");
          showChapterError(container);
        }
      } catch (e) {
        console.error("[TL] erro ao buscar proximo capitulo:", e.message || e);
        pendingNextChapter = info;
        showChapterError(container);
      }

      isChapterLoading = false;
      currentFetchPromise = null;
      if (loaderBar) {
        loaderBar.style.width = "100%";
        clearTimeout(loaderHideTimeout);
        loaderHideTimeout = setTimeout(function () {
          loaderBar.style.width = "0%";
        }, 200);
      }
    })();

    return currentFetchPromise;
  }

  function appendEndMessage(container) {
    if (!document.querySelector(".manga-end-message")) {
      var endMessage = document.createElement("div");
      endMessage.className = "manga-end-message";
      endMessage.textContent = "Não há mais capítulos disponíveis";
      container.appendChild(endMessage);
    }
  }

  function createLibraryButton() {
    console.log("[TL] createLibraryButton — adicionando botao biblioteca");
    var existingBtn = document.getElementById("manga-library-btn");
    if (existingBtn) return;
    var btn = document.createElement("div");
    btn.className = "manga-fab-btn";
    btn.id = "manga-library-btn";
    var icon = document.createElement("i");
    icon.className = "fas fa-book";
    btn.appendChild(icon);
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      toggleLibraryModal();
    });
    document.body.appendChild(btn);
  }

  function createEmptyLibraryRow() {
    var row = document.createElement("div");
    row.className = "manga-modal-row";
    row.textContent = "Histórico vazio.";
    row.style.padding = "20px";
    row.style.color = "#666";
    return row;
  }

  function toggleLibraryModal() {
    var modal = document.getElementById("manga-lib-modal");
    if (modal) {
      console.log("[TL] toggleLibraryModal — fechando");
      modal.remove();
      if (onModalClose) {
        document.removeEventListener("click", onModalClose);
        onModalClose = null;
      }
      return;
    }
    console.log("[TL] toggleLibraryModal — abrindo");

    var lib = getLibrary();
    var sortedSlugs = Object.keys(lib).sort(function (a, b) {
      return lib[b].timestamp - lib[a].timestamp;
    });

    modal = document.createElement("div");
    modal.id = "manga-lib-modal";
    modal.className = "manga-modal";

    var header = document.createElement("div");
    header.className = "manga-modal-header";
    header.textContent = "Minha Biblioteca";
    modal.appendChild(header);

    if (sortedSlugs.length === 0) modal.appendChild(createEmptyLibraryRow());

    sortedSlugs.forEach(function (slug) {
      const item = lib[slug];
      const row = document.createElement("a");
      row.href = item.lastUrl;
      row.className = "manga-modal-row";

      var titleSpan = document.createElement("span");
      titleSpan.style.fontWeight = "bold";
      titleSpan.style.color = "#ff5500";
      titleSpan.style.fontSize = "13px";
      titleSpan.textContent = item.title;

      var deleteBtn = document.createElement("span");
      deleteBtn.className = "delete-btn";
      deleteBtn.style.color = "#888";
      deleteBtn.style.cursor = "pointer";
      deleteBtn.style.fontSize = "18px";
      deleteBtn.style.padding = "10px";
      deleteBtn.style.display = "inline-block";
      var faIcon = document.createElement("i");
      faIcon.className = "fas fa-times";
      deleteBtn.appendChild(faIcon);

      var topDiv = document.createElement("div");
      topDiv.style.display = "flex";
      topDiv.style.justifyContent = "space-between";
      topDiv.style.alignItems = "center";
      topDiv.appendChild(titleSpan);
      topDiv.appendChild(deleteBtn);

      var bottomDiv = document.createElement("div");
      bottomDiv.style.fontSize = "12px";
      bottomDiv.style.color = "#888";
      bottomDiv.textContent = "Último: Cap. " + item.lastChapter;

      row.appendChild(topDiv);
      row.appendChild(bottomDiv);

      deleteBtn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        delete lib[slug];
        saveLibraryToStorage(lib);
        row.remove();
        var remainingItemRows = modal.querySelectorAll("a.manga-modal-row");
        if (remainingItemRows.length === 0)
          modal.appendChild(createEmptyLibraryRow());
      });
      modal.appendChild(row);
    });
    document.body.appendChild(modal);
    console.log("[TL] biblioteca exibida com", sortedSlugs.length, "entradas");

    setTimeout(function () {
      onModalClose = function (e) {
        if (!modal.contains(e.target) && !e.target.closest(".manga-fab-btn")) {
          modal.remove();
          document.removeEventListener("click", onModalClose);
          onModalClose = null;
        }
      };
      document.addEventListener("click", onModalClose);
    }, 0);
  }

  function initReaderMode() {
    console.log("[TL] initReaderMode start");
    _readerSession++;
    activeSite = detectSite();
    console.log("[TL] detectSite:", activeSite ? activeSite.id : "null");
    if (!activeSite) return;

    if (isZenModeActive) {
      console.log("[TL] cleanup previous session");
      cleanupListeners();
      isZenModeActive = false;
    }

    var isChapterPage = activeSite.isChapterPage();
    console.log("[TL] isChapterPage:", isChapterPage);
    if (!isChapterPage) return;

    isZenModeActive = true;
    initVisibilityObserver();
    initLazyLoadObserver();

    var data = getCurrentChapterData();
    console.log(
      "[TL] getCurrentChapterData: cap:",
      data.currentCap,
      "title:",
      currentTitle,
    );

    var ui = rebuildReaderPage();
    var mainContainer = ui.mainContainer;

    var mangaSlug = activeSite.getMangaId();
    var capNum = data.currentCap;
    console.log(
      "[TL] fetchChapterPages start slug:",
      mangaSlug,
      "cap:",
      capNum,
    );
    if (mangaSlug && capNum) {
      activeSite
        .fetchChapterPages(mangaSlug, capNum)
        .then(function (result) {
          console.log(
            "[TL] fetchChapterPages result:",
            result
              ? "pages:" +
                  result.pages.length +
                  ' title:"' +
                  result.title +
                  '" nextCh:' +
                  (result.nextChapter ? result.nextChapter.chapterNum : "none")
              : "null",
          );
          if (result && result.pages.length > 0) {
            currentTitle = result.title || currentTitle;
            console.log(
              "[TL] renderizando capítulo",
              capNum,
              "com",
              result.pages.length,
              "páginas",
            );
            renderChapterSection(
              mainContainer,
              result.pages,
              capNum,
              window.location.href,
            );
            if (result.nextChapter) {
              pendingNextChapter = result.nextChapter;
              console.log(
                "[TL] pendingNextChapter setado:",
                pendingNextChapter.chapterNum,
                pendingNextChapter.mangaSlug,
              );
            } else {
              console.log("[TL] nenhum próximo capítulo disponível");
              if (!document.querySelector(".manga-end-message"))
                appendEndMessage(mainContainer);
            }
          } else {
            console.error("[TL] fetchChapterPages retornou vazio ou null");
            showChapterError(mainContainer);
          }
        })
        .catch(function (err) {
          console.error("[TL] Erro no fetchChapterPages:", err.message || err);
          showChapterError(mainContainer);
        });
    } else {
      console.warn(
        "[TL] mangaSlug ou capNum vazio — slug:",
        mangaSlug,
        "cap:",
        capNum,
      );
    }

    setTimeout(function () {
      if (ui.hud) ui.hud.textContent = "Capítulo " + data.currentCap;
      updateUIOnScroll();
    }, 500);

    setupEventHandlers(mainContainer);
  }

  function initWhenReady() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () {
        initReaderMode();
      });
    } else {
      initReaderMode();
    }
  }

  (function () {
    history.pushState = function (s, t, u) {
      _origPushState.call(this, s, t, u);
      setTimeout(initReaderMode, 100);
    };
    history.replaceState = function (s, t, u) {
      _origReplaceState.call(this, s, t, u);
      setTimeout(initReaderMode, 100);
    };
    window.addEventListener("popstate", function () {
      setTimeout(initReaderMode, 100);
    });
  })();

  if (AUTO_START) initWhenReady();
})();

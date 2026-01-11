
// ==UserScript==
// @name         Leitor Infinito do MangaLivre
// @version      1.0
// @description  Userscript para leitura de mangás com rolagem infinita, lazy loading e interface minimalista
// @match        *://mangalivre.tv/*
// @match        *://*.mangalivre.tv/*
// @match        *://mangalivre.to/*
// @match        *://*.mangalivre.to/*
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    const AUTO_START = true;
    const STORAGE_KEY = 'mangalivre_custom_lib_v1';
    const IMAGE_SELECTORS = '.reader-area img, .reading-content img, .reader-images img';
    const CHAPTER_REGEX = /capitulo-([\d]+(?:[\.\-][\d]+)?)/;

    function normalizeChapterNum(chapter) {
        return chapter ? String(chapter).replace(/-/g, '.') : chapter;
    }
    const NEXT_LINK_SELECTORS = "a[class*='next'], a[href*='proximo'], a[href*='próximo'], .page-next, a[title*='próximo'], a[aria-label*='next'], .next-chapter, .proximo";
    const AUTO_SCROLL_SPEEDS = [1.9, 3.4];
    const SCROLL_THRESHOLD = 10000;
    const SCROLL_INTERVAL = 16;
    const DOUBLE_TAP_DELAY = 300;
    const FETCH_TIMEOUT = 10000;
    const SAVE_DEBOUNCE_DELAY = 500;
    const MAX_LIBRARY_SIZE = 100;
    const VALID_DOMAIN_REGEX = /^https?:\/\/(mangalivre\.tv|mangalivre\.to)/;

    let isZenModeActive = false;
    let isChapterLoading = false;
    let currentFetchPromise = null;
    let nextChapterHref = null;
    let isUiVisible = true;
    let currentTitle = "";
    let urlObserver = null;
    let domMutationObserver = null;
    let lastPersistedChapter = null;
    let isAutoScrollEnabled = false;
    let autoScrollSpeedIndex = 1;
    let lastTapTimestamp = 0;
    let tapCount = 0;
    let touchStartY = 0;
    let touchMoved = false;
    let onScrollHandler = null;
    let onWheelHandler = null;
    let onBeforeUnloadHandler = null;
    let autoScrollAnimationFrameId = null;
    let statusHud = null;
    let loaderBar = null;
    let autoScrollButton = null;
    let saveDebounceTimeout = null;
    let doubleTapTimer = null;
    let loaderHideTimeout = null;
    let lazyLoadIntersectionObserver = null;
    let onModalClose = null;

    function escapeHtml(str) {
        return str.replace(/[<>"'&`]/g, (match) => ({
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
            '&': '&amp;',
            '`': '&#96;'
        }[match]));
    }

    function isValidMangaUrl(url) {
        return url && VALID_DOMAIN_REGEX.test(url);
    }

    const styleElement = document.createElement('style');
    styleElement.id = 'mangalivre-custom-styles';
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

        #manga-loader { position: fixed; top: 0; left: 0; height: 2px; background: transparent; width: 0%; transition: width 0.2s; z-index: 10003; }



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

    const linkElement = document.createElement('link');
    linkElement.rel = 'stylesheet';
    linkElement.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css';
    linkElement.id = 'mangalivre-fontawesome';

    function injectStylesToHead() {
        if (!document.getElementById('mangalivre-fontawesome')) {
            document.head.appendChild(linkElement);
        }
        if (!document.getElementById('mangalivre-custom-styles')) {
            document.head.appendChild(styleElement);
        }
    }

    function initLazyLoadObserver() {
        if ('IntersectionObserver' in window && !lazyLoadIntersectionObserver) {
            lazyLoadIntersectionObserver = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const img = entry.target;
                        const src = img.dataset.src;
                        if (src) {
                            img.src = src;
                            img.removeAttribute('data-src');
                            lazyLoadIntersectionObserver.unobserve(img);
                        }
                    }
                });
            }, {
                rootMargin: '500px'
            });
        }
    }

    injectStylesToHead();
    createLibraryButton();

    function getLibrary() {
        try {
            const lib = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
            const validLib = {};
            Object.keys(lib).forEach(key => {
                const item = lib[key];
                if (item.title) item.title = escapeHtml(item.title);
                if (item.lastChapter) item.lastChapter = escapeHtml(String(item.lastChapter));
                if (item.lastUrl && isValidMangaUrl(item.lastUrl)) {
                    validLib[key] = item;
                }
            });
            return validLib;
        } catch (e) {
            console.error('Erro ao carregar biblioteca:', e);
            return {};
        }
    }

    function saveLibraryToStorage(lib) {
        try {
            const sortedByTime = Object.entries(lib).sort((a, b) => b[1].timestamp - a[1].timestamp);
            if (sortedByTime.length > MAX_LIBRARY_SIZE) {
                const trimmedLib = {};
                sortedByTime.slice(0, MAX_LIBRARY_SIZE).forEach(([slug, data]) => {
                    trimmedLib[slug] = data;
                });
                localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmedLib));
            } else {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(lib));
            }
            return true;
        } catch (e) {
            console.error('Erro ao salvar no localStorage:', e);
            return false;
        }
    }

    function saveReadingProgress(url, chapterNum) {
        if (!currentTitle || !url || !chapterNum) return;
        clearTimeout(saveDebounceTimeout);
        saveDebounceTimeout = setTimeout(() => {
            try {
                let sanitizedTitle = escapeHtml(currentTitle.trim());
                sanitizedTitle = sanitizedTitle.substring(0, 200);
                const sanitizedChapter = escapeHtml(String(chapterNum)).substring(0, 50);
                const slug = sanitizedTitle.toLowerCase().replace(/\s+/g, '-').replace(/[^\w\-]+/g, '');
                const lib = getLibrary();
                lib[slug] = {
                    slug: slug,
                    lastChapter: sanitizedChapter,
                    lastUrl: url,
                    title: sanitizedTitle,
                    timestamp: Date.now()
                };
                saveLibraryToStorage(lib);
            } catch (e) {
                console.error('Erro ao salvar progresso:', e);
            }
        }, SAVE_DEBOUNCE_DELAY);
    }

    function createReaderUI() {
        statusHud = document.createElement('div');
        statusHud.id = 'manga-hud';
        statusHud.textContent = 'Carregando...';
        document.body.appendChild(statusHud);

        loaderBar = document.createElement('div');
        loaderBar.id = 'manga-loader';
        document.body.appendChild(loaderBar);

        autoScrollButton = document.createElement('div');
        autoScrollButton.className = 'manga-fab-btn';
        autoScrollButton.id = 'manga-autoscroll-btn';
        autoScrollButton.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleAutoScroll();
        });
        autoScrollButton.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            cycleAutoScrollSpeed();
        });
        autoScrollButton.addEventListener('touchstart', handleAutoScrollTouchStart, { passive: true });
        autoScrollButton.addEventListener('touchmove', handleAutoScrollTouchMove, { passive: true });
        autoScrollButton.addEventListener('touchend', handleAutoScrollTouchEnd);
        autoScrollButton.addEventListener('touchcancel', handleAutoScrollTouchCancel);
        document.body.appendChild(autoScrollButton);
        updateAutoScrollButtonIcon();

        const exitBtn = document.createElement('div');
        exitBtn.className = 'manga-fab-btn';
        exitBtn.id = 'manga-exit-btn';
        const exitIcon = document.createElement('i');
        exitIcon.className = 'fas fa-arrow-left';
        exitBtn.appendChild(exitIcon);
        exitBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const currentUrl = window.location.href;
            let seriesUrl = window.origin;
            if (currentUrl.includes('/manga/') || currentUrl.includes('/ler/')) {
                const parts = currentUrl.split('/');
                seriesUrl = parts.slice(0, 5).join('/');
            }
            window.location.href = seriesUrl;
        });
        document.body.appendChild(exitBtn);

        document.addEventListener('click', (e) => {
            if (e.target.closest('#manga-lib-modal') || e.target.closest('.manga-fab-btn')) return;
            toggleReaderUI();
        });

        return { hud: statusHud };
    }

    function toggleReaderUI() {
        isUiVisible = !isUiVisible;
        const els = document.querySelectorAll('.manga-fab-btn, #manga-hud');
        els.forEach(el => el.classList.toggle('manga-fab-hidden', !isUiVisible));
    }

    function cycleAutoScrollSpeed() {
        autoScrollSpeedIndex = (autoScrollSpeedIndex + 1) % AUTO_SCROLL_SPEEDS.length;
        updateAutoScrollButtonIcon();
    }

    function toggleAutoScroll() {
        isAutoScrollEnabled = !isAutoScrollEnabled;
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
        touchStartY = e.touches[0].clientY;
        touchMoved = false;
    }

    function handleAutoScrollTouchMove(e) {
        const touchY = e.touches[0].clientY;
        if (Math.abs(touchY - touchStartY) > 10) {
            touchMoved = true;
        }
    }

    function handleAutoScrollTouchEnd(e) {
        if (touchMoved) return;

        e.preventDefault();
        e.stopPropagation();

        const currentTime = Date.now();
        const timeDiff = currentTime - lastTapTimestamp;

        clearTimeout(doubleTapTimer);

        if (timeDiff < DOUBLE_TAP_DELAY && tapCount === 1) {
            cycleAutoScrollSpeed();
            tapCount = 0;
        } else {
            tapCount = 1;
            doubleTapTimer = setTimeout(() => {
                if (tapCount === 1) {
                    toggleAutoScroll();
                }
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

        const icon = document.createElement('i');
        icon.className = 'fas';

        if (!isAutoScrollEnabled) {
            icon.classList.add('fa-play');
        } else if (autoScrollSpeedIndex === 0) {
            icon.classList.add('fa-angle-down');
        } else {
            icon.classList.add('fa-angle-double-down');
        }

        autoScrollButton.textContent = '';
        autoScrollButton.appendChild(icon);
    }

    function startAutoScrollLoop() {
        if (autoScrollAnimationFrameId) {
            cancelAnimationFrame(autoScrollAnimationFrameId);
        }
        if (!isAutoScrollEnabled) return;

        let lastTime = 0;
        const scrollStep = () => {
            const now = Date.now();
            if (now - lastTime >= SCROLL_INTERVAL) {
                window.scrollBy(0, AUTO_SCROLL_SPEEDS[autoScrollSpeedIndex]);
                lastTime = now;
            }
            if (isAutoScrollEnabled) {
                autoScrollAnimationFrameId = requestAnimationFrame(scrollStep);
            }
        };
        autoScrollAnimationFrameId = requestAnimationFrame(scrollStep);
    }

    function getMostVisibleChapterWrapper(wrappers) {
        let mostVisibleWrapper = null;
        let maxVisibility = 0;
        let mostVisibleCap = null;
        let mostVisibleUrl = null;

        wrappers.forEach(wrapper => {
            const rect = wrapper.getBoundingClientRect();
            const windowHeight = window.innerHeight;

            if (rect.bottom < 0 || rect.top > windowHeight) {
                return;
            }

            const visibleTop = Math.max(0, rect.top);
            const visibleBottom = Math.min(windowHeight, rect.bottom);
            const visibleHeight = Math.max(0, visibleBottom - visibleTop);
            const visibility = visibleHeight / rect.height;

            if (visibility > maxVisibility) {
                maxVisibility = visibility;
                mostVisibleWrapper = wrapper;
                mostVisibleCap = wrapper.getAttribute('data-cap');
                mostVisibleUrl = wrapper.getAttribute('data-url');
            }
        });

        return { wrapper: mostVisibleWrapper, cap: mostVisibleCap, url: mostVisibleUrl };
    }

    function updateUIOnScroll() {
        const wrappers = Array.from(document.querySelectorAll('.manga-chapter-wrapper')).filter(w => !w.querySelector('.manga-end-message'));
        if (wrappers.length === 0) return;

        const { wrapper: mostVisibleWrapper, cap: mostVisibleCap, url: mostVisibleUrl } = getMostVisibleChapterWrapper(wrappers);
        if (!mostVisibleWrapper) return;

        if (statusHud && mostVisibleCap) statusHud.textContent = `Capítulo ${mostVisibleCap}`;

        if (mostVisibleCap && mostVisibleCap !== lastPersistedChapter) {
            saveReadingProgress(mostVisibleUrl, mostVisibleCap);
            lastPersistedChapter = mostVisibleCap;
        }
    }

    function initVisibilityObserver() {
        urlObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const cap = entry.target.getAttribute('data-cap');
                    const url = entry.target.getAttribute('data-url');
                    if (cap && url) {
                        window.history.replaceState({}, '', url);
                    }
                }
            });
        }, { threshold: 0.05, rootMargin: "0px 0px -50% 0px" });
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

        if (domMutationObserver) {
            domMutationObserver.disconnect();
            domMutationObserver = null;
        }

        if (lazyLoadIntersectionObserver) {
            lazyLoadIntersectionObserver.disconnect();
            lazyLoadIntersectionObserver = null;
        }

        if (onScrollHandler) {
            window.removeEventListener('scroll', onScrollHandler);
            onScrollHandler = null;
        }

        if (onWheelHandler) {
            window.removeEventListener('wheel', onWheelHandler);
            onWheelHandler = null;
        }

        if (onBeforeUnloadHandler) {
            window.removeEventListener('beforeunload', onBeforeUnloadHandler);
            onBeforeUnloadHandler = null;
        }

        if (onModalClose) {
            document.removeEventListener('click', onModalClose);
            onModalClose = null;
        }

        const modal = document.getElementById('manga-lib-modal');
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
        let rawTitle = document.title.trim();
        const split = rawTitle.split(/[-|]/);
        currentTitle = split[0].trim();

        const currentUrl = window.location.href;
        const match = currentUrl.match(CHAPTER_REGEX);
        const currentCap = match ? normalizeChapterNum(match[1]) : "Inicial";

        lastPersistedChapter = null;

        nextChapterHref = findNextChapterLink(document);
        const currentImages = extractImageSources(document);

        return { currentCap, currentUrl, currentImages };
    }

    function setupEventHandlers(mainContainer) {
        onScrollHandler = () => {
            if (!isChapterLoading && nextChapterHref) {
                if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - SCROLL_THRESHOLD) {
                    fetchAndAppendNextChapter(mainContainer);
                }
            }
            updateUIOnScroll();
        };
        window.addEventListener('scroll', onScrollHandler, { passive: true });

        let lastScrollY = window.scrollY;
        onWheelHandler = (e) => {
            if (isAutoScrollEnabled) {
                const currentScrollY = window.scrollY;
                if (e.deltaY < 0 && currentScrollY < lastScrollY - 50) {
                    toggleAutoScroll();
                }
                lastScrollY = currentScrollY;
            }
        };
        window.addEventListener('wheel', onWheelHandler, { passive: true });

        onBeforeUnloadHandler = () => {
            cleanupListeners();
        };
        window.addEventListener('beforeunload', onBeforeUnloadHandler);
    }

    function rebuildReaderPage() {
        document.body.innerHTML = '';
        document.head.innerHTML = '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">';
        injectStylesToHead();

        const { hud } = createReaderUI();
        const mainContainer = document.createElement('div');
        mainContainer.className = 'manga-container';
        document.body.appendChild(mainContainer);
        createLibraryButton();
        return { hud, mainContainer };
    }

    function initReaderMode() {
        if (isZenModeActive) {
            cleanupListeners();
            isZenModeActive = false;
        }

        const isChapterPage = window.location.href.includes('capitulo') || window.location.href.includes('/ler/');

        if (!isChapterPage) {
            return;
        }

        const containers = document.querySelectorAll(IMAGE_SELECTORS);
        if (containers.length === 0) {
            console.warn('Script pausado: seletores de imagem não encontrados. Site pode ter mudado.');
            return;
        }

        isZenModeActive = true;
        initVisibilityObserver();
        initLazyLoadObserver();

        const { currentCap, currentUrl, currentImages } = getCurrentChapterData();

        if (currentImages.length === 0) {
            alert('Erro: Nenhuma imagem encontrada. Site pode ter mudado.');
            return;
        }

        const { hud, mainContainer } = rebuildReaderPage();

        renderChapterSection(mainContainer, currentImages, currentCap, currentUrl);

        if (!nextChapterHref && !document.querySelector('.manga-end-message')) {
            appendEndMessage(mainContainer);
        }

        setTimeout(() => {
            if (hud) hud.textContent = `Capítulo ${currentCap}`;
            updateUIOnScroll();
        }, 500);

        let mutationDebounce = null;
        const observerConfig = { childList: true, subtree: true };
        const mutationCallback = () => {
            if (mutationDebounce) clearTimeout(mutationDebounce);
            mutationDebounce = setTimeout(() => {
                const found = findNextChapterLink(document);
                if (found && found !== nextChapterHref) {
                    nextChapterHref = found;
                }
            }, 120);
        };
        if (domMutationObserver) {
            domMutationObserver.disconnect();
            domMutationObserver = null;
        }
        domMutationObserver = new MutationObserver(mutationCallback);
        domMutationObserver.observe(document.body, observerConfig);

        setupEventHandlers(mainContainer);
    }

    function extractImageSources(doc) {
        const containers = doc.querySelectorAll(IMAGE_SELECTORS);
        let srcs = [];
        containers.forEach(img => {
            let src = img.getAttribute('data-lazy-src') || img.getAttribute('data-src') || img.getAttribute('src');
            if (src && !src.includes('pixel') && !srcs.includes(src)) srcs.push(src);
        });
        return srcs;
    }

    function renderChapterSection(container, images, capNum, url) {
        const wrapper = document.createElement('div');
        wrapper.className = 'manga-chapter-wrapper';
        wrapper.setAttribute('data-cap', capNum);
        wrapper.setAttribute('data-url', url);

        if (capNum !== "Inicial") {
            const divider = document.createElement('div');
            divider.className = 'manga-chapter-divider';
            divider.textContent = `Capítulo ${capNum}`;
            wrapper.appendChild(divider);
        }

        images.forEach((src, index) => {
            const img = document.createElement('img');
            if (index < 5) {
                img.src = src;
            } else {
                img.dataset.src = src;
                img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
                if (lazyLoadIntersectionObserver) {
                    lazyLoadIntersectionObserver.observe(img);
                }
            }
            img.onerror = function () {
                this.style.display = 'none';
                console.error('Falha ao carregar imagem:', src);
            };
            wrapper.appendChild(img);
        });

        container.appendChild(wrapper);
        if (urlObserver) urlObserver.observe(wrapper);
    }

    function showChapterError(container) {
        const errorMsg = document.createElement('div');
        errorMsg.className = 'manga-end-message';
        errorMsg.textContent = 'Não foi possível exibir o próximo capítulo. Verifique se a disponibilidade no site original sem o script.';
        container.appendChild(errorMsg);
    }

    async function fetchAndAppendNextChapter(container) {
        if (currentFetchPromise) return currentFetchPromise;
        if (isChapterLoading || !nextChapterHref) return;

        isChapterLoading = true;

        currentFetchPromise = (async () => {
            if (loaderBar) loaderBar.style.width = '70%';

            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

            let capNum = "?";
            try {
                const match = nextChapterHref.match(CHAPTER_REGEX);
                capNum = match ? normalizeChapterNum(match[1]) : "?";

                const response = await fetch(nextChapterHref, {
                    signal: controller.signal,
                    headers: {
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                        'Accept-Language': 'pt-BR,pt;q=0.8,en-US;q=0.5,en;q=0.3'
                    }
                });
                clearTimeout(timeout);

                const text = await response.text();
                const parser = new DOMParser();
                const nextDoc = parser.parseFromString(text, 'text/html');

                nextDoc.querySelectorAll('script').forEach(s => s.remove());

                const nextImages = extractImageSources(nextDoc);
                const newNextLink = findNextChapterLink(nextDoc);

                if (nextImages.length > 0) {
                    const currentChapterUrl = nextChapterHref;
                    await new Promise(resolve => setTimeout(resolve, 100));
                    renderChapterSection(container, nextImages, capNum, currentChapterUrl);
                    nextChapterHref = newNextLink;
                    if (!nextChapterHref && !document.querySelector('.manga-end-message')) {
                        appendEndMessage(container);
                    }
                } else {
                    showChapterError(container);
                    nextChapterHref = newNextLink;
                    if (nextChapterHref) {
                        await new Promise(resolve => setTimeout(resolve, 300));
                        await fetchAndAppendNextChapter(container);
                    } else if (!document.querySelector('.manga-end-message')) {
                        appendEndMessage(container);
                    }
                }
            } catch (e) {
                if (e.name === 'AbortError') {
                    console.error('Timeout ao buscar próximo capítulo');
                } else {
                    console.error('Erro ao buscar próximo capítulo:', e);
                }
                showChapterError(container);
                const match = nextChapterHref.match(CHAPTER_REGEX);
                capNum = match ? normalizeChapterNum(match[1]) : "?";
                let newNextLink = null;
                try {
                    const response = await fetch(nextChapterHref, { signal: controller.signal });
                    const text = await response.text();
                    const parser = new DOMParser();
                    const nextDoc = parser.parseFromString(text, 'text/html');
                    newNextLink = findNextChapterLink(nextDoc);
                } catch { }
                nextChapterHref = newNextLink;
                if (nextChapterHref) {
                    await new Promise(resolve => setTimeout(resolve, 300));
                    await fetchAndAppendNextChapter(container);
                } else if (!document.querySelector('.manga-end-message')) {
                    appendEndMessage(container);
                }
                if (loaderBar) {
                    loaderBar.style.background = 'transparent';
                    loaderBar.style.width = '100%';
                    setTimeout(() => {
                        loaderBar.style.width = '0%';
                        loaderBar.style.background = 'transparent';
                    }, 1000);
                }
            } finally {
                isChapterLoading = false;
                currentFetchPromise = null;
                if (loaderBar) {
                    loaderBar.style.width = '100%';
                    clearTimeout(loaderHideTimeout);
                    loaderHideTimeout = setTimeout(() => loaderBar.style.width = '0%', 200);
                }
            }
        })();

        return currentFetchPromise;
    }

    function findNextChapterLink(doc) {
        const links = Array.from(doc.querySelectorAll(NEXT_LINK_SELECTORS));
        const currentUrl = window.location.href;
        const currentMatch = currentUrl.match(CHAPTER_REGEX);
        const currentChapter = currentMatch ? parseFloat(currentMatch[1]) : 0;

        for (const link of links) {
            const href = link.href;
            if (!isValidMangaUrl(href)) continue;

            const match = href.match(CHAPTER_REGEX);
            if (match) {
                const nextChapter = parseFloat(match[1]);
                if (nextChapter > currentChapter) {
                    return href;
                }
            }
        }

        return null;
    }

    function appendEndMessage(container) {
        if (!document.querySelector('.manga-end-message')) {
            const endMessage = document.createElement('div');
            endMessage.className = 'manga-end-message';
            endMessage.textContent = 'Não há mais capítulos disponíveis';
            container.appendChild(endMessage);
        }
    }

    function createLibraryButton() {
        const existingBtn = document.getElementById('manga-library-btn');
        if (existingBtn) return;

        const btn = document.createElement('div');
        btn.className = 'manga-fab-btn';
        btn.id = 'manga-library-btn';
        const icon = document.createElement('i');
        icon.className = 'fas fa-book';
        btn.appendChild(icon);
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleLibraryModal();
        });
        document.body.appendChild(btn);
    }

    function createEmptyLibraryRow() {
        const row = document.createElement('div');
        row.className = 'manga-modal-row';
        row.textContent = "Histórico vazio.";
        row.style.padding = "20px";
        row.style.color = "#666";
        return row;
    }

    function toggleLibraryModal() {
        let modal = document.getElementById('manga-lib-modal');
        if (modal) {
            modal.remove();
            if (onModalClose) {
                document.removeEventListener('click', onModalClose);
                onModalClose = null;
            }
            return;
        }

        const lib = getLibrary();
        const sortedSlugs = Object.keys(lib).sort((a, b) => lib[b].timestamp - lib[a].timestamp);

        modal = document.createElement('div');
        modal.id = 'manga-lib-modal';
        modal.className = 'manga-modal';

        const header = document.createElement('div');
        header.className = 'manga-modal-header';
        header.textContent = 'Minha Biblioteca';
        modal.appendChild(header);

        if (sortedSlugs.length === 0) {
            modal.appendChild(createEmptyLibraryRow());
        }

        sortedSlugs.forEach(slug => {
            const item = lib[slug];
            const row = document.createElement('a');
            row.href = item.lastUrl;
            row.className = 'manga-modal-row';

            const titleSpan = document.createElement('span');
            titleSpan.style.fontWeight = 'bold';
            titleSpan.style.color = '#ff5500';
            titleSpan.style.fontSize = '13px';
            titleSpan.textContent = item.title;

            const deleteBtn = document.createElement('span');
            deleteBtn.className = 'delete-btn';
            deleteBtn.style.color = '#888';
            deleteBtn.style.cursor = 'pointer';
            deleteBtn.style.fontSize = '18px';
            deleteBtn.style.padding = '10px';
            deleteBtn.style.display = 'inline-block';

            const faIcon = document.createElement('i');
            faIcon.className = 'fas fa-times';
            deleteBtn.appendChild(faIcon);

            const topDiv = document.createElement('div');
            topDiv.style.display = 'flex';
            topDiv.style.justifyContent = 'space-between';
            topDiv.style.alignItems = 'center';
            topDiv.appendChild(titleSpan);
            topDiv.appendChild(deleteBtn);

            const bottomDiv = document.createElement('div');
            bottomDiv.style.fontSize = '12px';
            bottomDiv.style.color = '#888';
            bottomDiv.textContent = `Último: Cap. ${item.lastChapter}`;

            row.appendChild(topDiv);
            row.appendChild(bottomDiv);

            deleteBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                delete lib[slug];
                saveLibraryToStorage(lib);
                row.remove();
                const remainingItemRows = modal.querySelectorAll('a.manga-modal-row');
                if (remainingItemRows.length === 0) {
                    modal.appendChild(createEmptyLibraryRow());
                }
            });
            modal.appendChild(row);
        });
        document.body.appendChild(modal);

        setTimeout(() => {
            onModalClose = (e) => {
                if (!modal.contains(e.target) && !e.target.closest('.manga-fab-btn')) {
                    modal.remove();
                    document.removeEventListener('click', onModalClose);
                    onModalClose = null;
                }
            };
            document.addEventListener('click', onModalClose);
        }, 0);
    }

    function initWhenReady() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                initReaderMode();
            });
        } else {
            initReaderMode();
        }
    }

    if (AUTO_START) {
        initWhenReady();
    }

})();

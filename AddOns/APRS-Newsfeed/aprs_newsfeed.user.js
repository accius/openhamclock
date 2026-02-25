// ==UserScript==
// @name         APRS Newsfeed (Inbox) for OpenHamClock
// @namespace    http://tampermonkey.net/
// @version      1.7
// @description  Fetches and displays your latest APRS messages from aprs.fi
// @author       DO3EET
// @match        https://openhamclock.com/*
// @grant        GM_xmlhttpRequest
// @connect      aprs.fi
// ==/UserScript==

(function() {
    'use strict';

    const STORAGE_API_KEY = 'ohc_aprsfi_apikey';
    const POLL_INTERVAL = 300000;

    const translations = {
        de: {
            title: "\uD83D\uDCE9 APRS Newsfeed",
            placeholder_apikey: "aprs.fi API Key",
            inbox_for: "Inbox für",
            no_messages: "Keine Nachrichten gefunden.",
            last_update: "Letztes Update",
            save: "Speichern",
            from: "Von",
            to: "An",
            time: "Zeit",
            error_api: "API Fehler. Key prüfen?",
            error_no_call: "Kein Rufzeichen gefunden!",
            setup_required: "Bitte API-Key in Einstellungen eingeben."
        },
        en: {
            title: "\uD83D\uDCE9 APRS Newsfeed",
            placeholder_apikey: "aprs.fi API Key",
            inbox_for: "Inbox for",
            no_messages: "No messages found.",
            last_update: "Last update",
            save: "Save",
            from: "From",
            to: "To",
            time: "Time",
            error_api: "API Error. Check key?",
            error_no_call: "No callsign found!",
            setup_required: "Please enter API Key in settings."
        },
        ja: {
            title: "\uD83D\uDCE9 APRS \u30CB\u30E5\u30FC\u30B9\u30D5\u30A3\u30FC\u30C9",
            placeholder_apikey: "aprs.fi API \u30AD\u30FC",
            inbox_for: "\u53D7\u4FE1\u30C8\u30EC\u30A4:",
            no_messages: "\u30E1\u30C3\u30BB\u30FC\u30B8\u306F\u898B\u3064\u304B\u308A\u307E\u305B\u3093\u3067\u3057\u305F\u3002",
            last_update: "\u6700\u7D42\u66F4\u65B0",
            save: "\u4FDD\u5B58",
            from: "\u9001\u4FE1\u5143",
            to: "\u5B9B\u5148",
            time: "\u6642\u523B",
            error_api: "API \u30A8\u30E9\u30FC\u3002\u30AD\u30FC\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
            error_no_call: "\u30B3\u30FC\u30EB\u30B5\u30A4\u30F3\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093\uFF01",
            setup_required: "\u8A2D\u5B9A\u3067 API \u30AD\u30FC\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044\u3002"
        }
    };

    let lang = 'en';
    const htmlLang = document.documentElement.lang.toLowerCase();
    if (htmlLang.startsWith('de')) lang = 'de';
    else if (htmlLang.startsWith('ja')) lang = 'ja';
    
    try {
        const savedLang = localStorage.getItem('i18nextLng');
        if (savedLang) {
            if (savedLang.startsWith('de')) lang = 'de';
            else if (savedLang.startsWith('ja')) lang = 'ja';
            else if (savedLang.startsWith('en')) lang = 'en';
        }
    } catch(e) {}

    const t = (key) => translations[lang][key] || translations['en'][key] || key;

    const styles = `
        #ohc-addon-drawer {
            position: fixed;
            top: 100px;
            right: 20px;
            display: flex;
            flex-direction: row-reverse;
            align-items: center;
            gap: 10px;
            z-index: 10000;
            pointer-events: none;
            user-select: none;
        }
        #ohc-addon-drawer.ohc-vertical {
            flex-direction: column-reverse;
        }
        .ohc-addon-icon {
            position: relative;
            width: 45px;
            height: 45px;
            background: var(--bg-panel, rgba(17, 24, 32, 0.95));
            border: 1px solid var(--border-color, rgba(255, 180, 50, 0.3));
            border-radius: 50%;
            color: var(--accent-cyan, #00ddff);
            font-size: 20px;
            cursor: pointer;
            display: flex;
            justify-content: center;
            align-items: center;
            box-shadow: 0 2px 10px rgba(0,0,0,0.3);
            pointer-events: auto;
            transition: all 0.3s ease;
        }
        .ohc-addon-icon:hover { border-color: var(--accent-amber, #ffb432); transform: scale(1.1); }
        #ohc-addon-launcher { background: var(--bg-tertiary, #1a2332); color: var(--accent-amber); cursor: move; }
        .ohc-addon-item { display: none; }

        #aprs-news-container {
            position: fixed;
            top: 100px;
            right: 20px;
            width: 320px;
            max-height: 500px;
            background: var(--bg-panel, rgba(17, 24, 32, 0.95));
            border: 1px solid var(--border-color, rgba(255, 180, 50, 0.3));
            border-radius: 8px;
            color: var(--text-primary, #f0f4f8);
            font-family: 'JetBrains Mono', monospace, sans-serif;
            z-index: 9998;
            box-shadow: 0 4px 15px rgba(0,0,0,0.5);
            display: none;
            flex-direction: column;
            backdrop-filter: blur(5px);
        }
        #aprs-news-header {
            padding: 10px;
            background: rgba(0, 221, 255, 0.1);
            border-bottom: 1px solid var(--border-color, rgba(255, 180, 50, 0.2));
            cursor: move;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-radius: 8px 8px 0 0;
        }
        #aprs-news-header h3 { margin: 0; font-size: 14px; color: var(--accent-cyan, #00ddff); }
        .aprs-icon-btn { cursor: pointer; color: var(--text-muted); margin-left: 10px; font-size: 14px; transition: color 0.2s; }
        .aprs-icon-btn:hover { color: var(--text-primary); }
        #aprs-news-content { padding: 0; overflow-y: auto; flex-grow: 1; }
        .aprs-msg-entry { padding: 10px; border-bottom: 1px solid var(--border-color, rgba(255, 255, 255, 0.05)); font-size: 12px; }
        .aprs-msg-entry:last-child { border-bottom: none; }
        .aprs-msg-meta { display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 10px; color: var(--text-muted); }
        .aprs-msg-call { color: var(--accent-green, #00ff88); font-weight: bold; }
        .aprs-msg-text { color: var(--text-primary); line-height: 1.4; word-break: break-word; }
        #aprs-news-settings { padding: 10px; background: rgba(0,0,0,0.3); border-top: 1px solid var(--border-color, rgba(255, 180, 50, 0.1)); font-size: 11px; display: none; }
        .aprs-input { width: 100%; padding: 6px; background: var(--bg-secondary, #111820); border: 1px solid var(--border-color, rgba(255, 180, 50, 0.2)); color: var(--text-primary); border-radius: 4px; margin-bottom: 6px; box-sizing: border-box; outline: none; }
        .aprs-badge { position: absolute; top: -2px; right: -2px; background: var(--accent-red, #ff4466); color: white; font-size: 10px; width: 18px; height: 18px; border-radius: 50%; display: none; justify-content: center; align-items: center; border: 2px solid var(--bg-panel); z-index: 10; }
    `;

    let callsign = 'N0CALL';
    let apiKey = localStorage.getItem(STORAGE_API_KEY) || '';
    let lastMsgId = localStorage.getItem('ohc_aprs_last_msgid') || '0';

    function getCallsign() {
        try {
            const config = JSON.parse(localStorage.getItem('openhamclock_config'));
            if (config && config.callsign && config.callsign !== 'N0CALL') return config.callsign;
        } catch(e) {}
        return 'N0CALL';
    }

    function init() {
        if (!document.body) return;
        callsign = getCallsign();

        const styleSheet = document.createElement("style");
        styleSheet.id = "ohc-aprs-styles";
        styleSheet.innerText = styles;
        document.head.appendChild(styleSheet);

        let drawer = document.getElementById("ohc-addon-drawer");
        if (!drawer) {
            drawer = document.createElement("div");
            drawer.id = "ohc-addon-drawer";

            const updateLayout = () => {
                if (!drawer) return;
                const rect = drawer.getBoundingClientRect();
                const winW = window.innerWidth;
                const winH = window.innerHeight;

                const isRight = (rect.left + rect.width / 2) > (winW / 2);
                const isBottom = (rect.top + rect.height / 2) > (winH / 2);
                const isVert = drawer.classList.contains('ohc-vertical');

                if (isVert) {
                    drawer.style.flexDirection = isBottom ? 'column-reverse' : 'column';
                } else {
                    drawer.style.flexDirection = isRight ? 'row-reverse' : 'row';
                }
            };

            const savedLayout = localStorage.getItem('ohc_addon_layout') || 'horizontal';
            if (savedLayout === 'vertical') drawer.classList.add('ohc-vertical');

            const savedPos = JSON.parse(localStorage.getItem('ohc_addon_pos') || '{}');
            if (savedPos.top) drawer.style.top = savedPos.top;
            if (savedPos.bottom) drawer.style.bottom = savedPos.bottom;
            if (savedPos.left) drawer.style.left = savedPos.left;
            if (savedPos.right) drawer.style.right = savedPos.right;

            if (!savedPos.top && !savedPos.bottom) {
                drawer.style.top = '100px';
                drawer.style.right = '20px';
            }

            const launcher = document.createElement("div");
            launcher.id = "ohc-addon-launcher";
            launcher.className = "ohc-addon-icon";
            launcher.innerHTML = "\uD83E\uDDE9";
            launcher.title = "L: Toggle | M: Drag | R: Rotate";

            let isDragging = false;
            let dragTimer = null;
            let wasDragged = false;
            let startX, startY, startTop, startLeft;

            launcher.onclick = () => {
                if (wasDragged) {
                    wasDragged = false;
                    return;
                }
                const items = document.querySelectorAll(".ohc-addon-item");
                const isHidden = Array.from(items).some(el => el.style.display !== "flex");
                items.forEach(el => el.style.display = isHidden ? "flex" : "none");
                launcher.style.transform = isHidden ? "rotate(90deg)" : "rotate(0deg)";
                updateLayout();
            };

            launcher.oncontextmenu = (e) => {
                e.preventDefault();
                drawer.classList.toggle('ohc-vertical');
                localStorage.setItem('ohc_addon_layout', drawer.classList.contains('ohc-vertical') ? 'vertical' : 'horizontal');
                updateLayout();
            };

            const startDrag = (x, y) => {
                isDragging = true;
                wasDragged = true;
                startX = x;
                startY = y;
                const rect = drawer.getBoundingClientRect();
                startTop = rect.top;
                startLeft = rect.left;
                launcher.style.cursor = 'grabbing';
            };

            const handleMove = (x, y) => {
                if (!isDragging) return;
                const dx = x - startX;
                const dy = y - startY;
                drawer.style.top = (startTop + dy) + "px";
                drawer.style.left = (startLeft + dx) + "px";
                drawer.style.right = 'auto';
                drawer.style.bottom = 'auto';
            };

            const stopDrag = () => {
                if (!isDragging) return;
                isDragging = false;
                launcher.style.cursor = 'move';

                const rect = drawer.getBoundingClientRect();
                const winW = window.innerWidth;
                const winH = window.innerHeight;
                const isRight = (rect.left + rect.width / 2) > (winW / 2);
                const isBottom = (rect.top + rect.height / 2) > (winH / 2);

                const pos = {};
                if (isRight) {
                    drawer.style.left = 'auto';
                    drawer.style.right = Math.max(0, winW - rect.right) + 'px';
                    pos.right = drawer.style.right;
                } else {
                    drawer.style.right = 'auto';
                    drawer.style.left = Math.max(0, rect.left) + 'px';
                    pos.left = drawer.style.left;
                }

                if (isBottom) {
                    drawer.style.top = 'auto';
                    drawer.style.bottom = Math.max(0, winH - rect.bottom) + 'px';
                    pos.bottom = drawer.style.bottom;
                } else {
                    drawer.style.bottom = 'auto';
                    drawer.style.top = Math.max(0, rect.top) + 'px';
                    pos.top = drawer.style.top;
                }

                localStorage.setItem('ohc_addon_pos', JSON.stringify(pos));
                updateLayout();
            };

            launcher.onmousedown = (e) => {
                if (e.button === 1) {
                    e.preventDefault();
                    startDrag(e.clientX, e.clientY);
                } else if (e.button === 0) {
                    startX = e.clientX; startY = e.clientY;
                    dragTimer = setTimeout(() => startDrag(e.clientX, e.clientY), 500);
                }
            };

            document.addEventListener('mousemove', (e) => {
                if (!isDragging && dragTimer) {
                    if (Math.abs(e.clientX - startX) > 5 || Math.abs(e.clientY - startY) > 5) {
                        clearTimeout(dragTimer);
                        dragTimer = null;
                    }
                }
                handleMove(e.clientX, e.clientY);
            });

            document.addEventListener('mouseup', () => {
                clearTimeout(dragTimer);
                dragTimer = null;
                stopDrag();
            });

            launcher.ontouchstart = (e) => {
                const touch = e.touches[0];
                startX = touch.clientX; startY = touch.clientY;
                dragTimer = setTimeout(() => {
                    startDrag(touch.clientX, touch.clientY);
                    if (window.navigator.vibrate) window.navigator.vibrate(20);
                }, 500);
            };

            document.addEventListener('touchmove', (e) => {
                const touch = e.touches[0];
                if (!isDragging && dragTimer) {
                    if (Math.abs(touch.clientX - startX) > 5 || Math.abs(touch.clientY - startY) > 5) {
                        clearTimeout(dragTimer);
                        dragTimer = null;
                    }
                }
                if (isDragging) {
                    e.preventDefault();
                    handleMove(touch.clientX, touch.clientY);
                }
            }, { passive: false });

            document.addEventListener('touchend', () => {
                clearTimeout(dragTimer);
                dragTimer = null;
                stopDrag();
            });

            drawer.appendChild(launcher);
            document.body.appendChild(drawer);
            setTimeout(updateLayout, 100);
        }
        
        const toggleBtn = document.createElement("div");
        toggleBtn.id = "aprs-toggle-btn";
        toggleBtn.className = "ohc-addon-icon ohc-addon-item";
        toggleBtn.innerHTML = `\uD83D\uDCE9<div id="aprs-news-badge" class="aprs-badge"></div>`;
        toggleBtn.title = t('title');
        drawer.appendChild(toggleBtn);

        const container = document.createElement("div");
        container.id = "aprs-news-container";
        container.innerHTML = `
            <div id="aprs-news-header">
                <h3>${t('title')}</h3>
                <div style="display:flex; align-items:center;">
                    <span id="aprs-settings-toggle" class="aprs-icon-btn" title="Settings">\uD83D\uDD27</span>
                    <span id="aprs-close" class="aprs-icon-btn" style="font-size: 20px; margin-top: -2px;">\u00D7</span>
                </div>
            </div>
            <div id="aprs-news-content">
                <div style="padding: 20px; text-align: center; color: var(--text-muted);">${t('setup_required')}</div>
            </div>
            <div id="aprs-news-settings">
                <input type="password" id="aprs-apikey-input" class="aprs-input" placeholder="${t('placeholder_apikey')}" value="${apiKey}">
                <div style="display:flex; justify-content: space-between; align-items: center;">
                    <span id="aprs-status" style="color: var(--text-muted); font-size: 9px;"></span>
                    <button id="aprs-save-btn" style="padding: 4px 8px; cursor: pointer; background: var(--bg-tertiary); border: 1px solid var(--border-color); color: var(--text-primary); border-radius: 4px;">${t('save')}</button>
                </div>
            </div>
        `;
        document.body.appendChild(container);

        const closeBtn = document.getElementById("aprs-close");
        const settingsBtn = document.getElementById("aprs-settings-toggle");
        const saveBtn = document.getElementById("aprs-save-btn");
        const apiKeyInput = document.getElementById("aprs-apikey-input");
        const settingsDiv = document.getElementById("aprs-news-settings");

        toggleBtn.onclick = () => {
            const isVisible = container.style.display === "flex";
            container.style.display = isVisible ? "none" : "flex";
            if (isVisible) {
                document.getElementById("aprs-news-badge").style.display = "none";
                fetchMessages();
            }
        };
        closeBtn.onclick = () => container.style.display = "none";
        settingsBtn.onclick = () => {
            const isVisible = settingsDiv.style.display === "block";
            settingsDiv.style.display = isVisible ? "none" : "block";
        };
        saveBtn.onclick = () => {
            apiKey = apiKeyInput.value.trim();
            localStorage.setItem(STORAGE_API_KEY, apiKey);
            settingsDiv.style.display = "none";
            fetchMessages();
        };

        let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
        const header = document.getElementById("aprs-news-header");
        header.onmousedown = (e) => {
            if (e.target.classList.contains('aprs-icon-btn')) return;
            e.preventDefault();
            pos3 = e.clientX; pos4 = e.clientY;
            document.onmouseup = () => { document.onmouseup = null; document.onmousemove = null; };
            document.onmousemove = (e) => {
                e.preventDefault();
                pos1 = pos3 - e.clientX; pos2 = pos4 - e.clientY;
                pos3 = e.clientX; pos4 = e.clientY;
                container.style.top = (container.offsetTop - pos2) + "px";
                container.style.left = (container.offsetLeft - pos1) + "px";
                container.style.right = 'auto';
            };
        };

        if (apiKey) fetchMessages();
        setInterval(fetchMessages, POLL_INTERVAL);
    }

    async function fetchMessages() {
        if (!apiKey) return;
        const baseCall = getCallsign();
        if (baseCall === 'N0CALL') {
             document.getElementById("aprs-news-content").innerHTML = `<div style="padding: 20px; text-align: center; color: var(--accent-red);">${t('error_no_call')}</div>`;
             return;
        }
        const status = document.getElementById("aprs-status");
        status.innerText = "Loading...";
        let queryCalls = baseCall;
        if (!baseCall.includes('-')) queryCalls = `${baseCall},${baseCall}-7,${baseCall}-9,${baseCall}-10,${baseCall}-1,${baseCall}-2`;
        const url = `https://api.aprs.fi/api/get?what=msg&dst=${queryCalls}&apikey=${apiKey}&format=json`;

        if (typeof GM_xmlhttpRequest !== 'undefined') {
            GM_xmlhttpRequest({
                method: "GET",
                url: url,
                onload: (response) => { try { handleResponse(JSON.parse(response.responseText)); } catch (e) { status.innerText = "Parse Error"; } },
                onerror: () => { status.innerText = t('error_api'); }
            });
        } else {
            try { const response = await fetch(url); handleResponse(await response.json()); }
            catch (e) { document.getElementById("aprs-news-content").innerHTML = `<div style="padding: 20px; text-align: center; color: var(--accent-red);">CORS Error. Use Tampermonkey/Greasemonkey!</div>`; status.innerText = "CORS Error"; }
        }
    }

    function handleResponse(data) {
        const status = document.getElementById("aprs-status");
        if (data.result === 'ok') {
            const sortedEntries = (data.entries || []).sort((a, b) => b.time - a.time);
            renderMessages(sortedEntries);
            status.innerText = `${t('last_update')}: ${new Date().toLocaleTimeString()}`;
            if (sortedEntries.length > 0) {
                const latest = sortedEntries[0].messageid;
                if (latest > lastMsgId && document.getElementById("aprs-news-container").style.display !== "flex") {
                    const badge = document.getElementById("aprs-news-badge");
                    badge.innerText = "!";
                    badge.style.display = "flex";
                }
                lastMsgId = latest;
                localStorage.setItem('ohc_aprs_last_msgid', lastMsgId);
            }
        } else {
            document.getElementById("aprs-news-content").innerHTML = `<div style="padding: 20px; text-align: center; color: var(--accent-red);">${t('error_api')}: ${data.description || ''}</div>`;
            status.innerText = "Error";
        }
    }

    function renderMessages(entries) {
        const content = document.getElementById("aprs-news-content");
        if (!entries || entries.length === 0) { content.innerHTML = `<div style="padding: 20px; text-align: center; color: var(--text-muted);">${t('no_messages')}</div>`; return; }
        content.innerHTML = entries.map(entry => {
            const timeStr = new Date(entry.time * 1000).toLocaleString([], {hour: '2-digit', minute:'2-digit', day: '2-digit', month: '2-digit'});
            const isToSSID = entry.dst.includes('-');
            return `
                <div class="aprs-msg-entry">
                    <div class="aprs-msg-meta">
                        <span>${t('from')}: <span class="aprs-msg-call">${entry.srccall}</span></span>
                        <span>${timeStr}</span>
                    </div>
                    <div class="aprs-msg-text">${entry.message}</div>
                    <div style="font-size: 9px; color: var(--text-muted); text-align: right; margin-top: 2px;">
                        ${t('to')}: <span style="color: ${isToSSID ? 'var(--accent-amber)' : 'var(--text-secondary)'}">${entry.dst}</span>
                    </div>
                </div>
            `;
        }).join('');
    }

    if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", init); } else { init(); }
})();

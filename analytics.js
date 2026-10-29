// PlotLab first-party analytics event collector.
// Collects product usage events only for signed-in users. Never records message text,
// passwords, review text, raw search queries, email addresses, or full user-agent strings.
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

if (!window.__plotlabAnalyticsInitialized) {
  window.__plotlabAnalyticsInitialized = true;
  const configured = Object.values(firebaseConfig).every(v => typeof v === "string" && v.length && !v.includes("REPLACE_"));
  if (configured) {
    try {
      const app = getApps().find(a => a.name === "plotlab-user-auth") || initializeApp(firebaseConfig, "plotlab-user-auth");
      const auth = getAuth(app);
      const db = getFirestore(app);
      const storage = window.sessionStorage;
      const sessionKey = "plotlab_analytics_session";
      let sessionId = storage.getItem(sessionKey);
      if (!sessionId) {
        sessionId = (crypto.randomUUID ? crypto.randomUUID() : "s-" + Date.now() + "-" + Math.random().toString(36).slice(2));
        storage.setItem(sessionKey, sessionId);
      }
      let activeUser = null;
      let authInitialized = false;
      let lastProgress = new WeakMap();
      const deviceType = matchMedia("(max-width: 767px)").matches ? "mobile" : (matchMedia("(pointer: coarse)").matches ? "tablet" : "desktop");
      const browser = /Edg\//.test(navigator.userAgent) ? "Edge" : /Chrome\//.test(navigator.userAgent) ? "Chrome" : /Firefox\//.test(navigator.userAgent) ? "Firefox" : /Safari\//.test(navigator.userAgent) ? "Safari" : "Other";
      const clean = (v, max=120) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0,max);
      function movieContext() {
        const modal = document.querySelector("#movieModal:not(.hidden), .movie-modal.active, [aria-modal='true']");
        const heading = modal?.querySelector("h1,h2,h3") || document.querySelector("[data-current-movie-title]");
        const title = clean(heading?.textContent || heading?.getAttribute("data-current-movie-title") || "", 100);
        return title ? { movieTitle: title } : {};
      }
      async function track(eventName, props={}) {
        if (!activeUser) return;
        const safeProps = {};
        for (const key of ["movieId","movieTitle","genre","percent","watchSeconds","action","section","source"]) {
          const value = props[key];
          if (value === undefined || value === null) continue;
          safeProps[key] = typeof value === "number" ? Math.max(0, Math.min(1000000, Math.round(value*100)/100)) : clean(value, key === "movieTitle" ? 100 : 120);
        }
        try {
          await addDoc(collection(db, "analyticsEvents"), {
            userId: activeUser.uid,
            eventName,
            sessionId,
            page: clean(location.pathname + location.hash, 180),
            deviceType,
            browser,
            props: safeProps,
            createdAt: serverTimestamp()
          });
        } catch (error) {
          // Analytics must never interrupt the user's core experience.
          console.warn("[PlotLab Analytics] Event could not be saved:", error.code || error.message);
        }
      }
      window.plotlabTrack = track;
      onAuthStateChanged(auth, user => {
        const prior = activeUser;
        activeUser = user || null;
        if (!authInitialized) {
          authInitialized = true;
          if (activeUser) {
            if (!storage.getItem("plotlab_analytics_session_started")) {
              storage.setItem("plotlab_analytics_session_started", "1");
              track("session_start", { source: "web" });
            }
            track("page_view", { section: "initial" });
          }
          return;
        }
        if (!prior && activeUser) {
          track("login", { source: "web" });
          track("page_view", { section: "authenticated" });
        } else if (prior && !activeUser) {
          // The signed-out event cannot be written after auth has cleared. Logout is
          // recorded by the explicit UI listener below before sign-out where possible.
        }
      });
      window.addEventListener("hashchange", () => track("page_view", { section: clean(location.hash.slice(1) || "home", 80) }));
      document.addEventListener("click", event => {
        const el = event.target.closest("button,a,[role='button'],[data-analytics]");
        if (!el) return;
        const label = clean(el.getAttribute("data-analytics") || el.getAttribute("aria-label") || el.textContent, 80).toLowerCase();
        const context = movieContext();
        if (/watch movie|play movie|^watch now/.test(label)) track("movie_open", context);
        else if (/trailer/.test(label)) track("trailer_play", context);
        else if (/watch later|add to watchlist|save to watchlist/.test(label)) track("watchlist_add", context);
        else if (/log ?out|sign ?out/.test(label)) track("logout", { source: "web" });
        else if (/connect|send request/.test(label)) track("connection_request", { section: "creator-lab" });
        else if (el.closest(".creator-person-card")) track("creator_profile_view", { section: "creator-lab" });
        else if (el.matches("[data-genre],.genre-chip,.genre-card")) track("genre_selected", { genre: clean(el.getAttribute("data-genre") || el.textContent, 80) });
      }, true);
      document.addEventListener("submit", event => {
        const form = event.target;
        if (form.id === "reviewForm") track("review_submitted", movieContext());
        if (/chat|message/i.test(form.id || "") || form.querySelector("#creatorChatInput")) track("message_sent", { section: "creator-lab" });
        if (/search/i.test(form.id || "") || form.querySelector("input[type='search']")) track("search_used", { section: clean(location.hash.slice(1) || "site", 80) });
      }, true);
      document.addEventListener("change", event => {
        const el = event.target;
        if (el.matches("input[type='search'],input[placeholder*='Search' i]")) track("search_used", { section: clean(location.hash.slice(1) || "site", 80) });
      }, true);
      function bindVideo(video) {
        if (video.dataset.plotlabAnalyticsBound) return;
        video.dataset.plotlabAnalyticsBound = "1";
        video.addEventListener("play", () => track("movie_play", movieContext()));
        video.addEventListener("pause", () => { if (!video.ended) track("movie_pause", {...movieContext(), watchSeconds: video.currentTime || 0}); });
        video.addEventListener("ended", () => track("movie_complete", {...movieContext(), percent: 100, watchSeconds: video.duration || video.currentTime || 0}));
        video.addEventListener("timeupdate", () => {
          const now = Date.now(), prior = lastProgress.get(video) || 0;
          if (video.currentTime > 0 && now - prior > 25000) {
            lastProgress.set(video, now);
            track("movie_progress", {...movieContext(), percent: video.duration ? Math.min(100, video.currentTime / video.duration * 100) : 0, watchSeconds: video.currentTime});
          }
        });
        video.addEventListener("error", () => track("playback_error", {...movieContext(), source: "html5-video"}));
      }
      document.querySelectorAll("video").forEach(bindVideo);
      new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
        if (node.nodeType !== 1) return;
        if (node.matches?.("video")) bindVideo(node);
        node.querySelectorAll?.("video").forEach(bindVideo);
      }))).observe(document.documentElement, { childList: true, subtree: true });
      console.info("[PlotLab Analytics] Tracking initialized (signed-in sessions only).");
    } catch (error) {
      console.warn("[PlotLab Analytics] Initialization skipped:", error.message);
    }
  }
}

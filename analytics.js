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
      const boundVideos = new WeakSet();
      const deviceType = matchMedia("(max-width: 767px)").matches ? "mobile" : (matchMedia("(pointer: coarse)").matches ? "tablet" : "desktop");
      const browser = /Edg\//.test(navigator.userAgent) ? "Edge" : /Chrome\//.test(navigator.userAgent) ? "Chrome" : /Firefox\//.test(navigator.userAgent) ? "Firefox" : /Safari\//.test(navigator.userAgent) ? "Safari" : "Other";
      const clean = (v, max=120) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0,max);
      function movieContext(video) {
        const modal = document.getElementById("movieModal");
        const title = clean(modal?.dataset.analyticsMovieTitle || document.querySelector("[data-current-movie-title]")?.getAttribute("data-current-movie-title") || "", 100);
        const movieId = clean(video?.dataset.analyticsMovieId || modal?.dataset.analyticsMovieId || "", 120);
        return { ...(movieId ? { movieId } : {}), ...(title ? { movieTitle: title } : {}) };
      }
      async function track(eventName, props={}) {
        if (!activeUser) return;
        const safeProps = {};
        for (const key of ["movieId","movieTitle","genre","percent","watchSeconds","action","section","source","adBreakType","adRevenue","adUnit"]) {
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
        // Trailer previews are promotional media, not movie viewing sessions.
        if (boundVideos.has(video) || video.closest("#detailTrailerBg,[data-analytics-ignore='true']")) return;
        boundVideos.add(video);
        video.dataset.plotlabAnalyticsBound = "1";
        let playEventSent = false;
        let watchedSeconds = 0;
        let lastTick = 0;
        let lastProgressAt = 0;
        const flushWatchTime = () => {
          if (!lastTick) return;
          const elapsed = Math.max(0, Math.min(5, (Date.now() - lastTick) / 1000));
          if (!video.paused && !video.ended && !document.hidden) watchedSeconds += elapsed;
          lastTick = 0;
        };
        video.addEventListener("play", () => {
          if (video.dataset.plotlabAdPlaying === "1") return;
          if (!playEventSent) {
            playEventSent = true;
            const context = movieContext(video);
            track("movie_play", context);
          }
          lastTick = Date.now();
        });
        video.addEventListener("playing", () => { if (!lastTick) lastTick = Date.now(); });
        video.addEventListener("pause", () => {
          if (video.dataset.plotlabAdPlaying === "1") return;
          flushWatchTime();
          if (!video.ended) track("movie_pause", {...movieContext(video), watchSeconds: Math.round(watchedSeconds)});
        });
        video.addEventListener("ended", () => {
          if (video.dataset.plotlabAdPlaying === "1") return;
          flushWatchTime();
          track("movie_complete", {...movieContext(video), percent: 100, watchSeconds: Math.round(watchedSeconds)});
        });
        video.addEventListener("timeupdate", () => {
          if (video.dataset.plotlabAdPlaying === "1") { lastTick = 0; return; }
          if (video.paused || video.seeking || document.hidden) { lastTick = 0; return; }
          if (!lastTick) { lastTick = Date.now(); return; }
          flushWatchTime();
          lastTick = Date.now();
          if (watchedSeconds - lastProgressAt >= 25) {
            lastProgressAt = watchedSeconds;
            track("movie_progress", {...movieContext(video), percent: video.duration ? Math.min(100, video.currentTime / video.duration * 100) : 0, watchSeconds: Math.round(watchedSeconds)});
          }
        });
        document.addEventListener("visibilitychange", () => { if (document.hidden) flushWatchTime(); });
        video.addEventListener("error", () => track("playback_error", {...movieContext(video), source: "html5-video"}));
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

# PlotLab Analytics Architecture

## Current implementation: Stage 2 — live collection and admin Analytics Centre

The website loads `analytics.js` on the main OTT site and Creator Lab. The collector writes first-party usage events to the Firestore `analyticsEvents` collection for authenticated users only. The private admin dashboard includes a live Analytics Centre that listens to this collection and calculates its KPIs and charts from stored events. The dashboard supports 7/30/90-day and all-time periods, custom date bounds, event type, device, and movie/context filters; all cards, charts, and recent-event rows use the same filtered set. It includes activity trends, event and device mix, most-played movies, Creator Lab engagement, feature usage, genre interest, and recent events.

### Event document schema

| Field | Type | Meaning |
|---|---|---|
| userId | string | Firebase Authentication UID; never email |
| eventName | string | Controlled event name |
| sessionId | string | Random per-tab session identifier |
| page | string | Path and hash, without query strings |
| deviceType | string | mobile / tablet / desktop |
| browser | string | Coarse browser family |
| props | map | Small allowlisted event context |
| createdAt | timestamp | Firestore server timestamp |

### Initial event names

- session_start, page_view, login, logout
- movie_open, movie_play, movie_pause, movie_progress, movie_complete, trailer_play
- search_used, genre_selected, review_submitted, watchlist_add
- creator_profile_view, creator_search, connection_request, message_sent
- playback_error, ui_interaction

The collector deliberately does not store passwords, emails, review text, chat contents, raw search terms, or full user-agent strings. It does not infer age, gender, or other sensitive demographics. Age-group reporting can only be introduced later using a clearly explained, optional age-range field and appropriate privacy controls.

### Important current limits

- Only authenticated user activity is recorded. Anonymous browsing is not counted yet.
- HTML5 video events are tracked. Third-party iframe players (for example YouTube embeds) do not expose reliable playback events to this collector without their supported player API integration.
- The current movie context is best-effort from the visible movie modal. Stable movie IDs should be wired directly into player actions in the next instrumentation pass.
- Session activity is represented by a random per-tab session ID. A session timeout/engagement model will be formalized before reporting DAU/WAU/MAU.
- The Firestore rules change is committed to GitHub but must be published in Firebase Console before events can be written.

## Security rules

Authenticated users may create events only when `userId` matches their own Firebase UID. Users cannot read, edit, or delete analytics records. The PlotLab owner account can read them. Event names and document fields are allowlisted; timestamps must be server timestamps.

## Next implementation stages

1. Wire stable movie IDs and explicit events into movie player, search, watchlist, reviews, and Creator Lab actions so movie-level reporting is more reliable.
2. Add CSV and Excel exports with aggregation and pagination.
3. Connect Firestore event data to BigQuery using a managed export/streaming pipeline; do not expose service credentials in browser code.
4. Build a Power BI semantic model and scheduled refresh only if an external BI report is still required. The Power BI refresh frequency depends on the chosen connector, gateway, and licensing.

## Metric definitions to use

- **Registered users:** distinct Firebase UIDs in the users collection.
- **DAU / WAU / MAU:** distinct authenticated UIDs with qualifying activity in a rolling/local calendar day, 7-day, or 30-day window. Define timezone consistently (initially Asia/Kolkata).
- **Movie starts:** distinct playback-start events, not movie card clicks.
- **Qualified views:** playback reaching a documented threshold (recommended initial definition: at least 30 seconds, with short-form exceptions handled separately).
- **Watch time:** deduplicated playback intervals, not sum of arbitrary progress snapshots.
- **Completion rate:** completed sessions divided by qualified playback starts, with duration and resume handling defined.
- **Retention:** users who return in a later cohort window divided by users in the original signup cohort.

Do not display invented or sample metrics as real data. All dashboard numbers must be computed from stored events and show the selected reporting period.

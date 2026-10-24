# PlotLab private movie dashboard — Firebase setup

The dashboard code is committed, but it is **not secure/connected until you complete these steps**. The Firebase config file intentionally contains placeholders and the Firestore rules must be deployed to your own Firebase project.

## 1. Create the Firebase project
1. Open https://console.firebase.google.com/ and create a project for PlotLab.
2. In Project settings → General → Your apps, register a Web app and copy its config into `firebase-config.js`. Replace every `REPLACE_...` value. This config is public client configuration; never put a service-account JSON or private key in the website.
3. Build → Authentication → Get started → Sign-in method: enable **Google**.
4. Authentication → Settings → Authorized domains: add your deployed PlotLab domain (for example, your actual Netlify domain). Do not add domains you do not control.
5. Build → Firestore Database → Create database. Then publish the rules below.

## 2. Deploy Firestore security rules
Install Firebase CLI and sign in:
```bash
npm install -g firebase-tools
firebase login
firebase use --add
firebase deploy --only firestore:rules
```
Select your project when prompted. Confirm `firebase.json` and `firestore.rules` are in the repository root.

Rules enforce authorization on Firebase servers: only a **verified Google account whose email exactly matches** `harshsolanki3107@gmail.com` can create, update, publish or delete movie records/settings. Public visitors can read only records marked `published: true`. All other Firestore paths are denied. Do not loosen these rules.

## 3. Publish the website
The dashboard is `admin.html`; main site is `index.html`. Deploy both from the same static site root so their relative paths work. The admin route is not secret by URL; security comes from Google sign-in plus Firestore rules. A visitor may open the admin page, but cannot read drafts or make changes.

## 4. Use the dashboard
1. Open `/admin.html` on your deployed PlotLab domain.
2. Choose **Sign in with Google** and sign in as `harshsolanki3107@gmail.com`.
3. Add/edit movie details: title, year, genre, description, poster URL, backdrop URL, trailer URL, full movie URL, featured/trending switches, publish state.
4. Save draft or publish. Published records are read by the main site from Firestore.

## 5. Content and link notes
- Use links you own or are licensed to distribute. A movie URL is stored as metadata; this static player does not proxy or host the video.
- Poster/backdrop/trailer/full movie URLs should be HTTPS URLs accessible to your intended viewers.
- Firebase web config is designed to be public. **Never commit service-account keys, passwords, or private API secrets.**
- If the site uses a custom domain, add it to Firebase Authentication authorized domains.
- Check Firebase console usage and billing settings before large-scale use.

## Data model
Movie documents in `movies` use fields such as `title`, `year`, `genre`, `description`, `posterUrl`, `backdropUrl`, `trailerUrl`, `movieUrl`, `featured`, `trending`, `published`, and `updatedAt`. The public settings document is `siteSettings/public` and contains a `genres` array plus ordered `trendingIds` and `featuredIds`.

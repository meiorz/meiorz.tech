# Deploying www.meiorz.tech

This repo (`meiorz/meiorz.tech`) keeps the site in `site/`. GitHub Actions checks it and publishes it to **Firebase Hosting**:

| Workflow | When | What it does |
|---|---|---|
| `.github/workflows/site-checks.yml` | every PR, every push to `main` | runs `tools/build-site.mjs --check` (the pages in `site/` match the strings and layouts in `res/`), `tools/check-site.mjs` (privacy, CSP, links, config, file types, size budgets, corrected claims and removed details), `tools/test-removed-details.mjs` and `tools/check-obby.mjs` |
| `.github/workflows/firebase-hosting.yml` | push to `main` | runs `build-site.mjs --check` and `check-site.mjs` again, then deploys `site/` to the live site |
| same | PR opened or updated | deploys a **public** preview channel and comments its URL on the PR; the channel expires after 7 days |

Two files at the repository root configure the hosting:

- `firebase.json`: what to publish (`site/`), the security headers (including the Content-Security-Policy), the redirects from the old blog URLs and the content types for `.luau`, `.md` and `.txt`. Missing pages get `site/404.html` automatically.
- `.firebaserc`: which Firebase project to deploy to.

You do steps 1–4 yourself. None of them can be done from a pull request. Until step 4, www.meiorz.tech keeps pointing where it points today.

## 1. Create the Firebase project

1. Open <https://console.firebase.google.com/> and choose **Create a project**. Google Analytics is not needed: leave it off (the site promises no trackers).
2. The free **Spark** plan is enough for this site.
3. Note the **project ID** (Project settings → General). Put it in `.firebaserc`, replacing `REPLACE_WITH_YOUR_FIREBASE_PROJECT_ID`:

   ```json
   { "projects": { "default": "your-project-id" } }
   ```

## 2. Deploy once by hand

```sh
npm install -g firebase-tools
firebase login
node tools/build-site.mjs --check
node tools/check-site.mjs
firebase deploy --only hosting
```

The site is then live at `https://<project-id>.web.app`. Check there, before any DNS change:

```sh
curl.exe -sI https://<project-id>.web.app/                      # 200 with a content-security-policy header
curl.exe -sI https://<project-id>.web.app/obby/obbycourse.luau  # content-type: text/plain; charset=utf-8
curl.exe -sI https://<project-id>.web.app/blog/                 # 301 to /archive/blog/
curl.exe -sI https://<project-id>.web.app/no-such-page          # 404
```

## 3. Let GitHub Actions deploy

The workflow needs one secret, `FIREBASE_SERVICE_ACCOUNT`: the JSON key of a service account that may deploy to Hosting. The CLI creates the account and stores the secret for you. In your own terminal, in this repo:

```sh
firebase init hosting:github
```

- Repository: `meiorz/meiorz.tech`.
- When it offers to set up workflows or overwrite files, answer **No**: `.github/workflows/firebase-hosting.yml` is already here, and it runs the checks before it deploys.
- If the secret it created has a different name (for example `FIREBASE_SERVICE_ACCOUNT_<PROJECT_ID>`), either rename it in **Settings → Secrets and variables → Actions** or change the two `firebaseServiceAccount:` lines in the workflow to match.

Never paste the key into a file in the repo, a commit, or a chat.

Then push to `main`. **Site checks** and **Deploy to Firebase Hosting** run; a pull request gets a preview URL as a comment.

## 4. Point www.meiorz.tech at Firebase

1. In the console: **Hosting → Add custom domain**, enter `www.meiorz.tech`.
2. Add the DNS records it shows at your DNS provider (a TXT record to prove ownership, then the A or CNAME record). Keep the old record until Firebase says the domain is verified, then switch in one sitting.
3. The certificate is issued automatically; it can take a few hours. Until then browsers may warn.
4. Check:

   ```sh
   nslookup www.meiorz.tech 8.8.8.8
   curl.exe -sI https://www.meiorz.tech/     # 200 with a content-security-policy header, not a redirect
   ```

## 5. The bare domain (meiorz.tech)

Either add `meiorz.tech` as a second custom domain in **Hosting** and choose **Redirect to www.meiorz.tech**, or keep your DNS provider's forwarding with a permanent redirect to `https://www.meiorz.tech/`. The pages always link to the `www` address.

## 6. Go-live checklist

- [ ] `.firebaserc` holds the real project ID.
- [ ] `curl.exe -sI https://www.meiorz.tech/` returns `200` from the new site, with the `content-security-policy` header.
- [ ] `curl.exe -sI https://meiorz.tech/` returns `301` to `https://www.meiorz.tech/`.
- [ ] The old Azure Static Web App is deleted (or its custom domain removed), so nothing else answers for the domain.
- [ ] The `AZURE_STATIC_WEB_APPS_API_TOKEN` secret is deleted from the repository.
- [ ] GitHub profile: public e-mail hidden or `business@meiorz.tech`; URL `https://www.meiorz.tech/`.
- [ ] **Keep old personal pages private.** Old Notion pages stay unpublished (**Share → Publish → off**).

## Troubleshooting

| Symptom | Fix |
|---|---|
| The deploy step fails with a permission or credential error | The `FIREBASE_SERVICE_ACCOUNT` secret is missing, has another name, or belongs to another project. Run `firebase init hosting:github` again (step 3). |
| The deploy step cannot find a project | `.firebaserc` still holds the placeholder. Put the project ID in it (step 1). |
| `build-site.mjs --check` reports a file is out of date | `site/index.html`, `site/404.html` and `site/js/strings.js` are generated. Edit `res/values/strings.xml` or `res/layout/`, run `node tools/build-site.mjs` and commit the result. |
| `.luau` downloads instead of showing as text | Its Content-Type comes from the `**/*.@(luau|txt)` headers entry in `firebase.json`. `check-site.mjs` fails if that entry is gone. |
| A link works locally but 404s in production | Firebase Hosting paths are case-sensitive and Windows isn't. `check-site.mjs` compares paths case-exactly; run it. |
| `check-site.mjs` reports `file-type` | Only file types the privacy check can read may deploy (text, HTML, SVG, PNG, JPEG, ICO). A PDF or Word CV can carry your phone number and metadata unseen: publish `resume.txt` instead. |
| `check-site.mjs` reports `personal-name` | The name is off the site for now: use the handle, meiorz, or the first person. |
| `check-site.mjs` reports `follower-count` | No follower or subscriber number is published, not even as a goal. |
| `check-site.mjs` reports `course-grade`, `transfer-target` or `weekly-hours` | These details were removed from the site on purpose: course names and codes stay, but no grades, no named transfer-target universities and no weekly hours. |
| `check-site.mjs` reports `degree-claim` | The site names the college and the field of study only: no A.S., associate degree or graduation date. |
| `check-site.mjs` reports `future-plan` | Goals and plans are not published: no transfer target, no "expected" or "target" term, no certificate that is still in progress. Say what is done. |

## Working locally

```sh
node tools/build-site.mjs      # after editing res/: renders site/index.html, 404.html, js/strings.js
node tools/check-site.mjs      # add --strict to fail on warnings too
node tools/check-obby.mjs
python -m http.server --directory site 8080   # then open http://localhost:8080/
firebase emulators:start --only hosting       # like production: applies firebase.json (headers, redirects, 404)
```

**Private terms.** `check-site.mjs` never spells out private values (treat this repo as public). It catches phone-number shapes and other e-mail addresses on its own, but it can't know, say, your stream handle or old social handles. Store those as a repository secret, separated by commas:

```sh
gh secret set CHECK_SITE_PRIVATE_TERMS --repo meiorz/meiorz.tech
```

To use the same terms locally, set the variable for one run without saving it to a file:

```sh
CHECK_SITE_PRIVATE_TERMS="term one,term two" node tools/check-site.mjs
```

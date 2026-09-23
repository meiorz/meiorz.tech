# Deploying www.meiorz.tech

This repo (`meiorz/meiorz.tech`) keeps the site in `site/`. GitHub Actions checks it and publishes it to **Azure Static Web Apps (SWA)**:

| Workflow | When | What it does |
|---|---|---|
| `.github/workflows/site-checks.yml` | every PR, every push to `main` | runs `tools/check-site.mjs` (privacy, CSP, links, config, file types, size budgets, corrected claims) and `tools/check-obby.mjs` |
| `.github/workflows/azure-static-web-apps.yml` | push to `main` | runs `check-site.mjs` again, then deploys `site/` to production |
| same | PR opened or updated | deploys a **public** preview and comments its URL on the PR |
| same | PR closed | deletes that preview |

Nothing is built, bundled or installed. The repo has no Jekyll and doesn't use GitHub Pages, so leave **Settings → Pages** off.

You do steps 1–6 yourself. None of them can be done from a pull request. Until step 4, www.meiorz.tech keeps pointing where it points today.

---

## 1. Create the Static Web App

1. In <https://portal.azure.com> choose **Create a resource → Static Web App → Create**.
2. On **Basics**, fill in:
   - **Resource group:** a new one, for example `rg-meiorz-site`.
   - **Name:** for example `meiorz-site`. The default hostname is random either way.
   - **Plan type:** **Free**. You can switch later under **Settings → Hosting plan**.
   - **Region:** any, for example West US 2. It only affects where preview environments run.
   - **Deployment details → Source:** **Other**. The workflow in this repo does the deploying.
3. Choose **Review + create → Create**, then **Go to resource**.

If your subscription runs on a student or trial credit, it is disabled when the credit or term runs out, and a disabled subscription stops serving even a Free app.

## 2. Create the GitHub repo and store the deployment token

1. **Before the first commit**, pick the e-mail address your commits carry. Every commit stores it, and anyone who can see the repo can read it, now or after you make the repo public. Use your GitHub no-reply address (shown under **Settings → Emails** once **Keep my email addresses private** is on) or `business@meiorz.tech`:

   ```sh
   git config user.email "<id>+meiorz@users.noreply.github.com"
   ```

2. Check `git status`, then make the first commit. Committing is local; nothing is published yet.

   ```sh
   git add -A
   git commit -m "Initial site"
   ```

3. Create the repository and connect this folder to it. Private is fine while you review: the workflows run either way (a private repo uses your account's included Actions minutes). Making it public later publishes its whole history too.

   ```sh
   gh repo create meiorz/meiorz.tech --private --source . --remote origin
   ```

4. On the app's **Overview** page in Azure choose **Manage deployment token** and copy the token. In your own terminal run the command below and **paste the token when prompted**. Don't put the token on the command line, in a file, or in any chat.

   ```sh
   gh secret set AZURE_STATIC_WEB_APPS_API_TOKEN --repo meiorz/meiorz.tech
   ```

To rotate it later: **Manage deployment token → Reset token**, then run the same command again.

## 3. First push, then check the deploy

1. Push `main`:

   ```sh
   git push -u origin main
   ```

   The push runs **Site checks** and **Deploy to Azure Static Web Apps**. Production goes to the app's default host, `https://<random>.<n>.azurestaticapps.net` (shown on the app's **Overview** page). www.meiorz.tech doesn't change yet. The default host isn't linked anywhere, but anyone who has the URL can open it.
2. Check it with `curl.exe` (PowerShell) or `curl` (any shell). Replace `<host>` with the default host (or, later, a PR preview host):

   ```sh
   curl.exe -sI https://<host>/                       # 200; content-security-policy, x-frame-options, referrer-policy present
   curl.exe -sI https://<host>/no-such-page           # 404 (not 200): the custom 404 page keeps the status
   curl.exe -sI https://<host>/obby/obbycourse.luau   # 200, content-type: text/plain; charset=utf-8
   curl.exe -sI https://<host>/index.md               # content-type: text/markdown; charset=utf-8
   curl.exe -sI https://<host>/resume                 # 301, location: /resume.txt
   curl.exe -sI https://<host>/blog/                  # 301, location: /archive/blog/
   ```

   Also open it in a browser with DevTools → Console: there should be no CSP errors.
3. From now on, change the site through pull requests. Each PR gets a preview (`https://<name>-<pr>.<region>.azurestaticapps.net`, commented on the PR); merging deploys production.

## 4. Point www.meiorz.tech at the app

Today `www` is a CNAME to a forwarding service that redirects to another page. Keep that forward until the app has **validated** the domain, then switch DNS in one sitting. Changing the CNAME or deleting the forward earlier breaks every link to www.meiorz.tech until the switch is done.

1. **Validate first (nothing visible changes yet).** In the portal: **Settings → Custom domains → + Add → Custom domain on other DNS**. Enter `www.meiorz.tech`, choose **Next**, set **Hostname record type** to **TXT**, then **Generate code** and copy it.
2. In the registrar's DNS panel **add** a TXT record: host `_dnsauth.www`, value = the code. Leave the `www` CNAME and the forward alone.
3. Wait until the portal shows the domain as validated. Check the record with:

   ```sh
   nslookup -type=TXT _dnsauth.www.meiorz.tech 8.8.8.8
   ```

4. **Then switch, in one sitting**, in the registrar's DNS panel:
   - **Edit** the existing `www` CNAME (don't add a second one) from `r.forwarddomain.net` to the app's default host, `<random>.<n>.azurestaticapps.net` (no `https://`).
   - **Delete** the TXT record `fwd.www`.
   - Keep the `_dnsauth.www` TXT record, the MX and SPF records (e-mail) and the apex records.
5. Wait for the old TTL (2 hours) to expire. Check with:

   ```sh
   nslookup -type=CNAME www.meiorz.tech 8.8.8.8
   curl.exe -sI https://www.meiorz.tech/     # 200 with a content-security-policy header, not a redirect
   ```

6. In **Custom domains**, select `www.meiorz.tech` and choose **Set default**. The `azurestaticapps.net` hostname then redirects to it.

If TXT validation stays *Validating* for hours: remove the domain, wait, and add it again. The fallback is **CNAME** validation, which needs step 4 done first (so www is briefly down while the certificate is issued). If you ever add a CAA record, include `0 issue "digicert.com"`.

Optional stopgap until go-live: change the forward's target (the `fwd.www` and `fwd.meiorz.tech` TXT records) to `https://github.com/meiorz`, so the domain lands on your code instead of your other links. Do the GitHub profile item in step 6 first.

## 5. The bare domain (meiorz.tech)

Keep the forwarding service for the apex and point it at `www` with a permanent redirect. Change the TXT record `fwd.meiorz.tech` to:

```text
http-status=301;forward-domain=https://www.meiorz.tech/*
```

This copies the syntax of the existing record; compare it with the forwarding service's documentation before saving. Leave the apex A/AAAA records as they are. This needs no Azure setup and keeps the Free plan's second custom-domain slot unused.

## 6. Before you share the link (go-live checklist)

Don't send out a CV or application that links www.meiorz.tech until all of these are done:

- [ ] You've gone through the whole site on the default host (every section and command, `resume.txt`, `index.md`, `llms.txt`, the archive) and it says what you want.
- [ ] The production deploy is green (step 3).
- [ ] `curl.exe -sI https://www.meiorz.tech/` returns `200` from the new site, not a redirect (step 4).
- [ ] `curl.exe -sI https://meiorz.tech/` returns `301` to `https://www.meiorz.tech/` (step 5).
- [ ] **GitHub profile** (the site and CV link to it). Public e-mail, company and website are being consolidated. On <https://github.com/settings/profile>:
  - **Public email:** "Don't show my email address", or `business@meiorz.tech` once it is verified under **Settings → Emails**. Choose **Update profile**.
  - **Company:** empty, or something your CV explains.
  - **URL:** `https://www.meiorz.tech/`. meiorz.fyi can sit in one of the social-account links, or stay off the profile until you decide how to use it.
  - Check what signed-in visitors see (logged-out visitors never see the e-mail): `gh api users/meiorz --jq '.email, .company, .blog'`.
- [ ] **Commit e-mail.** In this repo, `git log --format=%ae` lists only the address you chose in step 2.
- [ ] **Keep old personal pages private.** Old Notion pages stay unpublished (**Share → Publish → off**). If you restart the blog, start from a fresh page and check it as this site is checked: no age, class standing, health details or old contact details.
- [ ] **Other public repos**, such as `hills_html` (tutoring materials, staying as they are): their files and commits keep the e-mail used there. Link them from the site or CV only if you're happy with what they show.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Deploy fails with **"Failure during content distribution"** | Known SWA issue with `skip_app_build: true` (Azure/static-web-apps#1803). Delete that one line from `azure-static-web-apps.yml`. `site/` has no `package.json` or `Gemfile`, so the builder logs that it can't find build steps and uploads the folder unchanged. `check-site.mjs` keeps build manifests out of `site/`. |
| **"No matching Static Web App was found or the api key was invalid"** | The secret doesn't match the app, or it isn't set yet. Reset the token and set the secret again (step 2). |
| A 4th open PR fails to deploy | The Free plan allows 3 preview environments. Close a PR, or delete a stale one under **Environments** in the portal. |
| Fork or Dependabot PRs skip the deploy | Intended: those runs get no secrets. **Site checks** still runs for them. |
| `.luau` returns 404 or the wrong type | SWA blocks some extensions. Rename `site/obby/obbycourse.luau` to `obbycourse.luau.txt` and update every place that names it: `site/js/obby.js` (`COURSE_URL`), `site/js/term.js` (the `obby` folder in the file list and the help text), `site/index.html`, `site/index.md`, `site/llms.txt`, `REQUIRED` in `tools/check-site.mjs`, and the default course path in `tools/check-obby.mjs` (or pass `--course site/obby/obbycourse.luau.txt` in `site-checks.yml`). Then run both checks; `check-site.mjs` lists any link that still points at the old name. |
| A mime type with `; charset=utf-8` is rejected | Use plain `text/plain` / `text/markdown` in `mimeTypes`. |
| A link works locally but 404s in production | SWA paths are case-sensitive and Windows isn't. `check-site.mjs` compares paths case-exactly; run it. |
| `check-site.mjs` reports `file-type` | Only file types the privacy check can read may deploy (text, HTML, SVG, PNG, JPEG, ICO). A PDF or Word CV can carry your phone number and metadata unseen: publish `resume.txt` instead. |
| `check-site.mjs` reports `follower-count` | A follower number reads as a current count. Only a goal may name one, with "goal" earlier in the same sentence, for example "Public goal: grow to 20K followers, building in public." |
| `check-site.mjs` reports `degree-claim` | The site describes a transfer path (IGETC and CS major preparation, target junior transfer Fall 2028): no A.S., associate degree or graduation date. |

## Working locally

```sh
node tools/check-site.mjs      # add --strict to fail on warnings too
node tools/check-obby.mjs
python -m http.server --directory site 8080   # then open http://localhost:8080/
```

The local server does not apply `site/staticwebapp.config.json` (no CSP, redirects or 404 page), so check those on the default host or a PR preview.

**Private terms.** `check-site.mjs` never spells out private values (treat this repo as public). It catches phone-number shapes and other e-mail addresses on its own, but it can't know, say, your stream handle or old social handles. Store such terms as a repo secret. The prompt takes a single line, so separate them with **commas**. Matches are reported by position only.

```sh
gh secret set CHECK_SITE_PRIVATE_TERMS --repo meiorz/meiorz.tech
```

To use them locally, type them without echo and without saving them in shell history, run the check, then clear them:

```powershell
# PowerShell 7
$env:CHECK_SITE_PRIVATE_TERMS = Read-Host -MaskInput 'Private terms (comma-separated)'
node tools/check-site.mjs
Remove-Item Env:CHECK_SITE_PRIVATE_TERMS
```

```sh
# bash
read -rsp 'Private terms (comma-separated): ' CHECK_SITE_PRIVATE_TERMS; echo
CHECK_SITE_PRIVATE_TERMS="$CHECK_SITE_PRIVATE_TERMS" node tools/check-site.mjs
unset CHECK_SITE_PRIVATE_TERMS
```

**Optional:** in **Settings → Branches**, protect `main` and require the **Site checks** status check before merging. On a private repo this needs a paid GitHub plan; on a public repo it is free.

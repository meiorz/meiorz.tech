# meiorz.tech

Source of [www.meiorz.tech](https://www.meiorz.tech/), a personal portfolio site. It is a plain, readable page: every section is static HTML that needs no JavaScript. With JavaScript on, a small terminal at the end of the page also takes commands, runs a tiny obby platformer and runs `meiorz-cli`, a scripted command line about the site.

- Static HTML, CSS and JavaScript: no dependencies, no CDN, no trackers, no cookies.
- Copy lives in string resources (`res/values/strings.xml`), apart from markup and code, the way an Android app keeps it. One dependency-free script renders the pages; the output is committed, so `site/` still deploys as-is.
- Strict Content Security Policy (no inline scripts or styles), light and dark themes, WCAG 2.2 AA as the target.
- Hosted on Firebase Hosting.
- Built with an AI-assisted (agentic coding) workflow.

## Layout

```text
res/
  values/strings.xml       every string, by name
  layout/*.html            page layouts: @string/name and @array/name instead of copy
site/                      deployed as-is
  index.html, 404.html     generated from res/ (do not edit)
  js/strings.js            generated: the strings the scripts use
  css/  js/  img/          styles, scripts (shell, obby, meiorz-cli, theme), images
  obby/obbycourse.luau     Luau-flavored data module; the obby game parses it at runtime
  archive/                 older blog posts and the 2023 home page, kept as-is
  resume.txt, index.md, llms.txt, robots.txt, sitemap.xml
tools/
  build-site.mjs           renders res/ into site/; --check fails if site/ is out of date
  check-site.mjs           privacy, CSP, links, config, budgets and claims checks
  test-removed-details.mjs fixtures for the rules that keep removed details off the site
  lib/removed-details.mjs  those rules: grades, transfer targets, weekly hours, follower numbers
  check-obby.mjs           proves the obby course can be finished
  make-og.mjs              regenerates site/img/og.png
firebase.json              Firebase Hosting: headers (CSP), redirects, content types
.firebaserc                which Firebase project to deploy to
.github/workflows/         checks on every PR; deploy to Firebase Hosting
DEPLOY.md                  setup, DNS and the go-live checklist
```

## Edit the copy

Text is never written into the pages or the shell script directly:

```xml
<!-- res/values/strings.xml -->
<string name="about_title">About</string>
<string name="term_loading">Loading %1$s…</string>
```

```html
<!-- res/layout/index.html -->
<h2 id="h-about">@string/about_title</h2>
```

```js
// site/js/term.js
status(stringResource(R.string.term_loading, name));
```

Then render the pages and commit the result:

```sh
node tools/build-site.mjs
```

The build fails on an unknown name and on a string nothing uses. The obby and meiorz-cli programs, the archive pages and the plain-text copies (`resume.txt`, `index.md`, `llms.txt`) still hold their own text.

## Preview locally

```sh
python -m http.server --directory site 8080
```

Then open <http://localhost:8080/>. This server doesn't read `firebase.json`, so the CSP and other headers, the redirects and the 404 page aren't applied locally. Check those on a PR preview.

## Checks

The scripts use only Node.js built-ins, so there is nothing to install (CI uses Node 24):

```sh
node tools/build-site.mjs --check   # site/ matches res/
node tools/check-site.mjs    # add --strict to fail on warnings too
node tools/test-removed-details.mjs
node tools/check-obby.mjs
```

CI runs all four on every pull request and every push to `main`, and the deploy runs the build check and `check-site.mjs` again before it publishes.

## Deploy

See [DEPLOY.md](DEPLOY.md).

## License

© 2026 meiorz. There is no license file yet, so please ask before reusing the content or the code: business@meiorz.tech.

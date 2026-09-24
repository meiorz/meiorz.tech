# meiorz.tech

Source of [www.meiorz.tech](https://www.meiorz.tech/), Mei Okubo's portfolio site. It looks like a terminal: every section is plain HTML that reads fine without JavaScript, and with JavaScript on you can also type commands, play a tiny obby platformer, or try `meii`, a scripted parody CLI.

- Static HTML, CSS and JavaScript: no build step, no dependencies, no CDN, no trackers, no cookies.
- Strict Content Security Policy (no inline scripts or styles), light and dark themes, WCAG 2.2 AA as the target.
- Hosted on Azure Static Web Apps.
- Built with an AI-assisted (agentic coding) workflow.

## Layout

```text
site/                      deployed as-is
  index.html, 404.html
  css/  js/  img/          styles, scripts (shell, obby, meii, theme), images
  obby/obbycourse.luau     Luau-flavored data module; the obby game parses it at runtime
  archive/                 older blog posts and the 2023 home page, kept as-is
  resume.txt, index.md, llms.txt, robots.txt, sitemap.xml
  staticwebapp.config.json headers (CSP), redirects, MIME types, 404 page
tools/
  check-site.mjs           privacy, CSP, links, config, budgets and claims checks
  test-removed-details.mjs fixtures for the rules that keep removed details off the site
  lib/removed-details.mjs  those rules: grades, transfer targets, weekly hours, follower numbers
  check-obby.mjs           proves the obby course can be finished
  make-og.mjs              regenerates site/img/og.png
.github/workflows/         checks on every PR; deploy to Azure Static Web Apps
DEPLOY.md                  setup, DNS and the go-live checklist
```

## Preview locally

```sh
python -m http.server --directory site 8080
```

Then open <http://localhost:8080/>. This server doesn't read `staticwebapp.config.json`, so the CSP and other headers, the redirects and the 404 page aren't applied locally. Check those on a PR preview.

## Checks

The scripts use only Node.js built-ins, so there is nothing to install (CI uses Node 24):

```sh
node tools/check-site.mjs    # add --strict to fail on warnings too
node tools/test-removed-details.mjs
node tools/check-obby.mjs
```

CI runs all three on every pull request and every push to `main`, and the deploy runs `check-site.mjs` again before it publishes.

## Deploy

See [DEPLOY.md](DEPLOY.md).

## License

© 2026 Mei Okubo. There is no license file yet, so please ask before reusing the content or the code: business@meiorz.tech.

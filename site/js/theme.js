/*
 * theme.js: applies saved display preferences before first paint.
 * Loaded as a small, blocking classic script in <head> (before term.css), so
 * there is no flash of the wrong theme. The CSP allows it because it is a
 * same-origin file, not an inline script.
 *
 *   localStorage.theme  = "light" | "dark"  (missing = follow the OS)
 *   localStorage.motion = "off"             (missing = follow the OS)
 *
 * Storage can throw (blocked site data, some private modes), so every access
 * is wrapped; on failure the page simply follows the OS settings.
 */
(function () {
  var root = document.documentElement;
  try {
    var theme = localStorage.getItem('theme');
    if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
    if (localStorage.getItem('motion') === 'off') root.classList.add('motion-off');
  } catch (e) {
    /* storage unavailable: keep the defaults */
  }
})();

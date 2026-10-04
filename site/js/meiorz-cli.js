/**
 * meiorz-cli.js: `meiorz-cli`, a scripted command line about this site.
 * ES module, lazy-loaded by term.js. No AI: a keyword table picks pre-written
 * replies and the spinner is a timer. No network requests, no storage, no
 * product names or logos.
 *
 * Each reply is ONE term.print(), so the log (a live region) reads it once.
 * The spinner is aria-hidden and static under reduced motion. Menus are ARIA
 * listboxes. onExit() settles any spinner or menu so the shell never stalls.
 * The footer under the prompt goes through term.setHint(), never #cmd-help.
 */

import { R } from './strings.js';

const EMAIL = 'business@meiorz.tech';
const MAILTO = `mailto:${EMAIL}?subject=${encodeURIComponent('Hello from meiorz.tech')}`;
const FOOTER_SHORT = 'Scripted · no AI';
const FOOTER_MORE = ' · no network calls — every reply is pre-written';
const FOOTER = FOOTER_SHORT + FOOTER_MORE;
const FRAMES = [...'⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'];
const THINK_MS = [800, 2200]; // how long a reply takes to appear

/** Spinner verbs as [working, done]: original, none borrowed from a real product. */
const VERBS = [
  ['Dereferencing', 'Dereferenced'], ['Garbage-collecting', 'Garbage-collected'], ['Branch-delaying', 'Branch-delayed'],
  ['Fingerspelling', 'Fingerspelled'], ['Rubber-ducking', 'Rubber-ducked'], ['Rigging', 'Rigged'],
  ['Segfault-dodging', 'Segfault-dodged'], ['Obby-hopping', 'Obby-hopped'],
  ['Stack-unwinding', 'Stack-unwound'],
];
/** The (purely cosmetic) mode indicator under the prompt; Shift+Tab cycles it. */
const MODES = [['⏵⏵', 'accept compliments on'], ['⏸', 'snack mode on'], ['⏵⏵', 'obby mode on']];

/** System strings that follow /lang. Menus are [title, detail, question, options]. */
const TEXT = {
  en: {
    esc: 'esc to interrupt',
    stop: 'Interrupted · what should the not-AI do instead?',
    keys: '↑/↓ + Enter, or a number · Esc = no',
    cancel: 'Cancelled.',
    bye: 'meiorz-cli exited · $0.00 · nothing you typed left this page. Back to the real shell.',
    fallback: [
      'I’m a switch statement in a trench coat. Try /help.',
      'No keyword matched. Try: who is this, experience, projects, fix my segfault.',
      'That’s outside my script. meiorz’s range is wider: /resume.',
    ],
    rm: ['Bash command', 'Permanently remove node_modules from this workspace', 'May I proceed?',
      ['Yes', 'Yes, and in every repo', 'No, leave it']],
    hire: ['Open email', '', `Open your email app to write to ${EMAIL}?`, ['Yes', 'Yes, after the obby', 'No, just browsing']],
  },
  ja: {
    esc: 'esc で中断',
    stop: '中断しました · AI ではない私に、代わりに何をしてほしいですか？',
    keys: '↑/↓ + Enter、または数字 · Esc =「いいえ」',
    cancel: 'キャンセルしました。',
    bye: 'meiorz-cli を終了しました · $0.00 · 入力した内容はこのページから出ていません。本物のシェルに戻ります。',
    fallback: ['私はトレンチコートを着た switch 文です。/help をどうぞ。'],
    rm: ['Bash コマンド', 'このワークスペースから node_modules を完全に削除します', '続行しますか？',
      ['はい', 'はい、全リポジトリで', 'いいえ、そのままにする']],
    lang: ['言語', '表示言語を日本語に切り替えます', '続行しますか？', ['はい', 'いいえ']],
    on: '日本語モードにしました。一部のメニューとシステムメッセージが日本語になります（台本の返事は英語のまま）。meiorz は英語と日本語が堪能で、STEM 分野に限ってアメリカ手話（ASL）も使えます。/lang en で英語に戻ります。',
    off: 'わかりました。英語のままにします。',
  },
};

const SLASH = [
  ['help', 'this list'], ['resume', 'not that kind of resume: meiorz’s résumé'], ['skills', 'everything on the CV'],
  ['obby', 'leave the CLI, play the obby'], ['cost', 'what this session cost'],
  ['clear', 'clear the screen'], ['hire', 'write to meiorz'], ['lang ja', 'Japanese menus · /lang en switches back'], ['exit', 'back to the real shell'],
];
const WELCOME_TRY = ['who is this', 'experience', 'fix my segfault', 'rm -rf node_modules', '/help'];
const TRY = ['who is this', 'experience', 'projects', 'data structures', 'fix my segfault', 'now in java', 'explain jal',
  'rm -rf node_modules', 'are you an AI?', 'ultrathink'];

/** The keyword table: [pattern, reply]. Runs on normalize(line); the first match wins. */
const RULES = [
  [/^(exit|quit|q|bye)$/, 'exit'],
  [/^(help\b|h$)/, 'help'],
  [/^(clear|cls)$/, 'clear'],
  [/node ?modules|procrastinat/, 'rm'], // before the shell rule: normalize() turns "./node_modules" into "node modules"
  [/^(sudo|rm|meiorz cli|ls|cd|cat|pwd|git|npm|vim)\b/, 'shell'],
  [/^(hi|hello|hey)( there)?$|こんにちは/, 'hello'],
  [/^(nice|cool|great|awesome|love|neat|thanks|thank you|wow)\b/, 'compliment'],
  [/\b(are you (an? )?(ai|bot|human|real)|llm|model)\b|^(who|what) are you$/, 'ai'],
  [/\b(ultrathink|think harder)\b/, 'ultrathink'],
  [/\broblox\b|\bwhy (games?|obby|obbies|us|our company|this company)\b/, 'why'],
  [/\b(experience|work history|past jobs?|jobs? (has|did|had)|employment|volunteer\w*|ambassador|worked(?! on\b))\b/, 'experience'],
  [/\b(hire|hiring|internships?|intern|recruit\w*|jobs?)\b/, 'hire'],
  [/\br[eé]sum[eé]|\bcv\b/, 'resume'],
  [/\b(segfault|seg fault|linked list|use after free|debug\w*|fix my (code|bug))\b/, 'segfault'],
  [/\b(java|garbage collect\w*)\b/, 'java'],
  [/\b(jal|mips|assembly|delay slot|cs ?270)\b/, 'mips'],
  [/\b(data structures?|algorithms?|adts?|dsa)\b/, 'dsa'],
  [/\b(tutor\w*|teach\w*|ta|homework|assignment|do my)\b/, 'tutor'],
  [/\b(school|college|ccsf|educat\w*|degree|universit\w*|calculus|(az|ms|ai|dp) ?900|class(es)?|courses?|stud(y|ies|ent)|cert\w*)\b/, 'education'],
  [/\b(projects?|portfolio|work(ed|ing) on|lull|hop ?out|material icons|obsidian|plugins?|extensions?|dark (mode|theme))\b/, 'projects'],
  [/\b(asl|sign( language)?|signing|interpret\w*|fingerspell\w*|translate|deaf)\b/, 'asl'],
  [/\bjapanese\b|日本語/, 'japanese'],
  [/\b(bert|sentiment|nlp|pytorch|ml|machine learning|inspirit)\b/, 'bert'],
  [/\b(this site|website|csp|meiorz|accessib\w*)\b/, 'site'],
  [/\b(skills?|languages?|stack|python|kotlin|sql|docker|terraform|linux)\b|(^| )c\+\+( |$)/, 'skills'],
  [/\b(obby|games?|play|luau)\b/, 'obby'],
  [/\b(contact|e ?mail|linkedin|github)\b/, 'contact'],
  [/^whoami$|\b(who|about|bio|where)\b/, 'who'],
];

/**
 * Scripted replies: a string, an array or a function returning one ({ lang, lines }
 * for Japanese). Strings become "● " lines. Claims about the site’s owner come only from the
 * site's facts sheet (shared lists come from the string resources, ./strings.js);
 * tool calls ("● Read(...)") are props.
 */
const REPLIES = {
  who: (s) => [
    s.tool('Bash', 'whoami'),
    'meiorz: Computer Science student at City College of San Francisco, Inspirit AI Scholar, CS tutor/TA since Sep 2024, and the human behind this “agent”. Based in San Francisco, CA.',
    s.say('More: ', s.join(['experience', 'projects', 'skills', '/resume', '/hire'].map((q) => s.btn(q)))),
  ],
  experience: (s) => [
    s.tool('Read', 'experience.md'), s.result('Read 3 roles'),
    'CS Tutor / Teaching Assistant at City College of San Francisco, Sep 2024 – present: debugs student code live in C++, Java and Python, explains the reasoning instead of handing over the fix, and translates complex concepts for students with varied backgrounds.',
    'Inspirit AI Ambassador & AI Scholar alum, Mar 2023 – Aug 2024: reached out to more than 100 people, inviting them to join the upcoming AI Scholar curriculum.',
    'Full details: /resume · /hire',
  ],
  dsa: (s) => [
    s.tool('Read', 'education.md'), s.result('Found 3 courses'),
    'Data structures & algorithms, twice: CS 110C in C++ and CS 111C in Java, both covering ADTs. Also CS 270, Computer Architecture & Assembly (MIPS).',
    s.say('As a CS tutor, meiorz debugs this kind of code live with students. Demos: ',
      s.join(['fix my segfault', 'now in java', 'explain jal'].map((q) => s.btn(q)))),
  ],
  why: 'The obby is a small tribute to obbies everywhere: /obby (leaves the CLI).',
  ai: 'No. I’m a keyword table and a switch statement in a trench coat: no model, no network calls, and nothing you type leaves this page. The human is meiorz: /resume.',
  ultrathink: (s) => ['Conclusion: this switch statement has no default case. Adding one.', s.result('It already had one. You’re reading it.')],
  resume: (s) => [s.say('Not that kind of resume. This one is meiorz’s résumé, in plain text: ', s.link('/resume.txt', 'resume.txt'))],
  segfault: (s) => [
    s.tool('Update', 'linked_list.cpp'),
    s.result('Added 3 lines, removed 2 lines', s.diff([['-', 17, '  delete head;'], ['-', 18, '  head = head->next;'],
      ['+', 17, '  Node* next = head->next;'], ['+', 18, '  delete head;'], ['+', 19, '  head = next;']])),
    'Use-after-free: line 18 dereferenced head after line 17 deleted it. Tutor mode would have asked first: why did line 18 crash? meiorz tutors C++, Java and Python; the explaining is the point.',
  ],
  java: (s) => [
    s.tool('Write', 'LinkedStack.java'),
    s.result('Wrote 4 lines', s.diff(['T pop() {', '  T item = head.item;', '  head = head.next; // old node: GC', '  return item; }']
      .map((line, i) => ['+', i + 1, line]))),
    'Same ADT, no delete: the garbage collector reclaims the old node. meiorz’s data structures courses covered ADTs in C++ (CS 110C) and Java (CS 111C).',
  ],
  mips: (s) => [
    s.tool('Bash', 'spim -file hello.s'), s.result('Hello, obby!'),
    'jal saves the return address in $ra and jumps; jr $ra comes back. On classic MIPS, the delay slot after a jump runs anyway (CS 270).',
  ],
  tutor: 'Since Sep 2024, meiorz has tutored CS at City College of San Francisco: live debugging in C++, Java and Python, explaining the reasoning instead of handing over the fix. So no homework from me either. Which line is confusing?',
  education: (s) => [
    s.tool('Read', 'education.md'),
    'Computer Science at City College of San Francisco. Also Calculus I–II.',
    s.todos([R.string.education_course_cs110c, R.string.education_course_cs111c, R.string.education_course_cs270].map((course) => [course, 1])),
    `Certifications: ${R.array.education_certifications.join('; ')}.`,
  ],
  projects: (s) => [
    s.tool('Bash', 'ls -l projects/'),
    s.say('Lull: a Chrome extension that gives every website a soft, predictable dark theme, with no white flash. ', s.link('https://github.com/meiorz/lull', 'github.com/meiorz/lull')),
    s.say('HopOut: a VS Code extension that hops the cursor out of the nearest quote, bracket or paren (MIT). ', s.link('https://github.com/meiorz/hopout', 'github.com/meiorz/hopout')),
    s.say('Material Icons Inline: an Obsidian plugin that renders Google Material Icons from !icon[name] in notes, with the font bundled for offline use (MIT). ', s.link('https://github.com/meiorz/material-icons-obsidian', 'github.com/meiorz/material-icons-obsidian')),
    s.say('Tweet sentiment with BERT: Inspirit AI Scholar project from spring 2022 (Python, PyTorch), presented at Demo Day. More: ', s.btn('bert')),
  ],
  asl: 'I can’t sign; I don’t have hands. meiorz can: American Sign Language, limited to STEM communication, where a term without an established sign often gets fingerspelled: P-O-L-Y-M-O-R-P-H-I-S-M.',
  japanese: 'meiorz is fluent in English and Japanese, and can use American Sign Language for STEM communication. Try /lang ja.',
  bert: (s) => [
    s.tool('Read', 'projects/bert-sentiment.md'), s.result('Read 1 project'),
    'meiorz’s Inspirit AI Scholar project from spring 2022 (Python, PyTorch): fine-tuned Google BERT on labeled tweets and presented the results and error analysis at Demo Day. meiorz was also an Inspirit AI Ambassador (Mar 2023 – Aug 2024). I classify sentiment with a regex.',
  ],
  site: 'This site: static, plain, accessible (WCAG 2.2 AA target), strict CSP, no trackers, built with an AI-assisted (agentic coding) workflow.',
  skills: (s) => [
    s.tool('Grep', '"skills" resume.txt'), s.result('Found 5 groups'),
    s.h('dl', { class: 'kv' }, [
      [R.string.skills_languages_label, R.string.skills_languages],
      [R.string.skills_systems_label, R.string.skills_systems],
      [R.string.skills_tooling_label, R.string.skills_tooling],
      [R.string.skills_ai_label, R.string.skills_ai],
      [R.string.skills_spoken_label, R.string.skills_spoken],
    ].map(([k, v]) => [s.h('dt', { text: k }), s.h('dd', { text: v })])),
  ],
  obby: 'meiorz’s Mini Obby: an obstacle course on a text grid, written in JavaScript; the course is a real Luau module, parsed at runtime. Play it: /obby (leaves the CLI).',
  contact: (s) => [s.say('Email ', s.link(MAILTO, EMAIL), ' · GitHub ', s.link('https://github.com/meiorz', 'github.com/meiorz'),
    ' · LinkedIn ', s.link('https://www.linkedin.com/in/mei-o-525a0b227', 'linkedin.com/in/mei-o-525a0b227')), '/hire opens your email app.'],
  hello: 'Hi! I’m meiorz-cli, a scripted command line. Ask about meiorz, or try /help.',
  compliment: 'Compliment accepted (see the mode indicator). I’d pass it on to meiorz, but this page doesn’t store anything you type.',
  shell: 'I only do scripted answers, and I only rm one thing: node_modules. For real commands: /exit.',
  fallback: (s) => {
    const list = s.t('fallback');
    const line = list[s.fallbackIx++ % list.length];
    return s.lang === 'ja' ? { lang: 'ja', lines: [line] } : line;
  },
};

let uid = 0;
const nextId = (what) => `cli-${what}-${++uid}`;

/** Lowercase, Unicode-normalized, punctuation turned into spaces (keeps + and # for c++ and c#). */
const normalize = (line) => String(line).toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}+#\s]/gu, ' ').replace(/\s+/g, ' ').trim();

/** One visit to meiorz-cli, from start() to onExit(). */
class Session {
  constructor(term) {
    this.term = term;
    this.h = term.el;
    this.lang = 'en';
    this.mode = 0; // index into MODES
    this.shiftTabs = 0; // Shift+Tab presses in a row since #cmd got focus
    this.replies = 0;
    this.started = Date.now();
    this.verbIx = 0;
    this.fallbackIx = 0;
    this.chain = Promise.resolve(); // one reply at a time, typed or clicked
    this.spin = null; // the running spinner: { stop(finished) }
    this.openMenu = null; // the open permission menu: { cancel() }
    this.menuHow = ''; // how the last menu was answered: 'keyboard', 'mouse', 'touch', 'pen'
    this.buttons = []; // our buttons, disabled on exit
    this.modeEl = null;
    this.footer = null; // the hint under the prompt (set with term.setHint)
    this.self = null; // our mode object, for popMode(self)
    this.lastOut = null; // the newest reply
    this.closed = false;
    this.quiet = false; // skip the goodbye (used by /obby)
    this.onFocusIn = (e) => {
      if (e.target && e.target.id === 'cmd') this.shiftTabs = 0;
    };
  }

  t(key) {
    return TEXT[this.lang][key] ?? TEXT.en[key];
  }

  ja() {
    return this.lang === 'ja' ? 'ja' : null;
  }

  /** How a click happened: 'keyboard', 'mouse', 'touch', 'pen', or '' (no event). */
  howOf(e) {
    if (!e) return '';
    if (e.detail === 0) return 'keyboard';
    return e.pointerType || (this.term.isCoarsePointer() ? 'touch' : 'mouse');
  }

  // ---- DOM builders: text always goes in as text, never as HTML ----

  hide(text) {
    return this.h('span', { text, attrs: { 'aria-hidden': 'true' } });
  }

  say(...kids) {
    return this.h('p', { class: 'cli-tool' }, this.hide('● '), ...kids);
  }

  tool(name, arg) {
    return this.h('p', { class: 'cli-tool' }, this.h('span', { class: 'cli-dot', text: '● ', attrs: { 'aria-hidden': 'true' } }),
      this.h('strong', { text: name }), arg && `(${arg})`);
  }

  /** "⎿ result": strings are lines; nodes (diff lines) go in as they are. */
  result(...parts) {
    const div = this.h('div', { class: 'cli-result' }, this.hide('⎿  '));
    parts.forEach((p, i) => div.append(typeof p === 'string' && i ? `\n   ${p}` : p));
    return div;
  }

  /** Numbered +/- lines, in a <pre> that scrolls sideways on narrow screens. */
  diff(rows) {
    return this.h('pre', { attrs: { 'data-label': 'Diff' } }, rows.map(([sign, n, code]) => this.h('span',
      { class: sign === '+' ? 'cli-diff-add' : 'cli-diff-del' },
      this.h('span', { class: 'visually-hidden', text: sign === '+' ? 'added: ' : 'removed: ' }), `${String(n).padStart(3)} ${sign} ${code}`)));
  }

  /** ☒/☐ list; with strike, done items are crossed out like a finished to-do. */
  todos(items, strike = false) {
    return this.h('ul', { class: 'cli-todo' }, items.map(([text, done]) => this.h('li', { class: strike && done ? 'done' : null },
      this.hide(done ? '☒ ' : '☐ '), text, this.h('span', { class: 'visually-hidden', text: done ? ' (done)' : ' (to do)' }))));
  }

  link(href, text) {
    return this.h('a', { attrs: { href }, text });
  }

  /** A button that asks meiorz-cli something, as if typed. */
  btn(text) {
    const b = this.h('button', { class: 'link-btn', text, attrs: { type: 'button' }, on: { click: (e) => this.ask(text, e) } });
    this.buttons.push(b);
    return b;
  }

  /** Turns the /commands in a sentence into buttons. */
  rich(text) {
    return text.split(/(\/(?:help|resume|obby|hire|exit|lang en|lang ja))/).map((part, i) => (i % 2 ? this.btn(part) : part));
  }

  join(nodes) {
    return nodes.flatMap((n, i) => (i ? [' · ', n] : [n]));
  }

  /** Prints one reply as a single insertion. Strings become "● " lines. */
  reply(parts, lang = null) {
    const nodes = [].concat(parts).map((p) => (typeof p === 'string' ? this.say(...this.rich(p)) : p));
    this.lastOut = this.term.print(this.h('div', { attrs: { lang } }, nodes));
    return this.lastOut;
  }

  // ---- Lifecycle ----

  open(first) {
    const { h, term } = this;
    if (term.isStale && term.isStale()) return; // the visitor moved on while this loaded
    term.print(h('div', {},
      h('div', { class: 'cli-box cli-welcome' },
        h('p', {}, h('strong', {}, this.hide('✿ '), 'Welcome to meiorz-cli')),
        h('p', { class: 'cli-dim', text: `${FOOTER}.` }),
        h('p', { class: 'cli-dim', text: 'Type /help for commands · /exit to leave · cwd: ~/meiorz.tech' })),
      h('p', { class: 'cli-dim' }, 'Try: ', this.join(WELCOME_TRY.map((q) => this.btn(q))))));
    // The hint under the prompt: the "scripted" note (its second half hides on
    // phones) and the mode indicator. Built before pushMode(), so term.js
    // measures the prompt at its real height.
    this.modeEl = h('span', { class: 'cli-mode' });
    this.footer = h('span', { class: 'cli-footer' },
      h('span', {}, FOOTER_SHORT, h('span', { class: 'cli-footer__more', text: FOOTER_MORE })), this.modeEl);
    this.setMode(0, false);
    this.self = {
      name: 'meiorz-cli',
      ps1: h('span', { class: 'cli-accent', text: '>' }),
      placeholder: 'ask about meiorz · /help · /exit',
      hint: this.footer,
      promptClass: 'cli-box',
      echo: false, // handle() echoes, so clicked suggestions look like typed ones
      onSubmit: (line) => this.enqueue(line),
      onKeyDown: (e) => this.onKeyDown(e),
      onExit: () => this.onExit(),
    };
    if (!term.pushMode(this.self)) return;
    document.addEventListener('focusin', this.onFocusIn);
    term.focusInput({ ifFine: true }); // no surprise keyboard on touch
    if (first) this.ask(first);
  }

  setMode(i, update = true) {
    this.mode = i;
    const [glyph, label] = MODES[i];
    this.modeEl.replaceChildren(this.hide(`${glyph} `), label,
      this.h('span', { class: 'cli-dim cli-keyhint', text: ' · shift+tab: next mode (twice: move back)' }));
    if (update && !this.closed) this.term.setHint(this.footer); // re-measures the prompt
  }

  onKeyDown(e) {
    const key = e.key || '';
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(key)) return false;
    if (key === 'Tab' && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
      // One press cycles the mode; the next press in a row moves focus back
      // as usual (the status message says so).
      if (this.shiftTabs >= 1) {
        this.shiftTabs = 0;
        return false;
      }
      this.shiftTabs = 1;
      e.preventDefault();
      this.setMode((this.mode + 1) % MODES.length);
      this.term.status(`Mode: ${MODES[this.mode][1]}. Press Shift+Tab again to move focus back.`);
      return true;
    }
    this.shiftTabs = 0;
    const input = e.target;
    const copying = input.selectionStart !== input.selectionEnd || !window.getSelection().isCollapsed;
    if (this.spin && (key === 'Escape' || (e.ctrlKey && key.toLowerCase() === 'c' && !copying))) {
      e.preventDefault();
      this.spin.stop(false);
      return true;
    }
    return false;
  }

  /** term.js calls this once when the mode goes away (/exit, a data-cmd click, a crash). */
  onExit() {
    this.closed = true;
    document.removeEventListener('focusin', this.onFocusIn);
    if (this.spin) this.spin.stop(false);
    if (this.openMenu) this.openMenu.cancel();
    for (const b of this.buttons) {
      b.disabled = true;
      b.classList.add('cli-dim');
    }
    this.buttons = [];
    if (!this.quiet) this.reply(this.t('bye'), this.ja());
  }

  // ---- Input ----

  enqueue(line, follow) {
    const run = () => this.handle(line, follow);
    this.chain = this.chain.then(run, run);
    return this.chain;
  }

  /** A suggestion was clicked: ask it like a typed line. */
  ask(text, e) {
    if (this.closed || this.openMenu) return;
    const how = this.howOf(e);
    this.enqueue(text, true).then(() => this.refocus(how), (err) => {
      // term.js reports errors from typed lines; clicked ones land here.
      console.error(err);
      if (!this.closed) this.term.popMode(this.self);
      this.term.setPromptVisible(true);
      this.term.print(`meiorz-cli: something went wrong (${err && err.message}). Back to the shell.`).classList.add('out--error');
    });
  }

  /**
   * After a clicked question or a menu answer. Mouse users keep typing in the
   * prompt; keyboard users stay on the control they used unless it went away
   * (/exit disables it, /clear removes it, a menu is replaced), then they go
   * to the prompt. Touch never focuses the input (no surprise keyboard): if
   * focus was lost, it parks on the newest reply instead of <body>.
   */
  refocus(how) {
    const a = document.activeElement;
    const lost = !a || a === document.body || a.disabled || !a.isConnected;
    if (!lost && (how !== 'mouse' || this.closed)) return;
    const touch = how === 'touch' || how === 'pen' || (!how && this.term.isCoarsePointer());
    if (!touch) this.term.focusInput();
    if (lost && document.activeElement === a) this.park();
  }

  park() {
    const el = this.lastOut;
    if (!el || !el.isConnected) return;
    el.tabIndex = -1;
    el.addEventListener('blur', () => el.removeAttribute('tabindex'), { once: true });
    el.focus({ preventScroll: true });
  }

  async handle(line, follow) {
    const raw = String(line ?? '').trim();
    if (this.closed || !raw) return undefined;
    this.term.echo(raw).classList.add('cli-prompt');
    if (follow) this.term.scrollToBottom(); // a click far up the log still shows its answer
    this.replies++;
    if (raw === '?' || raw.startsWith('/')) return this.slash(raw);
    const text = normalize(raw);
    const key = (RULES.find(([re]) => re.test(text)) || [0, 'fallback'])[1];
    if (['exit', 'help', 'clear'].includes(key)) return this.slash(`/${key}`);
    const ultra = key === 'ultrathink';
    const verb = ultra ? ['Ultra-thinking', 'Ultra-thought'] : VERBS[(this.verbIx++ * 3) % VERBS.length]; // 3 is coprime with 10
    const ms = await this.think(verb, ultra ? THINK_MS[1] : null, ultra ? ' · still a switch statement' : '');
    if (ms == null) {
      if (!this.closed) this.reply(this.h('p', { class: 'cli-result' }, this.hide('⎿  '), this.t('stop')), this.ja());
      return undefined;
    }
    if (key === 'rm') return this.rmFlow();
    if (key === 'hire') return this.hireFlow();
    const entry = REPLIES[key];
    const r = typeof entry === 'function' ? entry(this, raw) : entry;
    const lang = r.lang || null;
    const past = this.h('p', { class: 'cli-dim', attrs: { lang: lang && 'en' } }, this.hide('✿ '), `${verb[1]} for ${(ms / 1000).toFixed(1)}s`);
    this.reply([].concat(r.lines || r, past), lang);
    return undefined;
  }

  async slash(raw) {
    const [word = '', arg = ''] = raw.slice(1).trim().toLowerCase().split(/\s+/);
    const { h, term } = this;
    switch (word) {
      case '':
      case 'help':
        return this.reply([
          h('dl', { class: 'cmds' }, SLASH.map(([name, about]) => [h('dt', {}, this.btn(`/${name}`)), h('dd', {}, this.rich(about))])),
          h('p', {}, 'Or ask: ', this.join(TRY.map((q) => this.btn(q)))),
          h('p', { class: 'hint cli-keys' }, 'Esc interrupts · Shift+Tab: next mode (cosmetic; press again to move focus back) · ↑/↓ history'),
        ]);
      case 'resume':
      case 'skills':
        return this.reply(REPLIES[word](this));
      case 'cost': {
        const s = Math.round((Date.now() - this.started) / 1000);
        return this.reply(h('pre', {
          attrs: { 'data-label': 'Session cost' },
          text: ['Total cost:    $0.00 (static site · zero API calls)', `Wall time:     ${s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`}`,
            `Replies:       ${this.replies}, all scripted · 0 tokens`, 'Code changes:  0 lines added, 0 removed', 'Snacks:        1 onigiri'].join('\n'),
        }));
      }
      case 'clear':
        term.clear();
        this.buttons = [];
        return this.reply('Cleared. Unlike my browser tabs.');
      case 'hire':
        return this.hireFlow();
      case 'lang':
        return this.langFlow(arg);
      case 'obby':
        this.reply('Leaving for the obby. Type meiorz-cli to come back.');
        this.quiet = true;
        term.popMode(this.self);
        return term.run('obby');
      case 'exit':
      case 'quit':
        term.popMode(this.self);
        return undefined;
      default:
        return this.reply(this.say(`Unknown command: /${word} · try `, this.btn('/help')));
    }
  }

  // ---- Spinner ----

  /**
   * "⠋ Verb… (esc to interrupt · Ns)" for `ms` (default 0.8-2.2 s). Resolves with the
   * elapsed ms, or null if interrupted. aria-hidden: a status message stands in.
   * Esc works wherever focus is (e.g. on the suggestion that was clicked), not
   * only in the prompt; Ctrl+C only in the prompt (elsewhere it copies).
   */
  think(verb, ms, note) {
    const { h, term } = this;
    const animate = !term.reducedMotion();
    const frameEl = h('span', { text: FRAMES[0] });
    const timeEl = h('span', { text: animate ? ' · 0s' : '' });
    const out = term.print(h('p', { class: 'cli-spinner', attrs: { 'aria-hidden': 'true' } },
      frameEl, ` ${verb[0]}… `, h('span', { class: 'cli-dim' }, `(${this.t('esc')}`, timeEl, `${note})`)));
    term.status(`${verb[0]}… Press Escape to interrupt.`);
    const t0 = performance.now();
    return new Promise((resolve) => {
      let frame = 0;
      let timer = 0;
      let timeout = 0;
      // Bubble phase, and only if nobody handled the key: in #cmd, onKeyDown()
      // already stopped the spinner (and the shell must not also clear the line).
      const onEsc = (e) => {
        if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return;
        e.preventDefault();
        state.stop(false);
      };
      const state = {
        stop: (finished) => {
          if (this.spin !== state) return;
          this.spin = null;
          clearInterval(timer);
          clearTimeout(timeout);
          document.removeEventListener('keydown', onEsc);
          term.status(''); // the Escape instruction is stale now
          out.remove();
          resolve(finished ? performance.now() - t0 : null);
        },
      };
      if (animate) {
        timer = setInterval(() => {
          frameEl.textContent = FRAMES[++frame % FRAMES.length];
          timeEl.textContent = ` · ${Math.floor((performance.now() - t0) / 1000)}s`;
        }, 80);
      }
      timeout = setTimeout(() => state.stop(true), ms ?? THINK_MS[0] + Math.random() * (THINK_MS[1] - THINK_MS[0]));
      this.spin = state;
      document.addEventListener('keydown', onEsc);
    });
  }

  // ---- Permission menus ----

  /**
   * A permission menu (ARIA listbox): resolves with the chosen index, or -1 if the
   * session ends first. Up/Down, Home/End, Enter/Space, a digit, a click; Esc = `no`.
   */
  askMenu([title, detail, question, options], command, no, lang = this.lang) {
    const { h, term } = this;
    const ids = [nextId('q'), nextId('d'), nextId('k')];
    let sel = 0;
    let resolve;
    const done = new Promise((r) => {
      resolve = r;
    });
    const marks = options.map(() => this.hide(''));
    const items = options.map((label, i) => h('li', { attrs: { role: 'option', id: nextId('o') }, on: { click: (e) => finish(i, this.howOf(e)) } },
      marks[i], `${i + 1}. ${label}`));
    const select = (i) => {
      sel = i;
      items.forEach((li, j) => {
        li.setAttribute('aria-selected', String(j === i));
        marks[j].textContent = j === i ? '❯\xA0' : '\xA0\xA0';
      });
      list.setAttribute('aria-activedescendant', items[i].id);
    };
    const onKey = (e) => {
      const n = options.length;
      const k = e.key;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (k === 'ArrowDown') select((sel + 1) % n);
      else if (k === 'ArrowUp') select((sel + n - 1) % n);
      else if (k === 'Home') select(0);
      else if (k === 'End') select(n - 1);
      else if (k === 'Enter' || k === ' ') finish(sel, 'keyboard');
      else if (k === 'Escape') finish(no, 'keyboard');
      else if (/^[1-9]$/.test(k) && k <= n) finish(k - 1, 'keyboard');
      else return;
      e.preventDefault();
    };
    const list = h('ol', {
      class: 'cli-menu',
      attrs: { role: 'listbox', tabindex: '0', 'aria-labelledby': ids[0], 'aria-describedby': `${ids[1]} ${ids[2]}` },
      on: { keydown: onKey },
    }, items);
    select(0);
    // Key help: hidden on phones and touch screens (CSS), still read as the listbox's description.
    const keys = h('p', { class: 'cli-dim cli-keys', text: TEXT[lang].keys, attrs: { id: ids[2] } });
    const state = { cancel: () => finish(-1, '') };
    const finish = (i, how) => {
      if (this.openMenu !== state) return; // already answered
      this.openMenu = null;
      this.menuHow = how;
      // Keep a one-line record of the answer; the listbox itself goes away.
      list.replaceWith(h('p', { class: 'cli-dim' }, i < 0 ? TEXT[lang].cancel : [this.hide('❯ '), `${i + 1}. ${options[i]}`]));
      keys.remove();
      resolve(i);
    };
    term.print(h('div', { class: 'cli-box', attrs: { lang: lang === 'ja' ? 'ja' : null } },
      h('p', { class: 'cli-accent' }, h('strong', { text: title })),
      h('p', { attrs: { id: ids[1] } }, h('code', { text: command }), detail && [h('br'), h('span', { class: 'cli-dim', text: detail })]),
      h('p', { attrs: { id: ids[0] } }, h('strong', { text: question })),
      list, keys));
    this.openMenu = state;
    term.setPromptVisible(false);
    list.focus({ preventScroll: true });
    term.scrollToBottom();
    return done.then((i) => (this.closed ? -1 : i));
  }

  /** Prints a menu's outcome and hands focus back (to the prompt, unless the answer was a tap). */
  menuReply(parts, lang = null) {
    this.term.setPromptVisible(true);
    this.reply(parts, lang);
    this.refocus(this.menuHow || 'keyboard');
    this.term.scrollToBottom();
  }

  async rmFlow() {
    const i = await this.askMenu(this.t('rm'), 'rm -rf ./node_modules', 2);
    if (i === 0) {
      this.menuReply([this.result("rm: cannot remove './node_modules': No such file or directory"),
        'Nothing to remove: this site has zero dependencies. Checked the real to-do list instead:', this.tool('Update Todos'),
        this.todos([['CS 110C · C++ ADTs', 1], ['CS 111C · Java ADTs', 1], ['CS 270 · MIPS', 1]], true)]);
    } else if (i > 0) {
      this.menuReply(i === 1 ? this.result('Skipped: meiorz-cli can only see this page. Your other repos are safe.')
        : 'Left as is. Nothing was deleted (nothing could be: this is a static site).');
    }
  }

  async hireFlow() {
    this.reply('Short pitch: meiorz explains code every week as a CS tutor/TA (since Sep 2024), has completed data structures in both C++ and Java plus computer architecture, and builds tested browser and editor extensions (Lull, HopOut, Material Icons Inline). Full story: /resume.');
    const i = await this.askMenu(TEXT.en.hire, `mailto:${EMAIL}`, 2, 'en');
    const mail = () => this.link(MAILTO, EMAIL);
    if (i === 0) {
      this.menuReply(this.say('Opening your email app… If nothing happens, write to ', mail(), '.'));
      window.location.href = MAILTO; // the visitor chose "Yes"; the printed link is the fallback
    } else if (i === 1) {
      this.menuReply(this.say('Deal. The address keeps: ', mail(), ' · the obby: ', this.btn('/obby')));
    } else if (i === 2) {
      this.menuReply('No worries. The address is in the page footer, for later.');
    }
  }

  async langFlow(arg) {
    if (arg === 'en') {
      this.lang = 'en';
      return this.reply('Back to English.');
    }
    if (arg !== 'ja') return this.reply('Usage: /lang ja or /lang en. ASL isn’t on the list: I don’t have hands.');
    const i = await this.askMenu(TEXT.ja.lang, '/lang ja', 1, 'ja');
    if (i === 0) this.lang = 'ja';
    if (i >= 0) this.menuReply(i ? this.say(TEXT.ja.off, ' ', this.h('span', { text: '(OK, staying in English.)', attrs: { lang: 'en' } })) : TEXT.ja.on, 'ja');
    return undefined;
  }
}

/** Entry point, called by term.js for `meiorz-cli [question]`. */
export async function start(term, args = []) {
  new Session(term).open(args.join(' ').trim());
}

# meiorz

Computer science student at City College of San Francisco and CS tutor. San Francisco,
CA.

Seeking a software engineering internship for summer 2027.

This is the markdown version of <https://www.meiorz.tech/>. Everything below is also on
the page itself, and none of it needs JavaScript. The page also has a small terminal
with two programs, `obby` and `meiorz-cli` (see Play).

## Projects

### Lull

A Chrome extension (Manifest V3) that gives every website a soft, predictable dark theme.
I designed it for autistic people and people with ADHD: no white flashes, no pure black
or pure white, no vivid color, and no movement you did not ask for.
Repository: <https://github.com/meiorz/lull>

- No white flash: the page is dark before any script runs, and a test records every
  painted frame to check it.
- Colors are mapped in OKLCH. Backgrounds and text stay inside narrow bands and
  saturation is capped, so hue survives.
- Calm by default: style-sheet animations stop, autoplay pauses and GIFs freeze until
  you ask for them. An optional reading ruler.
- No per-site fix list: CSS variables, cascade layers, nesting, shadow roots and style
  sheets on other origins are handled generically.
- No account, analytics, remote code or server. No dependencies and no build step.
- 138 checks load the extension into real Chrome.

### HopOut

A VS Code extension that moves the cursor outside the nearest enclosing quote, bracket
or paren. It puts that on `Tab`, but only where `Tab` has nothing better to do.
Open source, MIT license. TypeScript.
Repository: <https://github.com/meiorz/hopout>

- `Tab` hops past the closing delimiter ahead of the cursor, and `Shift+Tab` undoes the
  hop. `Ctrl+'` leaves the enclosing pair from anywhere inside it, across lines.
- It stays out of the way: the key is gated on a context key, so an ordinary `Tab` never
  reaches the extension. It yields to suggestions, snippets and inline AI completions.
- It scans the code structure (escaped quotes, nested brackets, comments,
  multi-character delimiters), so it only ever hops out of a pair, never into one.
- Multiple cursors and per-language pairs.
- Unit tests cover the scanner, and integration tests press real keys inside VS Code.

### Tweet sentiment classification with BERT

Inspirit AI Scholar project, spring 2022. Python, PyTorch.

- Fine-tuned Google BERT on a labeled tweet corpus: preprocessing, tokenization,
  training and evaluation.
- Presented the approach, results and error analysis at Inspirit AI Demo Day.

## Skills

- Languages: C++, Java, Python, JavaScript, TypeScript, SQL, Kotlin, Bash/Shell, MIPS Assembly
- Systems: Linux, Docker
- Tooling: Git/GitHub, GitHub Actions (CI/CD), automated unit and integration testing,
  debugging, CLI development, code review
- AI and data: ML fundamentals, NLP, transformer models (Google BERT), LLM-assisted
  development workflows
- Spoken and signed languages: English (fluent), Japanese (fluent), American Sign
  Language (limited to STEM communication)

## Education

City College of San Francisco, since summer 2022: Computer Science, and linguistics
through American Sign Language.

- [x] CS 110C: Data Structures and Algorithms in C++ (ADTs)
- [x] CS 111C: Data Structures and Algorithms in Java (ADTs)
- [x] CS 270: Computer Architecture and Assembly (MIPS)

Other coursework: Calculus I and II (MATH 110A/110B).

Inspirit AI: AI Scholar program, completed April 2022.

### Certifications

- AI Scholar, Inspirit AI (Apr 2022)
- Microsoft Certified: Azure AI Fundamentals, AI-900 (Oct 2021)
- Microsoft Certified: Azure Data Fundamentals, DP-900 (Aug 2021)
- Microsoft Certified: Azure Fundamentals, AZ-900 (Jul 2021)
- Microsoft 365 Certified: Fundamentals, MS-900 (Jun 2021)

## Experience

### Computer Science Tutor / Teaching Assistant

City College of San Francisco. Sep 2024 to present.

- Tutor one or two students a week.
- Debug student code live in C++, Java and Python.
- Explain the reasoning rather than handing over the fix.
- Translate complex concepts for students with varied backgrounds.

### Inspirit AI: Ambassador and AI Scholar alum

Mar 2023 to Aug 2024.

- Reached out to more than 100 people, inviting them to join the upcoming AI Scholar
  curriculum.

## Play

The terminal and its games need JavaScript. On the web page, start one from the prompt
or with its button.

### obby: tiny platformer

Mini Obby is a small obstacle course on a text grid. Luau-flavored, written in
JavaScript: the course itself is a real Luau module, parsed at runtime. You can read it
at <https://www.meiorz.tech/obby/obbycourse.luau>. Not affiliated with Roblox.

Controls: Left/Right or A/D to move, Space/Up/W to jump, R to restart, Esc to quit.

### meiorz-cli: scripted command line

meiorz-cli answers questions about this site and its projects. It is scripted: no AI and
no network calls, and every reply is pre-written. Type `/help` inside it.

## Contact

- Email: [business@meiorz.tech](mailto:business@meiorz.tech)
- GitHub: <https://github.com/meiorz>
- LinkedIn: <https://www.linkedin.com/in/mei-o-525a0b227>
- Resume (plain text): <https://www.meiorz.tech/resume.txt>

---

Also on this site: [llms.txt](https://www.meiorz.tech/llms.txt) and the
[archive](https://www.meiorz.tech/archive/) of the previous site.
No trackers. No cookies. (c) 2026 meiorz.

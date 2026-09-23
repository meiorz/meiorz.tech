# Mei Okubo

Computer science transfer student at City College of San Francisco. CS tutor, ASL
interpreter in STEM settings, and VTuber. San Francisco, CA.

Currently seeking: Summer 2027 software engineering internships.

This is the markdown version of <https://www.meiorz.tech/>. The web page looks like a
terminal: you can type commands such as `help`, `about`, `projects`, `obby` and `meii`.
Everything below is also on the page itself, and none of it needs JavaScript.

## About

I'm Mei, a computer science transfer student at City College of San Francisco. I'm
completing IGETC and CS major-preparation coursework for a junior transfer, with a
target of Fall 2028.

I tutor CS students in C++, Java and Python. I interpret American Sign Language in STEM
settings, and I'm working toward the CCSF ASL certificate (AMSL 2B), expected Fall 2027.
I'm also a VTuber, getting ready to relaunch my stream. I'm fluent in English and
Japanese.

My main project is BlobGuard, an AI-assisted (agentic) engineering project on a real
problem: cloud storage security. It's an open-source scanner that checks the security
settings of cloud object storage without reading any object contents. One design rule
I hold it to: a check that cannot be confirmed reports `error`, never `pass`.

## Projects

### BlobGuard (in progress)

An AI-assisted (agentic) engineering project on a real problem: cloud storage security.
BlobGuard is an object-storage security posture scanner. Open source, MIT license. I own
and direct the project; it's built with an AI-assisted (agentic coding) workflow.
Repository: <https://github.com/meiorz/blobguard>

- A Python command-line tool (Python 3.12 or newer).
- Read-only: management (control-plane) APIs only. It never reads object contents.
- Every finding carries evidence and a remediation.
- Provider-abstraction design: the Azure adapter is in progress (initial checks
  landing), and AWS and GCP adapters are planned behind the same interface.
- Signs in through `DefaultAzureCredential`, so it never handles secrets itself.
- Commands: `blobguard scan`, `blobguard explain`, `blobguard list-checks`.
  Reports come out as JSON or Markdown.
- Exit codes that can gate a pipeline: 0 clean, 1 at least one failing finding,
  2 bad usage, 3 could not run.
- Checks that cannot be confirmed report `error`, never `pass`.
- Lab resources are sandbox-only (Terraform on Azure) and hold dummy data.
- GitHub Actions CI runs the automated tests.

### Tweet sentiment classification with BERT (completed)

Inspirit AI Scholar project. Python, PyTorch.

- Fine-tuned Google BERT on a labeled tweet corpus: preprocessing, tokenization,
  training and evaluation.
- Presented the approach, results and error analysis at Inspirit AI Demo Day.

### meiorz.tech, this site (live)

- Terminal-style and accessible (WCAG 2.2 AA target), with light and dark themes.
- Strict Content Security Policy. No trackers, no cookies.
- Static files hosted on Azure Static Web Apps.
- Built with an AI-assisted (agentic coding) workflow.
- Includes a Luau-flavored obby mini-game and a scripted parody CLI (see Play).

### Also in the works (in progress)

- Android app (Kotlin): details coming soon.
- AI-assisted security research: details coming soon.
- Agentic terminal CLI app, a rich terminal UI in the style of a coding assistant:
  details coming soon.
- Creator automation app: schedules and cross-posts content for my VTuber relaunch
  through each platform's official APIs.
  Goal: grow to 20K followers over time, building in public. More details coming soon.

## Skills

- Languages: C++, Java, Python, SQL, Kotlin, Bash/Shell, MIPS Assembly
- Systems: Linux, Docker, Azure, Terraform
- Tooling: Git/GitHub, GitHub Actions (CI/CD), automated unit and integration testing,
  debugging, CLI development, code review
- AI and data: ML fundamentals, NLP, transformer models (Google BERT), LLM-assisted
  development workflows
- Spoken and signed languages: English (fluent), Japanese (fluent), American Sign
  Language

## Education

City College of San Francisco: computer science transfer student, completing IGETC and
CS major-preparation coursework for a junior transfer, target Fall 2028.

- [x] CS 110C: Data Structures and Algorithms in C++ (ADTs). Grade: A
- [x] CS 111C: Data Structures and Algorithms in Java (ADTs). Grade: A
- [x] CS 270: Computer Architecture and Assembly (MIPS). Grade: A
- [ ] IGETC and CS major preparation: in progress
- [ ] Junior transfer, target Fall 2028 (UCLA, UC Berkeley, SF State)
- [ ] CCSF ASL certificate (AMSL 2B): expected Fall 2027

Other coursework: Calculus I and II (MATH 110A/110B).

### Certifications

- AI Scholar, Inspirit AI (Apr 2022)
- Microsoft Certified: Azure AI Fundamentals, AI-900 (Oct 2021)
- Microsoft Certified: Azure Data Fundamentals, DP-900 (Aug 2021)
- Microsoft Certified: Azure Fundamentals, AZ-900 (Jul 2021)
- Microsoft 365 Certified: Fundamentals, MS-900 (Jun 2021)

## Experience

### Computer Science Tutor / Teaching Assistant

City College of San Francisco. Sep 2024 to present, about 8 hours a week.

- Debug student code live in C++, Java and Python.
- Explain the reasoning rather than handing over the fix.
- Translate complex concepts for students with varied backgrounds.

### ASL interpreter in STEM settings

- Interpret American Sign Language in STEM settings.
- Working toward the CCSF ASL certificate (AMSL 2B), expected Fall 2027.

### Inspirit AI: Ambassador and AI Scholar alum

Mar 2023 to present.

- AI and STEM education outreach, with 100+ community contacts.

## Streaming

I'm a VTuber with an anime-style avatar persona, and I'm preparing to relaunch my
stream. I'm also building a creator automation app for the relaunch (see Projects).

![Placeholder pixel-art avatar (32x32): an original chibi-style character with a headset and a small WIP tag. The real stream avatar is coming soon.](https://www.meiorz.tech/img/avatar.svg)

Work in progress -- details coming soon:

- Avatar rigging
- OBS and stream setup
- Video editing
- Stream languages

## Play

Games need JavaScript. On the web page, start one from the prompt or with its button.

### obby: tiny platformer

Mei's Mini Obby is a small obstacle course on a text grid. Luau-flavored, written in
JavaScript: the course itself is a real Luau module, parsed at runtime. You can read it
at <https://www.meiorz.tech/obby/obbycourse.luau>. Not affiliated with Roblox.

Controls: Left/Right or A/D to move, Space/Up/W to jump, R to restart, Esc to quit.

### meii: parody CLI

Mei I? is a scripted parody of an agentic coding CLI. Parody, not affiliated with any AI
company. No AI and no network calls: every reply is pre-written. Type `/help` inside it.

## Contact

- Email: [business@meiorz.tech](mailto:business@meiorz.tech)
- GitHub: <https://github.com/meiorz>
- LinkedIn: <https://www.linkedin.com/in/mei-o-525a0b227>
- Resume (plain text): <https://www.meiorz.tech/resume.txt>

---

Also on this site: [llms.txt](https://www.meiorz.tech/llms.txt) and the
[archive](https://www.meiorz.tech/archive/) of the previous site.
No trackers. No cookies. (c) 2026 Mei Okubo.

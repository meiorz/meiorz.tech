#!/usr/bin/env node
/**
 * test-removed-details.mjs: fixtures for the removed-details rules (zero dependencies).
 *
 * Every rule in tools/lib/removed-details.mjs (check 9 of tools/check-site.mjs, plus
 * LETTER_GRADE, the privacy check's `grade` rule) must FIRE on each of its failing
 * fixtures and stay QUIET on each of its allowed ones. The allowed fixtures include text
 * the site really contains ("linear-gradient", "every week", a `followers?` keyword in a
 * script), so a rule that grows too wide fails here before it fails a deploy. The two
 * grade rules must also never flag the same text. When you change a rule, add the
 * fixture that motivated it.
 *
 * Usage: node tools/test-removed-details.mjs
 * Exit codes: 0 all fixtures behave, 1 a fixture failed, 2 the rules could not be loaded.
 */
let REMOVED_DETAILS;
let LETTER_GRADE;
let findRule;
try {
  ({ REMOVED_DETAILS, LETTER_GRADE, findRule } = await import('./lib/removed-details.mjs'));
} catch (err) {
  console.error(`test-removed-details: could not load the rules: ${err.message}`);
  process.exit(2);
}

/** rule id -> { fail: [...texts that must be flagged], allow: [...texts that must pass] } */
const FIXTURES = {
  // Privacy check rule `grade`: every letter grade except a plain A.
  grade: {
    fail: [
      'CS 111C: Grade: B',
      'My grade was C+ that term.',
      'grade of D in the course',
      'Grade: of B', // phrasing the earlier privacy regex accepted; kept covered
      'Final grade is A- after the curve.',
      'grades = F',
    ],
    allow: [
      'Coursework completed with grade A: CS 110C.', // a plain A is course-grade's, not this rule's
      'Tutors students from grade school to college.',
      'Grade C++ practice problems with students.',
      'mask-image: linear-gradient(to right, #000 calc(100% - 2rem), transparent);',
      'grade Fall 2027 applications',
      'I help students grade a practice quiz.',
    ],
  },
  'course-grade': {
    fail: [
      'CS 110C — Data Structures &amp; Algorithms in C++ (ADTs) · <span class="grade">grade A</span>',
      '- [x] CS 270: Computer Architecture and Assembly (MIPS). Grade: A',
      'Core CS coursework (grade A): Data Structures and Algorithms in C++ (CS 110C)',
      'Coursework completed with grade A: CS 110C, CS 111C, CS 270.',
      'I earned an A in both data structures courses and in computer architecture.',
      'She got an A in CS 270.',
      'Straight A\'s in the CS core.',
    ],
    allow: [
      'mask-image: linear-gradient(to right, #000 calc(100% - 2rem), transparent);',
      'CS 110C — Data Structures &amp; Algorithms in C++ (ADTs)',
      'Tutors students from grade school to college.',
      'I help students upgrade old projects and grade a practice quiz.',
      'Graded weekly labs; grading rubric reviewed with the instructor.',
      'Plan A in both cases is to ask first.',
      'Grade 9 outreach event with Inspirit AI.',
    ],
  },
  'transfer-target': {
    fail: [
      '<li class="todo"><span class="box" aria-hidden="true">☐</span><span>Junior transfer, target Fall 2028 (UCLA · UC Berkeley · SF State)</span></li>',
      '- [ ] Junior transfer, target Fall 2028 (UCLA, UC Berkeley, SF State)',
      "['Junior transfer · target Fall 2028 (UCLA · UC Berkeley · SF State)', 0]",
      'Applying to San Francisco State and Cal Poly for Fall 2028.',
      'Transfer goal: University of California, Davis.',
      '<li>Transfer targets: UCLA</li>\n<li>Watched a Stanford lecture.</li>',
    ],
    allow: [
      '<li>Junior transfer, target Fall 2028</li>',
      '<li>Junior transfer, target Fall 2028</li>\n<li>Watched a Stanford lecture series on algorithms.</li>',
      '<p>Watched a Stanford lecture series on algorithms.</p>\n<p>Junior transfer, target Fall 2028.</p>',
      "UC Berkeley's BSD Unix shaped the operating systems I use.",
      'City College of San Francisco: Computer Science transfer student, target Fall 2028.',
      '/\\b(school|college|ccsf|educat\\w*|degree|transfer\\w*|igetc|ucla|berkeley|universit\\w*)\\b/',
    ],
  },
  'weekly-hours': {
    fail: [
      '<p class="meta">City College of San Francisco · Sep 2024 – present · about 8 hours a week</p>',
      'City College of San Francisco -- San Francisco, CA | ~8 hrs/week',
      "Sep 2024 – present (about 8 hours a week): debugs student code",
      'Tutoring 10-12 hours per week.',
      'Eight hours weekly at the tutoring center.',
      'Weekly hours: 8',
    ],
    allow: [
      'I explain code every week as a CS tutor/TA (since Sep 2024).',
      'I created a discord server for comp sci classes that I ‘m taking this semester last week.',
      'Wait for the old TTL (2 hours) to expire.',
      'The maximum is 168 hours, which is seven days.',
      'Integer cells, a fixed 12 Hz tick, one push every 2 ticks.',
      'Available five days a week for interviews.',
      'City College of San Francisco · Sep 2024 – present',
    ],
  },
  'follower-count': {
    fail: [
      'Creator automation app: schedules and cross-posts content. Goal: grow to 20K followers over time, building in public.',
      'Public goal: 20,000 subscribers by 2028.',
      'A 20k-follower goal for the relaunch.',
      'followers: 1.5M',
      '20K on Twitch soon.',
      'twenty thousand followers',
    ],
    allow: [
      'Creator automation app: schedules and cross-posts content for my VTuber relaunch. Building it in public.',
      '/\\b(go live|stream\\w*|vtub\\w*|twitch|obs|avatar|relaunch\\w*|followers?|creator (app|automation))\\b/',
      'Thanks to everyone who follows along on GitHub.',
      'Stage 2 of 4: a conveyor pushes 1 cell every 2 ticks.',
      'Seeking Summer 2027 software engineering internships.',
    ],
  },
};

let failures = 0;
const ok = (msg) => console.log(`  ok    ${msg}`);
const bad = (msg) => {
  failures++;
  console.log(`  FAIL  ${msg}`);
};
const short = (s) => JSON.stringify(s.length > 70 ? `${s.slice(0, 67)}...` : s);

const RULES = [LETTER_GRADE, ...REMOVED_DETAILS];

console.log('test-removed-details: do the removed-details rules fire, and only where they should?');
for (const rule of RULES) {
  const fx = FIXTURES[rule.id];
  console.log(`${rule.id}`);
  if (!fx || !fx.fail.length || !fx.allow.length) {
    bad(`${rule.id} needs at least one failing and one allowed fixture`);
    continue;
  }
  for (const text of fx.fail) {
    const hits = findRule(rule, text);
    if (hits.length) ok(`flags   ${short(text)} -> ${short(hits[0].s)}`);
    else bad(`missed  ${short(text)}`);
  }
  for (const text of fx.allow) {
    const hits = findRule(rule, text);
    if (!hits.length) ok(`allows  ${short(text)}`);
    else bad(`wrongly flags ${short(text)} at ${short(hits[0].s)}`);
  }
}
for (const id of Object.keys(FIXTURES)) if (!RULES.some((r) => r.id === id)) bad(`fixtures for unknown rule "${id}"`);

// The two grade rules split the letters: no grade fixture may be flagged by both.
console.log('grade rules do not overlap');
const courseGrade = REMOVED_DETAILS.find((r) => r.id === 'course-grade');
const gradeTexts = [...FIXTURES.grade.fail, ...FIXTURES.grade.allow, ...FIXTURES['course-grade'].fail, ...FIXTURES['course-grade'].allow];
const both = gradeTexts.filter((t) => findRule(LETTER_GRADE, t).length && findRule(courseGrade, t).length);
if (both.length) bad(`flagged by both grade rules: ${both.map(short).join(', ')}`);
else ok(`none of ${gradeTexts.length} grade fixtures is flagged by both "grade" and "course-grade"`);

console.log(failures ? `\ntest-removed-details: ${failures} fixture(s) failed` : '\ntest-removed-details: all fixtures behave');
process.exit(failures ? 1 : 0);

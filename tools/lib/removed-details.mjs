/**
 * removed-details.mjs: personal details that were deliberately taken off the public site
 * and must not come back. Used by check 9 (claims) in tools/check-site.mjs; every rule has
 * failing and allowed fixtures in tools/test-removed-details.mjs.
 *
 *   course-grade     a plain A grade attached to coursework ("grade A", "Grade: A", "an A
 *                    in both"). Every other grade is LETTER_GRADE (below), which the
 *                    privacy check uses as its rule `grade`. No grade is published.
 *   transfer-target  a named university in a transfer or admissions context. A university
 *                    named elsewhere ("a Stanford lecture") is fine.
 *   weekly-hours     hours per week ("8 hours a week", "~8 hrs/week", "10-12 hours weekly").
 *   follower-count   any follower or subscriber number, including goals ("grow to 20K
 *                    followers"). Plans without a number ("building in public") are fine.
 *
 * Each rule is narrow on purpose: words like "gradient", "every week" or "wait 2 hours",
 * and numbers in general, must not trip it. The fixtures pin that down.
 *
 * This file is kept ASCII-only: non-ASCII characters are built from their code points.
 *
 * rule = { id, why, re: global RegExp, ok?(text, start, end) -> true if allowed in context }
 */

const ch = (code) => String.fromCharCode(code);
const EN_DASH = ch(0x2013);
const RIGHT_QUOTE = ch(0x2019); // typographic apostrophe
const ALMOST_EQUAL = ch(0x2248);
const NARROW_NBSP = ch(0x202f); // thousands separator in "20 000"
const PARAGRAPH_SEPARATOR = ch(0x2029); // what check-site turns block tags into (as displayed)

// ---- grades ------------------------------------------------------------------
// No grade is published. Two rules split the letters so every grade is reported once:
//   `grade` (LETTER_GRADE, privacy check 2, redacted): B-F and A+/A-, never published.
//   `course-grade` (check 9, printed): a plain A, which the site used to show.
// Both read the same phrasing ("grade X", "Grade: X", "grade of/was/is X"); lowercase
// "grade a paper" is not a grade. The fixtures test both, and that they never overlap.
const GRADE_LEAD = String.raw`\b[Gg]rades?\s*[:=]?\s*(?:(?:of|was|is)\s+)?`;

/** For the privacy check: any letter grade except a plain A. */
export const LETTER_GRADE = Object.freeze({
  id: 'grade',
  why: 'a letter grade (no grade is published; a plain A is reported by check 9, course-grade)',
  re: new RegExp(String.raw`${GRADE_LEAD}(?:[B-DF]|A(?=[+\-]))[+\-]?(?![\w+\-])`, 'g'),
});

// ---- course-grade ------------------------------------------------------------
const GRADE_A = String.raw`A(?![\w+\-])`;
const COURSE_GRADE = new RegExp([
  String.raw`${GRADE_LEAD}${GRADE_A}`, // grade A, Grade: A, grades of A
  String.raw`\ban\s+A\s+(?:grade|in\s+(?:both|all|each|every|[A-Z]{2,5}\s?\d))`, // an A grade, an A in both / in CS 270
  String.raw`\b[Ss]traight[- ]A'?s\b`, // straight A's
].join('|'), 'g');

// ---- transfer-target ---------------------------------------------------------
// Universities a CCSF transfer student might name. Case-sensitive, so ordinary words and
// lowercase keyword lists (e.g. in a script's regex) are left alone.
const UNIVERSITY = new RegExp(String.raw`\b(?:UCLA|UCSD|UCSB|UCSC|UC\s+(?:Berkeley|Davis|Irvine|Los\s+Angeles|Merced|Riverside|San\s+Diego|Santa\s+Barbara|Santa\s+Cruz)` +
  String.raw`|University\s+of\s+California|San\s+Francisco\s+State|SF\s?State|SFSU|San\s+Jos[e${ch(0xe9)}]\s+State|SJSU|Cal\s+Poly|Cal\s+State|Stanford)\b`, 'g');
const TRANSFER_CONTEXT = /\b(?:transfer\w*|targets?|targeting|apply|applying|application\w*|admissions?|admit\w*|dream\s+schools?)\b/i;
// Context ends at a paragraph: a blank line, a block tag, or a paragraph separator.
const BLOCK_EDGE = new RegExp(String.raw`\n[ \t]*\n|${PARAGRAPH_SEPARATOR}|<\/?(?:li|p|dd|dt|dl|h[1-6]|ul|ol|section|article|div|tr|td|th|pre|blockquote|figure|header|footer|main|nav)\b[^>]*>`, 'gi');
const WINDOW = 200;

/** The paragraph around text[start, end), at most WINDOW characters on each side. */
function paragraphAround(text, start, end) {
  const from = Math.max(0, start - WINDOW);
  const to = Math.min(text.length, end + WINDOW);
  let a = from;
  for (const m of text.slice(from, start).matchAll(BLOCK_EDGE)) a = from + m.index + m[0].length;
  const next = text.slice(end, to).search(BLOCK_EDGE); // search(): an index even with the g flag
  const b = next >= 0 ? end + next : to;
  return text.slice(a, b);
}

// ---- weekly-hours ------------------------------------------------------------
const NUM = String.raw`(?:\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty)`;
const RANGE = String.raw`(?:\s*(?:-|${EN_DASH}|to)\s*${NUM})?`;
const HOURS = String.raw`(?:hours?|hrs?\.?|h)`;
const WEEKLY_HOURS = new RegExp([
  String.raw`\b${NUM}${RANGE}\s*\+?\s*${HOURS}\s*(?:a|per|each|every)\s+(?:week|wk)\b`, // 8 hours a week, 10-12 hours per week
  String.raw`\b${NUM}${RANGE}\s*\+?\s*${HOURS}\s*\/\s*(?:week|wk)\b`, // ~8 hrs/week
  String.raw`\b${NUM}\s*${HOURS}\s+weekly\b`, // eight hours weekly
  String.raw`\bweekly\s+hours?\s*[:=]?\s*\d`, // weekly hours: 8
].join('|'), 'gi');

// ---- follower-count ----------------------------------------------------------
const COUNT_WORDS = 'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred';
// A count: 20,000 / 20 000 / 20K / 20k+ / 1.5M / 20 thousand / twenty thousand / thousands of
const COUNT = String.raw`(?:\d{1,3}(?:[,. ${NARROW_NBSP}]\d{3})+|\d+(?:[.,]\d+)?(?:\s*(?:[km]\b|thousand|million))?` +
  String.raw`|(?:(?:${COUNT_WORDS})[\s-]+)*(?:${COUNT_WORDS}|thousand|million)(?:[\s-]+(?:thousand|million))?` +
  String.raw`|(?:hundreds|thousands|millions)\s+of)`;
const AUDIENCE = String.raw`(?:followers?|subscribers?)`;
const PLATFORM = String.raw`(?:twitch|youtube|tiktok|kick|instagram|bluesky|twitter)`;
const FOLLOWER_COUNT = new RegExp([
  // "about 20K followers", "~20K Twitch followers", "20,000 followers", "20k-follower goal"
  String.raw`(?<![\w.,])${COUNT}\s*\+?[\s-]*(?:[a-z${RIGHT_QUOTE}'-]+[\s-]+){0,2}?${AUDIENCE}\b`,
  // "followers: 20K", "follower count of ~20K"
  String.raw`\b(?:follower|subscriber)s?(?:\s+count)?\s*(?:[:=${ALMOST_EQUAL}~]|\bof\b)\s*[~${ALMOST_EQUAL}]?\s*(?:about\s+|around\s+|over\s+)?\d[\d,.]*(?:\s*(?:[km]\b|thousand|million))?`,
  // "20K on Twitch", "20K Twitch community"
  String.raw`(?<![\w.,])\d+(?:[.,]\d+)?\s*[km]\+?\s+(?:on\s+)?${PLATFORM}\b`,
].join('|'), 'gi');

export const REMOVED_DETAILS = Object.freeze([
  { id: 'course-grade', why: 'course grade (grades are not published)', re: COURSE_GRADE },
  { id: 'transfer-target', why: 'named transfer-target university (not published)', re: UNIVERSITY,
    ok: (text, start, end) => !TRANSFER_CONTEXT.test(paragraphAround(text, start, end)) },
  { id: 'weekly-hours', why: 'weekly hours (not published)', re: WEEKLY_HOURS },
  { id: 'follower-count', why: 'follower or subscriber number (none is published, not even as a goal)', re: FOLLOWER_COUNT },
]);

/** Matches of `rule` in `text` that are not allowed in context: [{ start, end, s }]. */
export function findRule(rule, text) {
  const hits = [];
  for (const m of text.matchAll(rule.re)) {
    const start = m.index;
    const end = start + m[0].length;
    if (!rule.ok?.(text, start, end)) hits.push({ start, end, s: m[0] });
  }
  return hits;
}

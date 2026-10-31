// The ten legacy patterns of 06_Чистка/07_10.000.000.000.js in their order of application (legacy
// inline-HTML notation: nbsp = &nbsp;). `display` is the matched number as found, `suggestion` the
// proposed form with non-breaking spaces / an en dash, `prefix`/`suffix` the rest of the paragraph.
// Note: the legacy `^(.*?){0,1}` prefix could not match an empty string (ECMAScript rejects empty
// iterations of an optional group), so a match at the very start of a paragraph lost its first
// character; the prefix group is written as `^(.*?)` here.
import { jscriptRegExp } from './lib/jscript-regexp.js';

export const PATTERNS = [
  { name: "re50", re: jscriptRegExp("^(.*?[^\\d\\-N№/]){0,1}(\\d{1,3})([\\s\\.]{0,2})(\\d{3})([\\s\\.]{0,2})(\\d{3})([\\s\\.]{0,2})(\\d{3})([\\s\\.]{0,2})(\\d{3})([\\s\\.]{0,2})(\\d{3})([^\\d/].*?){0,1}$", "gi"), display: "$2$3$4$5$6$7$8$9$10$11$12", prefix: "$1", suffix: "$13", suggestion: "$2 $4 $6 $8 $10 $12", caption: "Большие числа" },
  { name: "re40", re: jscriptRegExp("^(.*?[^\\d\\-N№/]){0,1}(\\d{1,3})([\\s\\.]{0,2})(\\d{3})([\\s\\.]{0,2})(\\d{3})([\\s\\.]{0,2})(\\d{3})([\\s\\.]{0,2})(\\d{3})([^\\d/].*?){0,1}$", "gi"), display: "$2$3$4$5$6$7$8$9$10", prefix: "$1", suffix: "$11", suggestion: "$2 $4 $6 $8 $10", caption: "Большие числа" },
  { name: "re30", re: jscriptRegExp("^(.*?[^\\d\\-N№/]){0,1}(\\d{1,3})([\\s\\.]{0,2})(\\d{3})([\\s\\.]{0,2})(\\d{3})([\\s\\.]{0,2})(\\d{3})([^\\d/].*?){0,1}$", "gi"), display: "$2$3$4$5$6$7$8", prefix: "$1", suffix: "$9", suggestion: "$2 $4 $6 $8", caption: "Большие числа" },
  { name: "re20", re: jscriptRegExp("^(.*?[^\\d\\-N№/]){0,1}(\\d{1,3})([\\s\\.]{0,2})(\\d{3})([\\s\\.]{0,2})(\\d{3})([^\\d/].*?){0,1}$", "gi"), display: "$2$3$4$5$6", prefix: "$1", suffix: "$7", suggestion: "$2 $4 $6", caption: "Большие числа" },
  { name: "re10", re: jscriptRegExp("^(.*?[^\\d\\-N№/]){0,1}(\\d{2,3})([\\s\\.]{0,2})(\\d{3})([^\\d/].*?){0,1}$", "gi"), display: "$2$3$4", prefix: "$1", suffix: "$5", suggestion: "$2 $4", caption: "Большие числа" },
  { name: "re00", re: jscriptRegExp("^(.*?[^\\d\\-N№/]){0,1}([1-9])([\\s\\.]{1,2})(\\d{3})([^\\d/].*?){0,1}$", "gi"), display: "$2$3$4", prefix: "$1", suffix: "$5", suggestion: "$2$4", caption: "Большие числа" },
  { name: "re60", re: jscriptRegExp("^(.*?[^\\d\\-N№/]){0,1}([1-9])(&nbsp;)(\\d{3})([^\\d(&nbsp;)].*?){0,1}$", "gi"), display: "$2 $4", prefix: "$1", suffix: "$5", suggestion: "$2$4", caption: "Большие числа" },
  { name: "re70", re: jscriptRegExp("^(.*?)(\\d+)-(\\d+)(.*?){0,1}$", "gi"), display: "$2-$3", prefix: "$1", suffix: "$4", suggestion: "$2–$3", caption: "Дефис" },
  { name: "re80", re: jscriptRegExp("^(.*?)(\\d+) {0,1}— {0,1}(\\d+)(.*?){0,1}$", "gi"), display: "$2 — $3", prefix: "$1", suffix: "$4", suggestion: "$2–$3", caption: "Тире" },
  { name: "re90", re: jscriptRegExp("^(.*?)(\\d+)( –|– )(\\d+)(.*?){0,1}$", "gi"), display: "$2$3$4", prefix: "$1", suffix: "$5", suggestion: "$2–$4", caption: "Пробел" },
];

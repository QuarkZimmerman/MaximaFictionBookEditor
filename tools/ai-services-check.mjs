#!/usr/bin/env node
/**
 * Release-day check of the bundled AI services (feature 005, SC-009; quickstart §12; research
 * R3.10, R11.6). Developer tool in `tools/`: never shipped, never run by CI or by a test - it is
 * the one thing in the repository that contacts the real services. Node built-ins only.
 *
 * Per entry of `resources/ai-services.json` (or of the file given with `--file`), in file order:
 *   1. `GET <address>/models` - status, number of models, whether the entry's model is listed and
 *      the context length it reports (`context_length`, `context_window.tokens`, `max_model_len`);
 *      exactly `<address>/models`, never `GET <address>` or `/v1/models` under another base
 *      (Pollinations turns an unknown GET path into a prompt - ai-service-protocol §1);
 *   2. one tool-call round trip: a `read_section` tool over two sections of known lengths and the
 *      question "Which section is longer?"; the loop runs until `finish_reason` is no longer
 *      `tool_calls`, executes sequential and parallel calls, counts the exchanges and checks that
 *      the final answer names section 2;
 *   3. the proof-reading instruction of R3: `Он вышел на улицу , было холодно и шол дождь. Никто
 *      его не ждал .` must come back as `Он вышел на улицу, было холодно и шёл дождь. Никто его
 *      не ждал.` or with a comma before `и` (`..., было холодно, и шёл дождь.` - the two
 *      independent clauses of a compound sentence may be separated by one; both are correct) -
 *      compared after normalising U+202F / U+00A0 and surrounding whitespace (a wrapping code
 *      fence is stripped, as the editor does for a replacement); an answer that differs only by
 *      writing е for ё (`шел`) is `ok (е for ё)`, a note under the table, not a failure (ё is
 *      optional in Russian print); sent without `max_tokens` like every request of the editor
 *      (ai-service-protocol §2.2);
 *   4. the wall time of every exchange;
 *   5. the limits: a pause between two requests of one entry (OVHcloud 31 s, Pollinations 31 s,
 *      LLM7 1.5 s, 5 s for any other entry); a 429 / 402 / 503-with-Retry-After answer is
 *      waited out - the `Retry-After` header, the body's `error.retry_after`, "Retry after N s"
 *      in the message, else 30 s - within a budget of 300 s per entry; a wait beyond it gives
 *      the verdict `limit`;
 *   6. a Markdown table with the UTC date for `docs/releases/0.0.5.md` ("Free services verified
 *      on <date>"): Service | Model | /models | Tool call (exchanges, s) | Proof-reading (s,
 *      result) | Verdict.
 *
 * Verdicts: `pass`; `fail` - the model is not listed, an exchange failed, no tool call was made,
 * the final answer does not name section 2, or the proof-reading differs beyond the comma and
 * the е-for-ё tolerance above; `limit` - a wait beyond the budget (on LLM7 re-run the next
 * day or from another address before it counts as a failure, quickstart §12). Exit code 1 when
 * any entry fails, 2 on a usage error, 0 otherwise. The reasons follow the table; a model the
 * service no longer lists comes with the listed ids that resemble it and how many ids the list
 * marks free (`isFree`, `:free`, `tier: "turbo"`) - the input of the one-line change of T098.
 * Every answer text is printed verbatim in the details (without `--table`) for a human to judge.
 *
 * Usage: node tools/ai-services-check.mjs [--entry <id>]... [--file <path>] [--table]
 *                                         [--timeout <seconds>]
 *   --entry <id>         check this entry only (repeatable)
 *   --file <path>        the service list file (default resources/ai-services.json); an entry
 *                        of a user file may carry a `key`, sent as `Authorization: Bearer` -
 *                        no header is sent otherwise (an empty `Bearer ` is a 401 on LLM7)
 *   --table              print the Markdown only (progress still goes to stderr)
 *   --timeout <seconds>  time-out of one exchange (default 120, the editor's)
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_FILE = path.join(ROOT, 'resources', 'ai-services.json');
const DEFAULT_TIMEOUT_SECONDS = 120;
/** Total waiting on limit answers per entry; beyond it the verdict is `limit` (protocol §5). */
const WAIT_BUDGET_SECONDS = 300;
/** The wait when a limit answer names none (a service that gives no hint - protocol §5). */
const DEFAULT_WAIT_SECONDS = 30;
/** Safety stop of this tool only (the editor has none - research R3.3, decision C2). */
const MAX_EXCHANGES = 6;
/** Pause between two requests of one entry (quickstart §12 item 5). */
const PAUSE_SECONDS = { ovhcloud: 31, pollinations: 31, llm7: 1.5 };
const DEFAULT_PAUSE_SECONDS = 5;

const SECTIONS = {
  1: 'Утро было тихим.',
  2:
    'Вечером поднялся ветер, и море долго не могло успокоиться, пока за мысом не погасли ' +
    'последние огни.',
};
const TOOL_SYSTEM =
  'You are the assistant of a book editor. The book has two sections, numbered 1 and 2. ' +
  'Use the read_section tool to read them; never guess their content. Answer in English, in one ' +
  'short sentence.';
const TOOL_QUESTION =
  'Which section is longer? Read both sections with read_section first, then answer with the ' +
  'number of the longer section.';
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'read_section',
      description: 'Returns the text of one section of the book by its number (1 or 2).',
      parameters: {
        type: 'object',
        properties: {
          section_number: {
            type: 'integer',
            description: 'The number of the section to read: 1 or 2.',
            minimum: 1,
            maximum: 2,
          },
        },
        required: ['section_number'],
        additionalProperties: false,
      },
    },
  },
];
const PROOF_SYSTEM =
  'You are a proof-reader of Russian fiction. Correct the spelling and punctuation of the text ' +
  'the user sends and return only the corrected text: no explanations, no quotation marks, ' +
  'no Markdown, nothing else.';
const PROOF_INPUT = 'Он вышел на улицу , было холодно и шол дождь. Никто его не ждал .';
const PROOF_USER = `Исправь орфографию и пунктуацию. Верни только исправленный текст.\n\n${PROOF_INPUT}`;
/**
 * The correct answers: R3's sentence, and the same with a comma before `и` - `было холодно` and
 * `шёл дождь` are two independent clauses of a compound sentence, which Russian punctuation
 * lets a comma separate (Pollinations `openai-fast` answered so on 2026-10-23). Anything else is
 * a difference, except е written for ё (`onlyYoDropped`), which is noted and accepted.
 */
const PROOF_ACCEPTED = [
  'Он вышел на улицу, было холодно и шёл дождь. Никто его не ждал.',
  'Он вышел на улицу, было холодно, и шёл дождь. Никто его не ждал.',
];

/** "section 2", "section two", "the second", "раздел 2", "второй" ... (`\b` is ASCII-only). */
const NAMES_SECTION_2 =
  /(?:\b(?:section|sec\.?|part)\s*(?:#|№|no\.?|number)?\s*(?:2|two)\b|\bsecond\b|(?:^|[^\p{L}])(?:раздел|секция|часть|фрагмент)\s*(?:№|#)?\s*2(?!\d)|(?:^|[^\p{L}])втор\p{L}*)/iu;
const CLAIMS_SECTION_1_LONGER =
  /(?:\b(?:section|part)\s*(?:#|№|no\.?|number)?\s*(?:1|one)\b|\bfirst\b|(?:^|[^\p{L}])перв\p{L}*)\s+(?:is|was|-|—|\p{L}*\s)?\s*(?:the\s+)?(?:longer|длинне\p{L}*|больше)/iu;
const RETRY_AFTER_IN_MESSAGE = /retry after (\d+)\s*s(?:ec(?:ond)?s?)?\b/i;

const USAGE = `Usage: node tools/ai-services-check.mjs [--entry <id>]... [--file <path>] [--table] [--timeout <seconds>]
  --entry <id>         check this entry only (repeatable)
  --file <path>        the service list file (default resources/ai-services.json)
  --table              print the Markdown only (progress still goes to stderr)
  --timeout <seconds>  time-out of one exchange (default ${DEFAULT_TIMEOUT_SECONDS})`;

class UsageError extends Error {}
/** A step of an entry failed (transport, HTTP, form, cut answer); the entry continues. */
class StepError extends Error {}
/** A limit wait beyond the budget; the entry stops with the verdict `limit`. */
class LimitExceeded extends Error {}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const seconds = (ms) => (ms / 1000).toFixed(1);
const log = (entryId, message) => console.error(`[${entryId}] ${message}`);

/* -------------------------------------------------------------------------------------- */
/* Arguments and the service list                                                         */
/* -------------------------------------------------------------------------------------- */

function parseArgs(argv) {
  const options = {
    entries: [],
    file: DEFAULT_FILE,
    table: false,
    timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined || next.startsWith('--')) throw new UsageError(`${arg} needs a value`);
      return next;
    };
    switch (arg) {
      case '--entry':
        options.entries.push(value());
        break;
      case '--file':
        options.file = path.resolve(value());
        break;
      case '--table':
        options.table = true;
        break;
      case '--timeout': {
        const parsed = Number(value());
        if (!Number.isFinite(parsed) || parsed <= 0) {
          throw new UsageError('--timeout needs a positive number of seconds');
        }
        options.timeoutSeconds = parsed;
        break;
      }
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new UsageError(`unknown option ${arg}`);
    }
  }
  return options;
}

/**
 * Reads a service list file (resource-formats §A, format version 1) and returns its usable
 * entries: `hidden` ones skipped, the address without a trailing `/`, `tools` defaulting to
 * `true`, `key` kept only when it is a non-empty string.
 */
function loadServices(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  } catch (error) {
    throw new UsageError(`cannot read ${file}: ${error.message}`);
  }
  let root;
  try {
    root = JSON.parse(text);
  } catch (error) {
    throw new UsageError(`${file} is not JSON: ${error.message}`);
  }
  if (!isObject(root) || root.version !== 1 || !Array.isArray(root.services)) {
    throw new UsageError(`${file} is not a service list of format version 1`);
  }
  const entries = [];
  root.services.forEach((entry, index) => {
    if (!isObject(entry)) return;
    if (entry.hidden === true) return;
    for (const field of ['id', 'name', 'address', 'model']) {
      if (typeof entry[field] !== 'string' || entry[field].trim() === '') {
        log(file, `entry ${index} skipped: ${field} missing`);
        return;
      }
    }
    entries.push({
      id: entry.id,
      name: entry.name.trim(),
      address: entry.address.trim().replace(/\/+$/, ''),
      model: entry.model,
      tools: entry.tools !== false,
      key: typeof entry.key === 'string' && entry.key !== '' ? entry.key : null,
      contextLength: Number.isInteger(entry.contextLength) ? entry.contextLength : null,
    });
  });
  return entries;
}

function editorVersion() {
  try {
    const cmake = readFileSync(path.join(ROOT, 'CMakeLists.txt'), 'utf8');
    const match = /project\s*\([\s\S]*?VERSION\s+(\d+\.\d+\.\d+)/i.exec(cmake);
    if (match) return match[1];
  } catch {
    // no CMakeLists.txt next to the tool: the fallback below
  }
  return '0.0.0';
}

const USER_AGENT = `MaximaFictionBookEditor/${editorVersion()} ai-services-check`;

/* -------------------------------------------------------------------------------------- */
/* HTTP                                                                                   */
/* -------------------------------------------------------------------------------------- */

function transportKind(error) {
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return 'timeout';
  const code = String(error?.cause?.code ?? error?.code ?? '');
  if (/CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY|DEPTH_ZERO/i.test(code)) return 'tls';
  return 'offline';
}

function transportMessage(error) {
  const cause = error?.cause;
  if (cause && typeof cause === 'object') {
    const code = typeof cause.code === 'string' ? cause.code : null;
    const message = typeof cause.message === 'string' ? cause.message : null;
    if (code && message && !message.includes(code)) return `${code} ${message}`;
    return code ?? message ?? String(error.message);
  }
  return String(error?.message ?? error);
}

/**
 * One HTTP exchange as the core performs it (ai-service-protocol §2.1): JSON in and out, no
 * redirect followed, `Authorization` only with a key, the exchange time-out. Resolves to
 * `{ok: true, status, headers, text, json?, elapsedMs}` or `{ok: false, kind, message, elapsedMs}`.
 */
async function request(entry, method, url, body, timeoutMs) {
  const headers = { accept: 'application/json', 'user-agent': USER_AGENT };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (entry.key) headers.authorization = `Bearer ${entry.key}`;
  const started = performance.now();
  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return {
      ok: true,
      status: response.status,
      headers: response.headers,
      text,
      json,
      elapsedMs: performance.now() - started,
    };
  } catch (error) {
    return {
      ok: false,
      kind: transportKind(error),
      message: transportMessage(error),
      elapsedMs: performance.now() - started,
    };
  }
}

/** The service's message of a failure body - the ladder of ai-service-protocol §4. */
function extractMessage(result) {
  const { json, text, status } = result;
  if (isObject(json)) {
    if (isObject(json.error) && typeof json.error.message === 'string') {
      // Kilo's top-level `error_type` is the code when `error.code` is only the HTTP status.
      const code =
        typeof json.error.code === 'number' && typeof json.error_type === 'string'
          ? json.error_type
          : (json.error.code ?? json.error.type ?? json.error_type);
      return code === undefined ? json.error.message : `${json.error.message} (${code})`;
    }
    if (typeof json.error === 'string') {
      // Kilo repeats the same text in `error` and `message` (its 404 for a vanished model).
      return typeof json.message === 'string' && json.message !== json.error
        ? `${json.error}: ${json.message}`
        : json.error;
    }
    if (typeof json.message === 'string') return json.message;
  }
  if (typeof text === 'string' && text.trim() !== '') {
    let reduced = text;
    if (/<[a-z!][^>]*>/i.test(reduced)) {
      const pre = /<pre[^>]*>([\s\S]*?)<\/pre>/i.exec(reduced);
      const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(reduced);
      reduced = (pre?.[1] ?? title?.[1] ?? reduced).replace(/<[^>]+>/g, ' ');
    }
    return reduced.replace(/\s+/g, ' ').trim().slice(0, 300);
  }
  return `HTTP ${status}`;
}

/** `Retry-After` as seconds: a delta or an HTTP-date; null when absent or unreadable. */
function parseRetryAfter(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return null;
  return Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

/**
 * A limit answer (ai-service-protocol §5) → `{waitSeconds, source, message}`, else null: 429,
 * 402, 503 with `Retry-After`, or HTTP 200 with an `error` whose code is 429 / 402 and no
 * `choices`.
 */
function limitOf(result) {
  const { status, json, headers } = result;
  const retryAfterHeader = headers.get('retry-after');
  const serviceError =
    isObject(json) && isObject(json.error) && !Array.isArray(json.choices) ? json.error : null;
  const code = serviceError?.code;
  const isLimit =
    status === 429 ||
    status === 402 ||
    (status === 503 && retryAfterHeader !== null) ||
    (status === 200 && serviceError !== null && [429, 402, '429', '402'].includes(code));
  if (!isLimit) return null;
  const message = extractMessage(result);
  let waitSeconds = parseRetryAfter(retryAfterHeader);
  let source = 'header';
  if (waitSeconds === null && typeof serviceError?.retry_after === 'number') {
    waitSeconds = serviceError.retry_after;
    source = 'body';
  }
  if (waitSeconds === null) {
    const match = RETRY_AFTER_IN_MESSAGE.exec(message);
    if (match) {
      waitSeconds = Number(match[1]);
      source = 'message';
    }
  }
  if (waitSeconds === null) {
    waitSeconds = DEFAULT_WAIT_SECONDS;
    source = 'default';
  }
  if (waitSeconds <= 0) waitSeconds = 1;
  return { waitSeconds, source, message };
}

/**
 * Sends one request of an entry: pauses for the entry's limit before every request but the
 * first, waits a limit answer out within the entry's budget and retries the same body once per
 * limit answer. Resolves to the non-limit result (any status); throws `StepError` on a
 * transport failure and `LimitExceeded` when the budget would be overrun.
 */
async function send(ctx, method, url, body) {
  for (;;) {
    if (ctx.requests > 0 && !ctx.skipPause && ctx.pauseSeconds > 0) {
      log(ctx.entry.id, `pausing ${ctx.pauseSeconds} s (the entry's limit)`);
      await sleep(ctx.pauseSeconds * 1000);
    }
    ctx.skipPause = false;
    ctx.requests++;
    log(ctx.entry.id, `${method} ${url}`);
    const result = await request(ctx.entry, method, url, body, ctx.timeoutMs);
    if (!result.ok) {
      throw new StepError(
        `${result.kind}: ${result.message} (after ${seconds(result.elapsedMs)} s)`,
      );
    }
    log(ctx.entry.id, `HTTP ${result.status} in ${seconds(result.elapsedMs)} s`);
    const limit = limitOf(result);
    if (!limit) return result;
    if (ctx.waitedSeconds + limit.waitSeconds > WAIT_BUDGET_SECONDS) {
      throw new LimitExceeded(
        `HTTP ${result.status} asks for a wait of ${limit.waitSeconds} s (${limit.source}: ` +
          `${limit.message}); the budget of ${WAIT_BUDGET_SECONDS} s per entry would be overrun`,
      );
    }
    ctx.waitedSeconds += limit.waitSeconds;
    ctx.waits.push({
      status: result.status,
      waitSeconds: limit.waitSeconds,
      source: limit.source,
    });
    log(
      ctx.entry.id,
      `limit (HTTP ${result.status}): waiting ${limit.waitSeconds} s (${limit.source}) - ${limit.message}`,
    );
    await sleep(limit.waitSeconds * 1000);
    ctx.skipPause = true;
  }
}

/** Attaches a step's partial record to a `LimitExceeded` so the table keeps what was seen. */
function limitWithPartial(error, step, partial) {
  error.step = step;
  error.partial = { ...partial, limited: true };
  return error;
}

/** `choices[0]` of a chat completion; a non-200, a 200-with-error or another form throws. */
function completionChoice(result) {
  const { status, json } = result;
  if (status === 200 && isObject(json) && Array.isArray(json.choices) && json.choices.length > 0) {
    const choice = json.choices[0];
    if (!isObject(choice) || !isObject(choice.message)) {
      throw new StepError('unexpected form: the first choice has no message');
    }
    return choice;
  }
  if (status !== 200) throw new StepError(`HTTP ${status}: ${extractMessage(result)}`);
  if (isObject(json) && isObject(json.error)) {
    throw new StepError(`service error with HTTP 200: ${extractMessage(result)}`);
  }
  throw new StepError(`unexpected form: ${(result.text ?? '').slice(0, 300)}`);
}

/** `content` as a string: absent / null → "", an array of parts → their `text` joined (§3.2). */
function contentText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (isObject(part) && typeof part.text === 'string' ? part.text : ''))
      .join('');
  }
  return '';
}

/* -------------------------------------------------------------------------------------- */
/* The three steps                                                                        */
/* -------------------------------------------------------------------------------------- */

/** The tolerant list rule of ai-service-protocol §7 → `[{id, contextLength?}]` or null. */
function normaliseModels(json) {
  const list = Array.isArray(json)
    ? json
    : isObject(json) && Array.isArray(json.data)
      ? json.data
      : null;
  if (!list) return null;
  const models = [];
  for (const item of list) {
    if (typeof item === 'string') {
      models.push({ id: item, contextLength: null });
      continue;
    }
    if (!isObject(item)) continue;
    const id =
      typeof item.id === 'string' ? item.id : typeof item.name === 'string' ? item.name : null;
    if (id === null) continue;
    const candidates = [item.context_length, item.context_window?.tokens, item.max_model_len];
    const contextLength = candidates.find((value) => Number.isInteger(value) && value > 0) ?? null;
    // Kilo marks its keyless models with `isFree` and a `:free` suffix; LLM7 with `tier: "turbo"`.
    const free = item.isFree === true || id.endsWith(':free') || item.tier === 'turbo';
    models.push({ id, contextLength, free });
  }
  return models;
}

/**
 * Listed ids that resemble a model the service no longer lists - the same vendor prefix
 * (`minimax/...`) or the same first name token (`minimax`, `gpt`) - as a hint for the one-line
 * change of release day (T098); at most eight, in the service's order.
 */
function similarModels(model, models) {
  const lower = model.toLowerCase();
  const slash = lower.indexOf('/');
  const vendor = slash > 0 ? lower.slice(0, slash + 1) : null;
  const firstToken = lower.slice(slash + 1).split(/[^a-z0-9]+/)[0] ?? '';
  return models
    .filter(({ id }) => {
      const candidate = id.toLowerCase();
      if (vendor !== null && candidate.startsWith(vendor)) return true;
      return firstToken.length >= 3 && candidate.includes(firstToken);
    })
    .slice(0, 8)
    .map(({ id, free }) => (free ? `${id} (free)` : id));
}

async function checkModels(ctx) {
  const out = {
    status: null,
    count: null,
    listed: null,
    contextLength: null,
    similar: [],
    elapsedMs: 0,
    error: null,
  };
  try {
    const result = await send(ctx, 'GET', `${ctx.entry.address}/models`);
    out.status = result.status;
    out.elapsedMs = result.elapsedMs;
    if (result.status !== 200) {
      out.error = `HTTP ${result.status}: ${extractMessage(result)}`;
      return out;
    }
    const models = normaliseModels(result.json);
    if (!models) {
      out.error = `unexpected form: ${(result.text ?? '').replace(/\s+/g, ' ').slice(0, 120)}`;
      return out;
    }
    out.count = models.length;
    const found = models.find((model) => model.id === ctx.entry.model);
    out.listed = found !== undefined;
    out.contextLength = found?.contextLength ?? null;
    if (!out.listed) {
      out.similar = similarModels(ctx.entry.model, models);
      out.freeCount = models.filter((model) => model.free).length;
    }
  } catch (error) {
    if (error instanceof LimitExceeded) throw limitWithPartial(error, 'models', out);
    out.error = error.message;
  }
  return out;
}

/** Executes one `read_section` call; the result is the string of a `tool` message. */
function runTool(call) {
  const name = call.function?.name;
  if (name !== 'read_section') {
    return JSON.stringify({
      error: { code: 'unknownTool', message: `no tool named ${name}` },
    });
  }
  let args = call.function?.arguments;
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args);
    } catch (error) {
      return JSON.stringify({
        error: {
          code: 'invalidArguments',
          message: `arguments are not valid JSON: ${error.message}`,
        },
      });
    }
  }
  const number = Number(isObject(args) ? args.section_number : NaN);
  const text = SECTIONS[number];
  if (text === undefined) {
    return JSON.stringify({
      error: {
        code: 'invalidArguments',
        message: 'section_number must be 1 or 2',
      },
    });
  }
  return JSON.stringify({
    section_number: number,
    text,
    characters: text.length,
  });
}

async function checkToolCall(ctx) {
  const out = {
    exchanges: 0,
    exchangeMs: [],
    elapsedMs: 0,
    finishReasons: [],
    callsPerExchange: [],
    pattern: null,
    answer: null,
    namesSection2: false,
    error: null,
  };
  const messages = [
    { role: 'system', content: TOOL_SYSTEM },
    { role: 'user', content: TOOL_QUESTION },
  ];
  const body = {
    model: ctx.entry.model,
    stream: false,
    messages,
    tools: TOOLS,
    tool_choice: 'auto',
  };
  const url = `${ctx.entry.address}/chat/completions`;
  try {
    while (out.exchanges < MAX_EXCHANGES) {
      const result = await send(ctx, 'POST', url, body);
      out.exchanges++;
      out.exchangeMs.push(result.elapsedMs);
      out.elapsedMs += result.elapsedMs;
      const choice = completionChoice(result);
      const finish = typeof choice.finish_reason === 'string' ? choice.finish_reason : null;
      out.finishReasons.push(finish ?? '-');
      const message = choice.message;
      const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
      if (finish === 'length') {
        throw new StepError('the service cut the answer (finish_reason "length")');
      }
      if (finish === 'content_filter') {
        throw new StepError(`the service refused the content: ${contentText(message.content)}`);
      }
      if (calls.length === 0) {
        out.answer = contentText(message.content) || (message.refusal ?? '');
        break;
      }
      // The assistant message goes back as received, `content` normalised to "" (protocol §2.3).
      messages.push({ ...message, content: contentText(message.content) });
      out.callsPerExchange.push(calls.length);
      calls.forEach((call, index) => {
        const id =
          typeof call?.id === 'string' && call.id !== ''
            ? call.id
            : `mfbe_call_${out.exchanges}_${index + 1}`;
        const content =
          call?.type === 'function' || call?.type === undefined
            ? runTool(call)
            : JSON.stringify({
                error: {
                  code: 'invalidArguments',
                  message: `unsupported tool call type ${call.type}`,
                },
              });
        log(
          ctx.entry.id,
          `tool call ${call?.function?.name}(${typeof call?.function?.arguments === 'string' ? call.function.arguments : JSON.stringify(call?.function?.arguments)}) → ${content.length} characters`,
        );
        messages.push({ role: 'tool', tool_call_id: id, content });
      });
    }
    if (out.answer === null) {
      throw new StepError(`no final answer after ${out.exchanges} exchanges`);
    }
    if (out.callsPerExchange.length === 0) {
      throw new StepError(`no tool call was made; the answer: "${out.answer}"`);
    }
    out.pattern = out.callsPerExchange.some((count) => count > 1) ? 'parallel' : 'sequential';
    out.namesSection2 =
      NAMES_SECTION_2.test(out.answer) && !CLAIMS_SECTION_1_LONGER.test(out.answer);
  } catch (error) {
    if (error instanceof LimitExceeded) throw limitWithPartial(error, 'toolCall', out);
    out.error = error.message;
  }
  return out;
}

/** The expected answer after the normalisation of quickstart §12 item 3. */
function normaliseProof(text) {
  let normalised = text
    .replace(/^\uFEFF/, '')
    .replace(/[\u202F\u00A0]/g, ' ')
    .trim();
  const fence = /^```[^\n]*\n([\s\S]*?)\n?```$/.exec(normalised);
  if (fence) normalised = fence[1].trim();
  return normalised;
}

/**
 * True when `got` is `accepted` with at least one of its ё written as е and nothing else
 * different - never the other way round (a ё where е is expected is a difference). Both letters
 * are one UTF-16 unit, so the comparison is positional.
 */
function onlyYoDropped(got, accepted) {
  if (got.length !== accepted.length) return false;
  let dropped = false;
  for (let i = 0; i < accepted.length; i++) {
    if (got[i] === accepted[i]) continue;
    if ((accepted[i] === 'ё' && got[i] === 'е') || (accepted[i] === 'Ё' && got[i] === 'Е')) {
      dropped = true;
      continue;
    }
    return false;
  }
  return dropped;
}

/**
 * The verdict of a normalised proof-reading answer: `{ok: true, result: 'ok'}` for an accepted
 * form, `{ok: true, result: 'ok (е for ё)', note}` for one with е written for ё, else
 * `{ok: false, result: 'differs'}`.
 */
function judgeProof(got) {
  if (PROOF_ACCEPTED.includes(got)) return { ok: true, result: 'ok', note: null };
  if (PROOF_ACCEPTED.some((accepted) => onlyYoDropped(got, accepted))) {
    return {
      ok: true,
      result: 'ok (е for ё)',
      note: 'proof-reading wrote е for ё (accepted: ё is optional in Russian print)',
    };
  }
  return { ok: false, result: 'differs', note: null };
}

async function checkProofReading(ctx) {
  const out = {
    elapsedMs: 0,
    answer: null,
    result: null,
    ok: false,
    note: null,
    error: null,
  };
  const body = {
    model: ctx.entry.model,
    stream: false,
    messages: [
      { role: 'system', content: PROOF_SYSTEM },
      { role: 'user', content: PROOF_USER },
    ],
  };
  try {
    const result = await send(ctx, 'POST', `${ctx.entry.address}/chat/completions`, body);
    out.elapsedMs = result.elapsedMs;
    const choice = completionChoice(result);
    if (choice.finish_reason === 'length') {
      throw new StepError('the service cut the answer (finish_reason "length")');
    }
    out.answer = contentText(choice.message.content);
    const verdict = judgeProof(normaliseProof(out.answer));
    out.ok = verdict.ok;
    out.result = verdict.result;
    out.note = verdict.note;
  } catch (error) {
    if (error instanceof LimitExceeded) throw limitWithPartial(error, 'proof', out);
    out.error = error.message;
  }
  return out;
}

/* -------------------------------------------------------------------------------------- */
/* One entry                                                                              */
/* -------------------------------------------------------------------------------------- */

async function checkEntry(entry, timeoutSeconds) {
  const ctx = {
    entry,
    timeoutMs: timeoutSeconds * 1000,
    pauseSeconds: PAUSE_SECONDS[entry.id] ?? DEFAULT_PAUSE_SECONDS,
    requests: 0,
    skipPause: false,
    waitedSeconds: 0,
    waits: [],
  };
  const report = {
    entry,
    models: null,
    toolCall: null,
    proof: null,
    waits: ctx.waits,
    verdict: 'pass',
    reasons: [],
  };
  const started = performance.now();
  let limited = null;
  try {
    report.models = await checkModels(ctx);
    if (entry.tools) report.toolCall = await checkToolCall(ctx);
    report.proof = await checkProofReading(ctx);
  } catch (error) {
    if (!(error instanceof LimitExceeded)) throw error;
    limited = error.message;
    if (error.step) report[error.step] = error.partial;
  }
  report.elapsedMs = performance.now() - started;
  // The reasons of the steps that ran, whatever the verdict - a `limit` entry still tells what
  // it saw before the wait.
  const { reasons } = report;
  const { models, toolCall, proof } = report;
  if (limited !== null) reasons.push(limited);
  if (models?.error) reasons.push(`/models: ${models.error}`);
  else if (models && !models.limited && !models.listed) {
    const hints = [];
    if (models.similar.length > 0) hints.push(`listed instead: ${models.similar.join(', ')}`);
    if (models.freeCount > 0) hints.push(`${plural(models.freeCount, 'model')} marked free`);
    const hint = hints.length > 0 ? ` (${hints.join('; ')})` : '';
    reasons.push(`/models does not list ${entry.model}${hint}`);
  }
  if (toolCall?.error) reasons.push(`tool call: ${toolCall.error}`);
  else if (toolCall && !toolCall.limited && !toolCall.namesSection2) {
    reasons.push(`tool call: the final answer does not name section 2: "${toolCall.answer}"`);
  }
  if (proof?.error) reasons.push(`proof-reading: ${proof.error}`);
  else if (proof && !proof.limited && !proof.ok) {
    reasons.push(`proof-reading ${proof.result}: "${proof.answer}"`);
  }
  if (limited !== null) report.verdict = 'limit';
  else report.verdict = reasons.length === 0 ? 'pass' : 'fail';
  // Notes: what passed with a remark - printed under the table, no effect on the verdict.
  const notes = [];
  if (proof?.note) notes.push(`${proof.note}: "${proof.answer}"`);
  if (
    report.models?.contextLength &&
    entry.contextLength &&
    report.models.contextLength !== entry.contextLength
  ) {
    notes.push(
      `/models reports a context of ${report.models.contextLength}, the entry says ${entry.contextLength}`,
    );
  }
  if (notes.length > 0) report.notes = notes;
  return report;
}

/* -------------------------------------------------------------------------------------- */
/* Output                                                                                 */
/* -------------------------------------------------------------------------------------- */

const cell = (text) =>
  String(text)
    .replace(/\|/g, '\\|')
    .replace(/\s*\n\s*/g, ' ');

const plural = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;

function modelsCell(models) {
  if (!models) return 'not run';
  if (models.limited) return 'limit';
  if (models.error)
    return models.status === null ? models.error : `HTTP ${models.status}, ${models.error}`;
  const context = models.contextLength ? `, context ${models.contextLength}` : '';
  const listed = models.listed ? 'listed' : 'not listed';
  return `${models.status}, ${plural(models.count, 'model')}, ${listed}${context}`;
}

function toolCallCell(report) {
  const { toolCall, entry } = report;
  if (!entry.tools) return 'n/a (tools: false)';
  if (!toolCall) return 'not run';
  const timing = toolCall.exchanges > 0 ? plural(toolCall.exchanges, 'exchange') : 'no exchange';
  if (toolCall.limited) return `${timing}, ${seconds(toolCall.elapsedMs)} s, then limit`;
  if (toolCall.error) return `${timing}, ${seconds(toolCall.elapsedMs)} s, failed`;
  const result = toolCall.namesSection2 ? 'section 2' : 'wrong answer';
  return `${timing} (${toolCall.pattern}), ${seconds(toolCall.elapsedMs)} s, ${result}`;
}

function proofCell(proof) {
  if (!proof) return 'not run';
  if (proof.limited) return 'limit';
  if (proof.error) return `${seconds(proof.elapsedMs)} s, failed`;
  return `${seconds(proof.elapsedMs)} s, ${proof.result}`;
}

function markdown(reports, date) {
  const lines = [
    `Free services verified on ${date} (UTC)`,
    '',
    '| Service | Model | /models | Tool call (exchanges, s) | Proof-reading (s, result) | Verdict |',
    '|---|---|---|---|---|---|',
  ];
  for (const report of reports) {
    lines.push(
      `| ${cell(report.entry.name)} | \`${cell(report.entry.model)}\` | ${cell(modelsCell(report.models))} | ` +
        `${cell(toolCallCell(report))} | ${cell(proofCell(report.proof))} | ${report.verdict} |`,
    );
  }
  const remarks = reports.filter((report) => report.reasons.length > 0 || report.notes);
  if (remarks.length > 0) {
    lines.push('');
    for (const report of remarks) {
      const items = [...report.reasons, ...(report.notes ?? [])];
      lines.push(`- **${report.entry.id}** (${report.verdict}): ${items.map(cell).join('; ')}`);
    }
  }
  return lines.join('\n');
}

function details(report) {
  const { entry, models, toolCall, proof, waits } = report;
  const lines = [
    `${entry.id} - ${entry.name}, ${entry.model}, ${entry.address}: ${report.verdict} (${seconds(report.elapsedMs)} s in all)`,
  ];
  if (models) {
    lines.push(
      `  /models: ${modelsCell(models)}${models.status !== null ? ` in ${seconds(models.elapsedMs)} s` : ''}`,
    );
  }
  if (toolCall && toolCall.exchanges === 0) {
    lines.push('  tool call: no exchange');
  } else if (toolCall) {
    lines.push(
      `  tool call: ${plural(toolCall.exchanges, 'exchange')}, finish_reason ${toolCall.finishReasons.join(' / ') || '-'}, ` +
        `${toolCall.exchangeMs.map(seconds).join(' + ')} s, calls per exchange ${toolCall.callsPerExchange.join(', ') || 'none'}`,
    );
  }
  if (toolCall?.answer !== null && toolCall?.answer !== undefined) {
    lines.push(`  tool call answer: "${toolCall.answer}"`);
  }
  if (toolCall?.error) lines.push(`  tool call error: ${toolCall.error}`);
  if (proof) {
    if (proof.answer !== null) {
      lines.push(
        `  proof-reading: ${seconds(proof.elapsedMs)} s, ${proof.result}; answer: "${proof.answer}"`,
      );
    }
    if (proof.error) lines.push(`  proof-reading error: ${proof.error}`);
  }
  if (waits.length > 0) {
    lines.push(
      `  waits: ${waits.map((wait) => `HTTP ${wait.status} → ${wait.waitSeconds} s (${wait.source})`).join(', ')}`,
    );
  }
  for (const reason of report.reasons) lines.push(`  reason: ${reason}`);
  for (const note of report.notes ?? []) lines.push(`  note: ${note}`);
  return lines.join('\n');
}

/* -------------------------------------------------------------------------------------- */
/* Main                                                                                   */
/* -------------------------------------------------------------------------------------- */

async function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(USAGE);
    return 0;
  }
  let entries = loadServices(options.file);
  if (options.entries.length > 0) {
    const known = new Set(entries.map((entry) => entry.id));
    for (const id of options.entries) {
      if (!known.has(id)) throw new UsageError(`no entry "${id}" in ${options.file}`);
    }
    entries = entries.filter((entry) => options.entries.includes(entry.id));
  }
  if (entries.length === 0) throw new UsageError(`no usable entry in ${options.file}`);

  const reports = [];
  for (const entry of entries) {
    log(entry.id, `checking ${entry.name} (${entry.model} at ${entry.address})`);
    const report = await checkEntry(entry, options.timeoutSeconds);
    log(
      entry.id,
      `verdict ${report.verdict}${report.reasons.length ? ` - ${report.reasons.join('; ')}` : ''}`,
    );
    reports.push(report);
  }

  const date = new Date().toISOString().slice(0, 10);
  const table = markdown(reports, date);
  if (options.table) {
    console.log(table);
  } else {
    console.log(table);
    console.log('');
    for (const report of reports) console.log(details(report));
  }
  return reports.some((report) => report.verdict === 'fail') ? 1 : 0;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    if (error instanceof UsageError) {
      console.error(`ai-services-check: ${error.message}\n${USAGE}`);
      process.exitCode = 2;
    } else {
      console.error(`ai-services-check: ${error?.stack ?? error}`);
      process.exitCode = 1;
    }
  },
);

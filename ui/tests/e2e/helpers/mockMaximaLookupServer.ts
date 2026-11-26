/**
 * Deterministic loopback mock Maxima Library Lookup Service v2 server for Playwright E2E tests
 * (feature 021, contracts/lookup-v2.md). Implements POST /index.php?option=com_maxlib&controller=lookupv2
 * with full parity for verify, search, and exists across persons, 3-tab author series, publishers,
 * and 2-tab publisher series, plus injectable auth/rate-limit/error/slow-delay modes.
 */

import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export type MockMaximaErrorMode =
  | 'ok'
  | 'unauthorized'
  | 'invalid_token'
  | 'account_disabled'
  | 'https_required'
  | 'wrong_version'
  | 'rate_limited'
  | 'server_error'
  | 'malformed_json'
  | 'wrong_id';

export interface RecordedMaximaLookupRequest {
  method: string;
  url: string;
  authorization: string | undefined;
  cookie: string | undefined;
  body: Record<string, unknown> | null;
  rawBody: string;
  timestampMs: number;
}

interface MockPerson {
  id: number;
  lastName: string;
  firstName: string;
  middleName: string;
}

interface MockAuthorSeries {
  id: number;
  name: string;
  parentId?: number;
  authorIds: number[];
  makerIds: number[];
}

interface MockPublisher {
  id: number;
  name: string;
  bookCount: number;
}

interface MockPublisherSeries {
  id: number;
  name: string;
  publishers: Array<{ id: number; name: string }>;
  text: string;
}

function buildPersonFullName(p: MockPerson): string {
  return [p.lastName, p.firstName, p.middleName].filter((part) => part.length > 0).join(' ');
}

function normalizeSearch(value: string): string {
  return value.trim().toLocaleLowerCase('ru').replaceAll('ё', 'е');
}

function createCatalog() {
  const persons: MockPerson[] = [
    { id: 101, lastName: 'Толстой', firstName: 'Лев', middleName: 'Николаевич' },
    { id: 102, lastName: 'Толстой', firstName: 'Алексей', middleName: 'Николаевич' },
    { id: 103, lastName: 'Толстой', firstName: 'Лев', middleName: '' },
    { id: 104, lastName: 'Ван Гог', firstName: 'Винсент', middleName: '' },
    { id: 105, lastName: 'Дубль', firstName: 'Иван', middleName: 'Иванович' },
    { id: 106, lastName: 'Дубль', firstName: 'Иван', middleName: 'Иванович' },
    { id: 107, lastName: 'Первомайский', firstName: 'Аркадий', middleName: 'Петрович' },
    { id: 108, lastName: 'Билибин', firstName: 'Иван', middleName: 'Яковлевич' },
    { id: 109, lastName: 'Редакторов', firstName: 'Сергей', middleName: '' },
    { id: 110, lastName: 'Составителев', firstName: 'Пётр', middleName: '' },
    { id: 111, lastName: 'Оформителев', firstName: 'Олег', middleName: '' },
    { id: 112, lastName: 'Комментаторов', firstName: 'Денис', middleName: '' },
    { id: 113, lastName: 'Биографов', firstName: 'Антон', middleName: '' },
    { id: 114, lastName: '', firstName: 'Аристотель', middleName: '' },
  ];
  for (let i = 1; i <= 35; i += 1) {
    const num = String(i).padStart(2, '0');
    persons.push({
      id: 200 + i,
      lastName: 'Пагинаторов',
      firstName: `Имя${num}`,
      middleName: '',
    });
  }

  const authorSeries: MockAuthorSeries[] = [
    { id: 301, name: 'Война и мир (цикл)', authorIds: [101], makerIds: [] },
    { id: 302, name: 'Война и мир: Тома', parentId: 301, authorIds: [101], makerIds: [] },
    { id: 303, name: 'Переводы классики', authorIds: [], makerIds: [107] },
    { id: 304, name: 'Библиотека иллюстратора', authorIds: [], makerIds: [108] },
    { id: 305, name: 'Общая серия фантастики', authorIds: [], makerIds: [] },
    { id: 306, name: 'Серия биографа', authorIds: [], makerIds: [113] },
    { id: 307, name: 'Совместная серия', authorIds: [101], makerIds: [107] },
  ];

  const publishers: MockPublisher[] = [
    { id: 401, name: 'АСТ', bookCount: 15420 },
    { id: 402, name: 'Эксмо', bookCount: 22105 },
    { id: 403, name: 'Наука', bookCount: 4100 },
    { id: 404, name: 'Наука', bookCount: 85 },
  ];

  const publisherSeries: MockPublisherSeries[] = [
    {
      id: 501,
      name: 'Эксклюзивная классика',
      publishers: [{ id: 401, name: 'АСТ' }],
      text: '',
    },
    {
      id: 502,
      name: 'Мировая классика',
      publishers: [],
      text: 'АСТ',
    },
    {
      id: 503,
      name: 'Шедевры прозы',
      publishers: [{ id: 402, name: 'Эксмо' }],
      text: '',
    },
    {
      id: 504,
      name: 'Золотой фонд',
      publishers: [{ id: 401, name: 'АСТ' }],
      text: '',
    },
    {
      id: 505,
      name: 'Золотой фонд',
      publishers: [{ id: 402, name: 'Эксмо' }],
      text: '',
    },
  ];

  return { persons, authorSeries, publishers, publisherSeries };
}

export class MockMaximaLookupServer {
  private server: Server | null = null;
  private baseUrl_ = '';
  private validToken = 'test-lookup-token-valid';
  private mode: MockMaximaErrorMode = 'ok';
  private retryAfterSeconds = 5;
  private delayMs = 0;
  private readonly requests_: RecordedMaximaLookupRequest[] = [];
  private readonly catalog = createCatalog();

  get baseUrl(): string {
    return this.baseUrl_;
  }

  get requests(): readonly RecordedMaximaLookupRequest[] {
    return this.requests_;
  }

  setValidToken(token: string): void {
    this.validToken = token;
  }

  setMode(mode: MockMaximaErrorMode): void {
    this.mode = mode;
  }

  setRetryAfter(seconds: number): void {
    this.retryAfterSeconds = seconds;
  }

  setDelayMs(ms: number): void {
    this.delayMs = ms;
  }

  resetRequests(): void {
    this.requests_.length = 0;
  }

  async start(): Promise<string> {
    if (this.server) return this.baseUrl_;
    this.server = http.createServer((req, res) => {
      void this.handle(req, res);
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(0, '127.0.0.1', () => {
        const addr = this.server!.address();
        if (addr && typeof addr === 'object') {
          this.baseUrl_ = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
    return this.baseUrl_;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    const srv = this.server;
    this.server = null;
    await new Promise<void>((resolve) => srv.close(() => resolve()));
  }

  private sendJson(
    res: ServerResponse,
    status: number,
    payload: unknown,
    extraHeaders: Record<string, string> = {},
  ): void {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      ...extraHeaders,
    });
    res.end(body);
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    const rawBody = Buffer.concat(chunks).toString('utf8');
    let parsed: Record<string, unknown> | null = null;
    try {
      const candidate = JSON.parse(rawBody);
      if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
        parsed = candidate as Record<string, unknown>;
      }
    } catch {
      parsed = null;
    }

    this.requests_.push({
      method: req.method ?? '',
      url: req.url ?? '',
      authorization:
        typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined,
      cookie: typeof req.headers.cookie === 'string' ? req.headers.cookie : undefined,
      body: parsed,
      rawBody,
      timestampMs: Date.now(),
    });

    if (this.delayMs > 0) {
      let aborted = false;
      req.once('close', () => {
        aborted = true;
      });
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, this.delayMs);
        req.once('close', () => {
          clearTimeout(timer);
          resolve();
        });
      });
      if (aborted || res.destroyed) return;
    }

    const reqUrl = new URL(req.url ?? '/', this.baseUrl_);
    if (
      reqUrl.pathname !== '/index.php' ||
      reqUrl.searchParams.get('option') !== 'com_maxlib' ||
      reqUrl.searchParams.get('controller') !== 'lookupv2'
    ) {
      this.sendJson(res, 404, { id: '', code: 'not_found', err: 'Not found' });
      return;
    }

    if (req.method !== 'POST') {
      this.sendJson(res, 405, { id: '', code: 'method_not_allowed', err: 'POST required' });
      return;
    }

    const reqId = typeof parsed?.id === 'string' ? parsed.id : '';

    if (this.mode === 'malformed_json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{not-valid-json');
      return;
    }
    if (this.mode === 'https_required') {
      this.sendJson(res, 403, { id: reqId, code: 'https_required', err: 'HTTPS required' });
      return;
    }
    if (this.mode === 'unauthorized') {
      this.sendJson(res, 401, { id: reqId, code: 'unauthorized', err: 'Missing token' });
      return;
    }
    if (this.mode === 'invalid_token') {
      this.sendJson(res, 401, { id: reqId, code: 'invalid_token', err: 'Invalid token' });
      return;
    }
    if (this.mode === 'account_disabled') {
      this.sendJson(res, 403, { id: reqId, code: 'account_disabled', err: 'Account disabled' });
      return;
    }
    if (this.mode === 'wrong_version') {
      this.sendJson(res, 400, { id: reqId, code: 'wrong_version', err: 'Unsupported version' });
      return;
    }
    if (this.mode === 'rate_limited') {
      this.sendJson(
        res,
        429,
        { id: reqId, code: 'rate_limited', err: 'Too many requests' },
        { 'Retry-After': String(this.retryAfterSeconds) },
      );
      return;
    }
    if (this.mode === 'server_error') {
      this.sendJson(res, 500, { id: reqId, code: 'server_error', err: 'Internal error' });
      return;
    }

    const auth = req.headers.authorization;
    if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) {
      this.sendJson(res, 401, { id: reqId, code: 'unauthorized', err: 'Missing Bearer token' });
      return;
    }
    const token = auth.slice('Bearer '.length);
    if (token !== this.validToken) {
      this.sendJson(res, 401, { id: reqId, code: 'invalid_token', err: 'Token not recognized' });
      return;
    }

    if (!parsed) {
      this.sendJson(res, 400, { id: '', code: 'invalid_request', err: 'Invalid JSON body' });
      return;
    }
    if (parsed.version !== '2') {
      this.sendJson(res, 400, { id: reqId, code: 'wrong_version', err: 'Expected version 2' });
      return;
    }

    const replyId = this.mode === 'wrong_id' ? `${reqId}-corrupted` : reqId;
    const task = parsed.task;

    if (task === 'verify') {
      this.sendJson(res, 200, { id: replyId, code: '', err: '' });
      return;
    }

    const role = typeof parsed.role === 'string' ? parsed.role : '';
    const firstRecord =
      typeof parsed.firstRecord === 'number' ? Math.max(0, parsed.firstRecord) : 0;
    const recordsPerSearch =
      typeof parsed.recordsPerSearch === 'number'
        ? Math.min(100, Math.max(1, parsed.recordsPerSearch))
        : 30;

    if (task === 'search') {
      if (
        [
          'author',
          'translator',
          'illustrator',
          'editor',
          'compiler',
          'designer',
          'commentator',
          'abouttheauthor',
        ].includes(role)
      ) {
        const qLast = normalizeSearch(typeof parsed.lastName === 'string' ? parsed.lastName : '');
        const qFirst = normalizeSearch(
          typeof parsed.firstName === 'string' ? parsed.firstName : '',
        );
        const matched = this.catalog.persons
          .filter((p) => {
            const pLast = normalizeSearch(p.lastName);
            const pFirst = normalizeSearch(p.firstName);
            if (qLast.length > 0 && !pLast.includes(qLast)) return false;
            if (qFirst.length > 0 && !pFirst.includes(qFirst)) return false;
            return qLast.length > 0 || qFirst.length > 0;
          })
          .map((p) => ({
            id: p.id,
            lastName: p.lastName,
            firstName: p.firstName,
            middleName: p.middleName,
            fullName: buildPersonFullName(p),
            url: `${this.baseUrl_}/index.php?option=com_maxlib&view=maxlibbookslist&layout=author&id=${p.id}`,
          }));
        const page = matched.slice(firstRecord, firstRecord + recordsPerSearch);
        this.sendJson(res, 200, {
          id: replyId,
          code: '',
          err: '',
          returned: page.length,
          items: page,
        });
        return;
      }

      if (role === 'series') {
        const qName = normalizeSearch(
          typeof parsed.seriesName === 'string' ? parsed.seriesName : '',
        );
        const narrow = typeof parsed.narrow === 'string' ? parsed.narrow : 'all';
        const excludedId =
          typeof parsed.excludedSeriesId === 'number' ? parsed.excludedSeriesId : null;
        const authorIds = this.resolvePersonIds(parsed.authorIds, parsed.authorNames);
        const makerIds = this.resolvePersonIds(parsed.makerIds, parsed.makerNames);

        const matched = this.catalog.authorSeries
          .filter((s) => {
            if (excludedId !== null && s.id === excludedId) return false;
            const byAuthors = s.authorIds.some((id) => authorIds.has(id));
            const byMakers =
              s.authorIds.some((id) => makerIds.has(id)) ||
              s.makerIds.some((id) => makerIds.has(id) || authorIds.has(id));
            if (narrow === 'authors' && !byAuthors) return false;
            if (narrow === 'makers' && !byMakers) return false;
            if (qName.length > 0 && !normalizeSearch(s.name).includes(qName)) return false;
            return true;
          })
          .map((s) => {
            const byAuthors = s.authorIds.some((id) => authorIds.has(id));
            const byMakers =
              s.authorIds.some((id) => makerIds.has(id)) ||
              s.makerIds.some((id) => makerIds.has(id) || authorIds.has(id));
            const parent =
              s.parentId !== undefined
                ? this.catalog.authorSeries.find((p) => p.id === s.parentId)
                : undefined;
            return {
              id: s.id,
              name: s.name,
              authors: byAuthors,
              makers: byMakers,
              url: `${this.baseUrl_}/index.php?option=com_maxlib&view=maxlibseries&id=${s.id}`,
              ...(parent ? { parent: { id: parent.id, name: parent.name } } : {}),
            };
          });
        const page = matched.slice(firstRecord, firstRecord + recordsPerSearch);
        this.sendJson(res, 200, {
          id: replyId,
          code: '',
          err: '',
          returned: page.length,
          items: page,
        });
        return;
      }

      if (role === 'publisher') {
        const qName = normalizeSearch(
          typeof parsed.publisherName === 'string' ? parsed.publisherName : '',
        );
        const matched = this.catalog.publishers
          .filter((p) => qName.length > 0 && normalizeSearch(p.name).includes(qName))
          .map((p) => ({
            id: p.id,
            name: p.name,
            bookCount: p.bookCount,
            url: `${this.baseUrl_}/index.php?option=com_maxlib&view=maxlibpublisher&id=${p.id}`,
          }));
        const page = matched.slice(firstRecord, firstRecord + recordsPerSearch);
        this.sendJson(res, 200, {
          id: replyId,
          code: '',
          err: '',
          returned: page.length,
          items: page,
        });
        return;
      }

      if (role === 'publisherseries') {
        const qName = normalizeSearch(
          typeof parsed.seriesName === 'string' ? parsed.seriesName : '',
        );
        const restrict = parsed.restrict === true;
        const pubIds = new Set<number>(
          Array.isArray(parsed.publisherIds)
            ? parsed.publisherIds.filter((v): v is number => typeof v === 'number')
            : [],
        );
        const pubNames = new Set<string>(
          Array.isArray(parsed.publisherNames)
            ? parsed.publisherNames
                .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
                .map((s) => normalizeSearch(s))
            : [],
        );

        const matched = this.catalog.publisherSeries
          .map((s) => {
            const linked = s.publishers.some(
              (p) => pubIds.has(p.id) || pubNames.has(normalizeSearch(p.name)),
            );
            const nameMatch =
              !linked &&
              s.text.trim().length > 0 &&
              Array.from(pubNames).some((pn) => normalizeSearch(s.text).includes(pn));
            return { s, linked, nameMatch };
          })
          .filter(({ s, linked, nameMatch }) => {
            if (restrict && !linked && !nameMatch) return false;
            if (qName.length > 0 && !normalizeSearch(s.name).includes(qName)) return false;
            return true;
          })
          .map(({ s, linked, nameMatch }) => ({
            id: s.id,
            name: s.name,
            publishers: s.publishers,
            text: s.text,
            linked,
            nameMatch,
            url: `${this.baseUrl_}/index.php?option=com_maxlib&view=maxlibpublisherseries&id=${s.id}`,
          }));
        const page = matched.slice(firstRecord, firstRecord + recordsPerSearch);
        this.sendJson(res, 200, {
          id: replyId,
          code: '',
          err: '',
          returned: page.length,
          items: page,
        });
        return;
      }
    }

    if (task === 'exists') {
      if (
        [
          'author',
          'translator',
          'illustrator',
          'editor',
          'compiler',
          'designer',
          'commentator',
          'abouttheauthor',
        ].includes(role)
      ) {
        // Strict case-sensitive and е/ё-sensitive trimmed comparison matching Lookupv2Controller.php.
        const qLast = typeof parsed.lastName === 'string' ? parsed.lastName.trim() : '';
        const qFirst = typeof parsed.firstName === 'string' ? parsed.firstName.trim() : '';
        const qMiddle = typeof parsed.middleName === 'string' ? parsed.middleName.trim() : '';
        const matchedIds = this.catalog.persons
          .filter(
            (p) =>
              p.lastName.trim() === qLast &&
              p.firstName.trim() === qFirst &&
              p.middleName.trim() === qMiddle,
          )
          .map((p) => p.id);
        this.sendJson(res, 200, { id: replyId, code: '', err: '', matchedIds });
        return;
      }

      if (role === 'series') {
        const qName = typeof parsed.seriesName === 'string' ? parsed.seriesName.trim() : '';
        const parentSeriesId =
          typeof parsed.parentSeriesId === 'number' ? parsed.parentSeriesId : undefined;
        const matchedIds = this.catalog.authorSeries
          .filter((s) => {
            if (s.name.trim() !== qName) return false;
            if (parentSeriesId !== undefined) return s.parentId === parentSeriesId;
            return s.parentId === undefined;
          })
          .map((s) => s.id);
        this.sendJson(res, 200, { id: replyId, code: '', err: '', matchedIds });
        return;
      }

      if (role === 'publisher') {
        const qName = typeof parsed.publisherName === 'string' ? parsed.publisherName.trim() : '';
        const items = this.catalog.publishers
          .filter((p) => p.name.trim().toLocaleLowerCase('ru') === qName.toLocaleLowerCase('ru'))
          .map((p) => ({
            id: p.id,
            name: p.name,
            bookCount: p.bookCount,
            url: `${this.baseUrl_}/index.php?option=com_maxlib&view=maxlibpublisher&id=${p.id}`,
          }));
        this.sendJson(res, 200, { id: replyId, code: '', err: '', returned: items.length, items });
        return;
      }

      if (role === 'publisherseries') {
        const qName = typeof parsed.seriesName === 'string' ? parsed.seriesName.trim() : '';
        const pubIds = new Set<number>(
          Array.isArray(parsed.publisherIds)
            ? parsed.publisherIds.filter((v): v is number => typeof v === 'number')
            : [],
        );
        const pubNames = new Set<string>(
          Array.isArray(parsed.publisherNames)
            ? parsed.publisherNames
                .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
                .map((s) => normalizeSearch(s))
            : [],
        );
        const items = this.catalog.publisherSeries
          .filter((s) => s.name.trim().toLocaleLowerCase('ru') === qName.toLocaleLowerCase('ru'))
          .map((s) => {
            const linked = s.publishers.some(
              (p) => pubIds.has(p.id) || pubNames.has(normalizeSearch(p.name)),
            );
            const nameMatch =
              !linked &&
              s.text.trim().length > 0 &&
              Array.from(pubNames).some((pn) => normalizeSearch(s.text).includes(pn));
            return {
              id: s.id,
              name: s.name,
              publishers: s.publishers,
              text: s.text,
              linked,
              nameMatch,
              url: `${this.baseUrl_}/index.php?option=com_maxlib&view=maxlibpublisherseries&id=${s.id}`,
            };
          });
        this.sendJson(res, 200, { id: replyId, code: '', err: '', returned: items.length, items });
        return;
      }
    }

    this.sendJson(res, 400, { id: replyId, code: 'invalid_request', err: 'Unsupported task/role' });
  }

  private resolvePersonIds(rawIds: unknown, rawNames: unknown): Set<number> {
    const ids = new Set<number>();
    if (Array.isArray(rawIds)) {
      for (const v of rawIds) {
        if (typeof v === 'number' && v > 0) ids.add(v);
      }
    }
    if (Array.isArray(rawNames)) {
      for (const entry of rawNames) {
        if (!entry || typeof entry !== 'object') continue;
        const e = entry as Record<string, unknown>;
        const l = normalizeSearch(typeof e.lastName === 'string' ? e.lastName : '');
        const f = normalizeSearch(typeof e.firstName === 'string' ? e.firstName : '');
        const m = normalizeSearch(typeof e.middleName === 'string' ? e.middleName : '');
        for (const p of this.catalog.persons) {
          if (
            normalizeSearch(p.lastName) === l &&
            normalizeSearch(p.firstName) === f &&
            (m.length === 0 || normalizeSearch(p.middleName) === m)
          ) {
            ids.add(p.id);
          }
        }
      }
    }
    return ids;
  }
}

/**
 * Outcome triage of the AI assistant (feature 005 T040; ai-service-protocol §3.1–§3.5,
 * data-model §9.3–§9.4): the recorded `AiOutcome` shapes of the four bundled services (research
 * R3, `R3-evidence/<service>/…`, copied here as literals) and the synthetic shapes the contract
 * names - `content` absent / `""` / `null` / a parts array / text beside tool calls,
 * `tool_calls: []` beside content, a missing call id, `refusal` as the text, every
 * `finish_reason`, the reasoning members echoed as received and never shown, the argument
 * coercion and the `invalidArguments` envelope.
 */

import { z } from 'zod';

import {
  normaliseContent,
  normaliseText,
  parseArguments,
  parseMessage,
  triage,
  type ExchangeResult,
} from '@/ai/protocol';
import type { AiOutcome } from '@/rpc/types';

/* ------------------------------------------------------------------------ */
/* Recorded bodies (R3-evidence, 2026-10-22)                                  */
/* ------------------------------------------------------------------------ */

/** `ovh/b_gptoss_tools_r1.txt`: a tool call with `reasoning` and no `content` member. */
const OVH_GPTOSS_TOOLS = {
  id: 'chatcmpl-861602bd55553cf5',
  choices: [
    {
      index: 0,
      message: {
        role: 'assistant',
        reasoning: 'We need to call read_section for sections 1 and 2.',
        tool_calls: [
          {
            id: 'chatcmpl-tool-b565654a33bdfd02',
            type: 'function',
            function: { name: 'read_section', arguments: '{"section_number": 1}' },
          },
        ],
      },
      finish_reason: 'tool_calls',
    },
  ],
  created: 1792661922,
  model: 'gpt-oss-120b',
  object: 'chat.completion',
  usage: {
    prompt_tokens: 226,
    completion_tokens: 43,
    total_tokens: 269,
    completion_tokens_details: { reasoning_tokens: 0 },
  },
};

/** `kilo/tools_r1.txt`: parallel calls with `index`, text beside them, `refusal: null`. */
const KILO_PARALLEL = {
  id: 'gen-1792661535-dg8dLdHhteCrUQXW4B3v',
  object: 'chat.completion',
  created: 1792661535,
  model: 'minimax/minimax-m3.1-flash:free',
  provider: 'Minimax',
  system_fingerprint: null,
  service_tier: null,
  choices: [
    {
      index: 0,
      logprobs: null,
      finish_reason: 'tool_calls',
      native_finish_reason: 'tool_calls',
      message: {
        role: 'assistant',
        content: "I'll read both sections.",
        refusal: null,
        reasoning: null,
        tool_calls: [
          {
            type: 'function',
            index: 0,
            id: 'call_function_5y8z736x7zyo_1',
            function: { name: 'read_section', arguments: '{"section_number": 1}' },
          },
          {
            type: 'function',
            index: 1,
            id: 'call_function_5y8z736x7zyo_2',
            function: { name: 'read_section', arguments: '{"section_number": 2}' },
          },
        ],
      },
    },
  ],
  usage: { prompt_tokens: 588, completion_tokens: 55, total_tokens: 643, cost: 0, is_byok: false },
};

/** `llm7/tools_r1.txt`: `content: ""` beside a call, `reasoning`, `system_fingerprint: fp_ollama`. */
const LLM7_GPTOSS_TOOLS = {
  id: 'chatcmpl_949473ea2c3a40bc9f1a497a4d9a4716',
  object: 'chat.completion',
  created: 1792661543,
  model: 'gpt-oss:20b',
  system_fingerprint: 'fp_ollama',
  choices: [
    {
      index: 0,
      message: {
        role: 'assistant',
        content: '',
        reasoning: 'We need to read section 1 and section 2. Use read_section tool.',
        tool_calls: [
          {
            id: 'call_wydqp3wr',
            index: 0,
            type: 'function',
            function: { name: 'read_section', arguments: '{"section_number":1}' },
          },
        ],
      },
      finish_reason: 'tool_calls',
    },
  ],
  usage: { prompt_tokens: 239, completion_tokens: 42, total_tokens: 281 },
};

/** `llm7/minimax_tools_r1.txt`: `reasoning_content` (MiniMax), two calls, `content: ""`. */
const LLM7_MINIMAX_TOOLS = {
  choices: [
    {
      finish_reason: 'tool_calls',
      index: 0,
      message: {
        content: '',
        role: 'assistant',
        tool_calls: [
          {
            function: { arguments: '{"section_number": 1}', name: 'read_section' },
            id: 'chatcmpl-tool-bcb9d0a029a84335',
            type: 'function',
          },
          {
            function: { arguments: '{"section_number": 2}', name: 'read_section' },
            id: 'chatcmpl-tool-b78e1e9328a79d64',
            type: 'function',
          },
        ],
        reasoning_content:
          'The user wants me to read sections 1 and 2 of the book, then compare their lengths. Let me call both functions at once.\n',
      },
    },
  ],
  created: 1792661552,
  id: 'chatcmpl_a09fd1e5e056475a814030125288783e',
  model: 'minimax-m2.7',
  object: 'chat.completion',
  usage: { completion_tokens: 77, prompt_tokens: 320, total_tokens: 397 },
};

/** `kilo/maxtok30_minimax.txt`: `finish_reason: length`, `content: null`, `reasoning_details`. */
const KILO_LENGTH_NULL = {
  id: 'gen-1792661550-lo0FoXeWjiousfz9Fp7d',
  object: 'chat.completion',
  created: 1792661550,
  model: 'minimax/minimax-m3.1-flash:free',
  provider: 'Minimax',
  choices: [
    {
      index: 0,
      logprobs: null,
      finish_reason: 'length',
      native_finish_reason: 'length',
      message: {
        role: 'assistant',
        content: null,
        refusal: null,
        reasoning:
          'We need answer one paragraph. Need explain Rayleigh scattering, shorter wavelengths, violet vs blue nuances maybe sky blue because human eye sensitivity and violet absorption.',
        reasoning_details: [
          {
            type: 'reasoning.text',
            text: 'We need answer one paragraph. Need explain Rayleigh scattering, shorter wavelengths, violet vs blue nuances maybe sky blue because human eye sensitivity and violet absorption.',
            format: 'unknown',
            index: 0,
          },
        ],
      },
    },
  ],
  usage: { prompt_tokens: 212, completion_tokens: 30, total_tokens: 242 },
};

/** `ovh/maxtok30_gptoss.txt`: `finish_reason: length` with a `{role, reasoning}` message only. */
const OVH_LENGTH_REASONING_ONLY = {
  id: 'chatcmpl-b0178d79e8b218ea',
  choices: [
    {
      index: 0,
      message: {
        role: 'assistant',
        reasoning:
          "We need to answer in one paragraph, explain why sky is blue. Provide Rayleigh scattering, shorter wavelengths scatter more, sun's spectrum",
      },
      finish_reason: 'length',
    },
  ],
  created: 1792661566,
  model: 'gpt-oss-120b',
  object: 'chat.completion',
  usage: { prompt_tokens: 77, completion_tokens: 30, total_tokens: 107 },
};

/** `ovh/b_mistral_tools_r2.txt`: the final text with `tool_calls: []` beside it. */
const OVH_MISTRAL_FINAL = {
  id: 'chatcmpl-87255508e69fa5c7',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: 'Section 2 is longer.', tool_calls: [] },
      finish_reason: 'stop',
    },
  ],
  created: 1792661978,
  model: 'Mistral-Small-3.2-24B-Instruct-2506',
  object: 'chat.completion',
  usage: { prompt_tokens: 349, completion_tokens: 7, total_tokens: 356 },
};

/** `ovh/b_gptoss_tools_r3.txt`: the final text with `reasoning` beside it. */
const OVH_GPTOSS_FINAL = {
  id: 'chatcmpl-9161ffbf6ce72776',
  choices: [
    {
      index: 0,
      message: {
        role: 'assistant',
        content: 'Section 2 is longer.',
        reasoning:
          'We need to compare lengths. Section 1 text: "Утро было тихим." That\'s 16 characters? Let\'s count words: 3 words. Section 2: longer sentence. So section 2 is longer. Provide answer in one sentence.',
      },
      finish_reason: 'stop',
    },
  ],
  created: 1792662040,
  model: 'gpt-oss-120b',
  object: 'chat.completion',
};

/** `ovh/b_llama_tools_r1.txt`: Llama 3.3 gives the integer argument as a string. */
const OVH_LLAMA_STRING_ARGS = {
  id: 'chatcmpl-98f9c2d2b959504c',
  choices: [
    {
      index: 0,
      message: {
        role: 'assistant',
        tool_calls: [
          {
            id: 'chatcmpl-tool-b2d26de9b42b1ed6',
            type: 'function',
            function: { name: 'read_section', arguments: '{"section_number": "1"}' },
          },
        ],
      },
      finish_reason: 'tool_calls',
    },
  ],
  created: 1792661928,
  model: 'Meta-Llama-3_3-70B-Instruct',
  object: 'chat.completion',
};

/** `kilo/b_reasoning_tools_r1.txt`: a service failure delivered with HTTP 200. */
const KILO_200_ERROR = {
  id: 'gen-1792661691-W5NPmX9GnmJc3FGszFug',
  error: {
    message:
      'Upstream error from Nvidia: ResourceExhausted: Worker local total request limit reached (17/16)',
    code: 502,
    metadata: { error_type: 'provider_unavailable' },
  },
};

function ok(body: unknown, extra: Partial<Extract<AiOutcome, { ok: true }>> = {}): AiOutcome {
  return { ok: true, status: 200, body, elapsedMs: 1234, ...extra };
}

/** A chat completion around one message (synthetic shapes of the contract). */
function completion(message: Record<string, unknown>, finishReason?: string): AiOutcome {
  const choice: Record<string, unknown> = { index: 0, message };
  if (finishReason !== undefined) choice.finish_reason = finishReason;
  return ok({ id: 'chatcmpl-x', object: 'chat.completion', choices: [choice] });
}

function answer(result: ExchangeResult): Extract<ExchangeResult, { kind: 'answer' }> {
  if (result.kind !== 'answer') throw new Error(`expected an answer, got ${result.kind}`);
  return result;
}

/* ------------------------------------------------------------------------ */
/* §3.1 triage                                                               */
/* ------------------------------------------------------------------------ */

describe('triage - a chat completion (§3.1 row 1, §3.2)', () => {
  it('OVH gpt-oss: a tool call without a content member', () => {
    const result = answer(triage(ok(OVH_GPTOSS_TOOLS)));
    expect(result.finishReason).toBe('tool_calls');
    expect(result.action).toBe('tools');
    expect(result.message.text).toBe('');
    expect(result.message.toolCalls).toHaveLength(1);
    expect(result.message.toolCalls[0]).toMatchObject({
      id: 'chatcmpl-tool-b565654a33bdfd02',
      name: 'read_section',
      arguments: '{"section_number": 1}',
      suppliedId: false,
    });
  });

  it('Kilo minimax: text beside parallel calls, ids and order kept', () => {
    const result = answer(triage(ok(KILO_PARALLEL)));
    expect(result.action).toBe('tools');
    expect(result.message.text).toBe("I'll read both sections.");
    expect(result.message.toolCalls.map((call) => call.id)).toEqual([
      'call_function_5y8z736x7zyo_1',
      'call_function_5y8z736x7zyo_2',
    ]);
    expect(result.message.toolCalls.map((call) => call.arguments)).toEqual([
      '{"section_number": 1}',
      '{"section_number": 2}',
    ]);
  });

  it('LLM7: content "" beside a call (gpt-oss) and reasoning_content (MiniMax)', () => {
    const gptoss = answer(triage(ok(LLM7_GPTOSS_TOOLS)));
    expect(gptoss.action).toBe('tools');
    expect(gptoss.message.text).toBe('');
    expect(gptoss.message.toolCalls[0]!.id).toBe('call_wydqp3wr');

    const minimax = answer(triage(ok(LLM7_MINIMAX_TOOLS)));
    expect(minimax.action).toBe('tools');
    expect(minimax.message.text).toBe('');
    expect(minimax.message.toolCalls).toHaveLength(2);
  });

  it('a final text with tool_calls: [] beside it is the text (OVH Mistral, Pollinations)', () => {
    const result = answer(triage(ok(OVH_MISTRAL_FINAL)));
    expect(result.finishReason).toBe('stop');
    expect(result.action).toBe('text');
    expect(result.message.text).toBe('Section 2 is longer.');
    expect(result.message.toolCalls).toEqual([]);
  });

  it('a final text with reasoning beside it shows the text only', () => {
    const result = answer(triage(ok(OVH_GPTOSS_FINAL)));
    expect(result.action).toBe('text');
    expect(result.message.text).toBe('Section 2 is longer.');
    expect(JSON.stringify(result.message.text)).not.toContain('compare lengths');
  });

  it('content as a parts array is joined (local servers)', () => {
    const result = answer(
      triage(
        completion(
          {
            role: 'assistant',
            content: [
              { type: 'text', text: 'Hello' },
              { type: 'image_url', image_url: { url: 'x' } },
              { type: 'text', text: ' world' },
            ],
          },
          'stop',
        ),
      ),
    );
    expect(result.message.text).toBe('Hello world');
    expect(result.action).toBe('text');
  });

  it('content null / absent is "" and refusal is the text when content is empty', () => {
    const nullContent = answer(triage(completion({ role: 'assistant', content: null }, 'stop')));
    expect(nullContent.message.text).toBe('');
    expect(nullContent.message.refusal).toBe(false);

    const refused = answer(
      triage(
        completion(
          { role: 'assistant', content: null, refusal: "I can't help with that request." },
          'stop',
        ),
      ),
    );
    expect(refused.message.text).toBe("I can't help with that request.");
    expect(refused.message.refusal).toBe(true);

    const both = answer(
      triage(completion({ role: 'assistant', content: 'The answer.', refusal: 'No.' }, 'stop')),
    );
    expect(both.message.text).toBe('The answer.');
    expect(both.message.refusal).toBe(false);
  });

  it('a missing call id becomes mfbe_call_<exchange>_<n>, used in the echo too', () => {
    const outcome = completion(
      {
        role: 'assistant',
        tool_calls: [
          { type: 'function', function: { name: 'get_outline', arguments: '{}' } },
          { id: 'call_given', type: 'function', function: { name: 'read_part', arguments: '{}' } },
          { id: '', type: 'function', function: { name: 'find', arguments: '{"query":"a"}' } },
        ],
      },
      'tool_calls',
    );
    const result = answer(triage(outcome, 3));
    expect(result.message.toolCalls.map((call) => call.id)).toEqual([
      'mfbe_call_3_1',
      'call_given',
      'mfbe_call_3_3',
    ]);
    expect(result.message.toolCalls.map((call) => call.suppliedId)).toEqual([true, false, true]);
    const echoed = result.message.echo.tool_calls as { id: string }[];
    expect(echoed.map((call) => call.id)).toEqual(['mfbe_call_3_1', 'call_given', 'mfbe_call_3_3']);
    // the default exchange index is 1
    expect(answer(triage(outcome)).message.toolCalls[0]!.id).toBe('mfbe_call_1_1');
  });

  it('a call whose type is not function carries an invalidArguments problem', () => {
    const result = answer(
      triage(
        completion(
          {
            role: 'assistant',
            tool_calls: [
              { id: 'c1', type: 'retrieval', function: { name: 'read_part', arguments: '{}' } },
              { id: 'c2', function: { name: 'read_part', arguments: '{}' } },
              { id: 'c3', type: 'function' },
            ],
          },
          'tool_calls',
        ),
      ),
    );
    const [odd, untyped, nameless] = result.message.toolCalls;
    expect(odd!.problem).toMatchObject({ code: 'invalidArguments' });
    expect(odd!.problem!.message).toMatch(/unsupported tool call type/);
    expect(untyped!.problem).toBeUndefined(); // an absent type is read as `function`
    expect(untyped!.type).toBe('function');
    expect(nameless!.problem).toMatchObject({ code: 'invalidArguments' });
    expect(nameless!.name).toBe('');
  });

  it('the text is normalised: BOM and surrounding whitespace removed, nbsp kept (§3.5)', () => {
    const result = answer(
      triage(
        completion(
          { role: 'assistant', content: '\uFEFF  Section\u202F2 is longer.\u00A0\n' },
          'stop',
        ),
      ),
    );
    expect(result.message.text).toBe('Section\u202F2 is longer.\u00A0');
    expect(normaliseText('\uFEFF\n\t text \r\n')).toBe('text');
  });
});

describe('triage - finish_reason (§3.3)', () => {
  it('stop with tool calls present is treated as tool_calls', () => {
    const result = answer(
      triage(
        completion(
          {
            role: 'assistant',
            content: null,
            tool_calls: [
              { id: 'c1', type: 'function', function: { name: 'find', arguments: '{}' } },
            ],
          },
          'stop',
        ),
      ),
    );
    expect(result.finishReason).toBe('stop');
    expect(result.action).toBe('tools');
    expect(result.knownFinishReason).toBe(true);
  });

  it('length without tool calls is a cut-off text, never applied', () => {
    const kilo = answer(triage(ok(KILO_LENGTH_NULL)));
    expect(kilo.finishReason).toBe('length');
    expect(kilo.action).toBe('cutOff');
    expect(kilo.message.text).toBe('');
    expect(kilo.message.toolCalls).toEqual([]);

    const ovh = answer(triage(ok(OVH_LENGTH_REASONING_ONLY)));
    expect(ovh.action).toBe('cutOff');
    expect(ovh.message.text).toBe('');

    const partial = answer(
      triage(completion({ role: 'assistant', content: 'The sky is blue because' }, 'length')),
    );
    expect(partial.action).toBe('cutOff');
    expect(partial.message.text).toBe('The sky is blue because');
  });

  it('length with tool calls is truncated: the calls are not to be executed', () => {
    const result = answer(
      triage(
        completion(
          {
            role: 'assistant',
            tool_calls: [
              {
                id: 'c1',
                type: 'function',
                function: { name: 'replace_node', arguments: '{"node":"n4","xml":"<p>Hal' },
              },
            ],
          },
          'length',
        ),
      ),
    );
    expect(result.action).toBe('truncated');
    expect(result.message.toolCalls).toHaveLength(1);
  });

  it('content_filter is a contentFilter failure with the service wording when present', () => {
    const worded = triage(
      completion(
        { role: 'assistant', content: 'This request violates the usage policy.' },
        'content_filter',
      ),
    );
    expect(worded).toEqual({
      kind: 'contentFilter',
      message: 'This request violates the usage policy.',
      status: 200,
    });
    const silent = triage(completion({ role: 'assistant', content: null }, 'content_filter'));
    expect(silent).toMatchObject({ kind: 'contentFilter', message: '' });
  });

  it('an unknown or absent finish_reason follows the presence of tool calls and is recorded', () => {
    const unknownText = answer(triage(completion({ role: 'assistant', content: 'Done.' }, 'eos')));
    expect(unknownText.action).toBe('text');
    expect(unknownText.finishReason).toBe('eos');
    expect(unknownText.knownFinishReason).toBe(false);

    const unknownTools = answer(
      triage(
        completion(
          {
            role: 'assistant',
            tool_calls: [
              { id: 'c1', type: 'function', function: { name: 'find', arguments: '{}' } },
            ],
          },
          'eos',
        ),
      ),
    );
    expect(unknownTools.action).toBe('tools');

    const absent = answer(triage(completion({ role: 'assistant', content: 'Done.' })));
    expect(absent.action).toBe('text');
    expect(absent.finishReason).toBe('');
    expect(absent.knownFinishReason).toBe(false);
  });

  it('tool_calls as finish_reason without any call is a text', () => {
    const result = answer(
      triage(completion({ role: 'assistant', content: 'Nothing to run.' }, 'tool_calls')),
    );
    expect(result.action).toBe('text');
  });
});

describe('triage - the echo (§2.3, review D3)', () => {
  it('keeps the message as received with content normalised to "" when absent', () => {
    const result = answer(triage(ok(OVH_GPTOSS_TOOLS)));
    expect(result.message.echo).toEqual({
      role: 'assistant',
      content: '',
      reasoning: 'We need to call read_section for sections 1 and 2.',
      tool_calls: [
        {
          id: 'chatcmpl-tool-b565654a33bdfd02',
          type: 'function',
          function: { name: 'read_section', arguments: '{"section_number": 1}' },
        },
      ],
    });
  });

  it('keeps null content, refusal, index and every reasoning member untouched', () => {
    const kilo = answer(triage(ok(KILO_PARALLEL)));
    expect(kilo.message.echo).toEqual(KILO_PARALLEL.choices[0]!.message);
    expect(kilo.message.echo).not.toBe(KILO_PARALLEL.choices[0]!.message); // a copy, not the body

    const length = answer(triage(ok(KILO_LENGTH_NULL)));
    expect(length.message.echo.content).toBeNull();
    expect(length.message.echo.reasoning_details).toEqual(
      KILO_LENGTH_NULL.choices[0]!.message.reasoning_details,
    );

    const minimax = answer(triage(ok(LLM7_MINIMAX_TOOLS)));
    expect(minimax.message.echo.reasoning_content).toBe(
      LLM7_MINIMAX_TOOLS.choices[0]!.message.reasoning_content,
    );
  });

  it('keeps a parts array as received and supplies the role when missing', () => {
    const parts = [{ type: 'text', text: 'Hi' }];
    const result = answer(triage(completion({ content: parts }, 'stop')));
    expect(result.message.echo).toEqual({ role: 'assistant', content: parts });
  });
});

describe('triage - the other rows of §3.1', () => {
  it('HTTP 200 with error and no choices is a failure with status 200 and error.code', () => {
    const result = triage(ok(KILO_200_ERROR));
    expect(result).toEqual({
      kind: 'service',
      status: 200,
      serviceCode: 502,
      message:
        'Upstream error from Nvidia: ResourceExhausted: Worker local total request limit reached (17/16)',
    });
  });

  it('a 200 whose error code is 429 or 402 is a limit', () => {
    const result = triage(ok({ error: { message: 'Too many requests upstream', code: 429 } }));
    expect(result).toMatchObject({
      kind: 'limit',
      status: 200,
      serviceCode: 429,
      waitSeconds: 30,
      waitSource: 'default',
    });
    const quota = triage(ok({ error: { message: 'Free quota exhausted', code: '402' } }));
    expect(quota).toMatchObject({ kind: 'limit', status: 200 });
  });

  it('a 200 with a key-related code is an auth failure with the settings link', () => {
    const result = triage(
      ok({ error: { message: 'Your authentication token is invalid.', code: 'INVALID_TOKEN' } }),
    );
    expect(result).toMatchObject({
      kind: 'auth',
      status: 200,
      serviceCode: 'INVALID_TOKEN',
      settingsLink: true,
    });
  });

  it('anything else is a format failure with the first 300 characters of the JSON', () => {
    const empty = triage(ok({ id: 'x', object: 'chat.completion', choices: [] }));
    expect(empty).toMatchObject({ kind: 'format', status: 200 });
    expect((empty as { message: string }).message).toBe(
      JSON.stringify({ id: 'x', object: 'chat.completion', choices: [] }),
    );

    const missing = triage(ok({ id: 'x', object: 'chat.completion' }));
    expect(missing.kind).toBe('format');

    const scalar = triage(ok('OK'));
    expect(scalar).toMatchObject({ kind: 'format', message: '"OK"' });

    const array = triage(ok([1, 2, 3]));
    expect(array.kind).toBe('format');

    const long = triage(ok({ data: 'x'.repeat(1000) }));
    expect((long as { message: string }).message.length).toBeLessThanOrEqual(300);

    const noMessage = triage(ok({ choices: [{ index: 0, finish_reason: 'stop' }] }));
    expect(noMessage.kind).toBe('format');
  });

  it('the transport kinds pass through with the transport message', () => {
    const kinds = ['offline', 'timeout', 'tls', 'cancelled'] as const;
    for (const kind of kinds) {
      const result = triage({ ok: false, kind, message: `curl: ${kind}`, elapsedMs: 5 });
      expect(result).toEqual({ kind, message: `curl: ${kind}` });
    }
    const format = triage({
      ok: false,
      kind: 'format',
      status: 200,
      message: 'not JSON',
      text: '<html>',
      elapsedMs: 5,
    });
    expect(format).toMatchObject({ kind: 'format', message: 'not JSON', status: 200 });
    const silent = triage({ ok: false, kind: 'offline', elapsedMs: 5 });
    expect(silent).toEqual({ kind: 'offline', message: '' });
  });

  it('an http outcome goes through the error rules (details in errors.test.ts)', () => {
    const result = triage({
      ok: false,
      kind: 'http',
      status: 404,
      body: {
        error: {
          code: 'model_not_found',
          message: 'The model `no-such-model-xyz` does not exist.',
          param: null,
          type: 'invalid_request_error',
        },
      },
      elapsedMs: 206,
    });
    expect(result).toEqual({
      kind: 'model',
      status: 404,
      serviceCode: 'model_not_found',
      message: 'The model `no-such-model-xyz` does not exist.',
      settingsLink: true,
    });
  });
});

/* ------------------------------------------------------------------------ */
/* parseMessage and normaliseContent                                         */
/* ------------------------------------------------------------------------ */

describe('parseMessage', () => {
  it('tolerates a message that is not an object', () => {
    const result = parseMessage(null);
    expect(result.text).toBe('');
    expect(result.toolCalls).toEqual([]);
    expect(result.echo).toEqual({ role: 'assistant', content: '' });
  });

  it('skips tool_calls entries that are not objects and a tool_calls member that is not an array', () => {
    const skipped = parseMessage({
      role: 'assistant',
      tool_calls: [
        'bogus',
        null,
        { id: 'c1', type: 'function', function: { name: 'find', arguments: '{}' } },
      ],
    });
    expect(skipped.toolCalls.map((call) => call.id)).toEqual(['c1']);
    expect(skipped.toolCalls[0]!.index).toBe(2);
    const notArray = parseMessage({ role: 'assistant', content: 'x', tool_calls: 'none' });
    expect(notArray.toolCalls).toEqual([]);
    expect(notArray.text).toBe('x');
  });

  it('normaliseContent covers every observed form', () => {
    expect(normaliseContent(undefined)).toBe('');
    expect(normaliseContent(null)).toBe('');
    expect(normaliseContent('')).toBe('');
    expect(normaliseContent('text')).toBe('text');
    expect(normaliseContent([{ type: 'text', text: 'a' }, 'b', { type: 'text', text: 'c' }])).toBe(
      'abc',
    );
    expect(normaliseContent([{ type: 'text' }, { text: 7 }])).toBe('');
    expect(normaliseContent(42)).toBe('');
    expect(normaliseContent({ text: 'object' })).toBe('');
  });
});

/* ------------------------------------------------------------------------ */
/* §3.4 tool-call arguments                                                  */
/* ------------------------------------------------------------------------ */

describe('parseArguments (§3.4, ai-catalogue §1.6)', () => {
  const schema = z.object({
    section_number: z.coerce.number().int().min(1),
    whole: z.union([z.stringbool(), z.boolean()]).optional(),
    format: z.enum(['text', 'fb2xml']).optional(),
  });

  it('coerces numeric strings and boolean words through the zod schema', () => {
    const llama = parseMessage(OVH_LLAMA_STRING_ARGS.choices[0]!.message).toolCalls[0]!;
    const parsed = parseArguments(llama.arguments, { schema });
    expect(parsed).toEqual({ ok: true, value: { section_number: 1 } });

    const words = parseArguments('{"section_number": "2", "whole": "true", "extra": 1}', {
      schema,
    });
    expect(words).toEqual({ ok: true, value: { section_number: 2, whole: true } }); // unknown members dropped

    const falsy = parseArguments('{"section_number": 3, "whole": "false"}', { schema });
    expect(falsy).toEqual({ ok: true, value: { section_number: 3, whole: false } });
  });

  it('accepts an object as already parsed and an absent member as {}', () => {
    expect(parseArguments({ section_number: 4 }, { schema })).toEqual({
      ok: true,
      value: { section_number: 4 },
    });
    expect(parseArguments(undefined)).toEqual({ ok: true, value: {} });
    expect(parseArguments('')).toEqual({ ok: true, value: {} });
    expect(parseArguments('{"a": 1}')).toEqual({ ok: true, value: { a: 1 } });
  });

  it('invalid JSON is an invalidArguments envelope with the parser message and the expected schema', () => {
    const truncated = parseArguments('{"section_number": 1', { schema });
    expect(truncated.ok).toBe(false);
    if (truncated.ok) return;
    expect(truncated.error.code).toBe('invalidArguments');
    expect(truncated.error.message).toMatch(/^arguments are not valid JSON: /);
    expect(truncated.error.expected).toMatchObject({ type: 'object' });
    expect(truncated.error.expected).not.toHaveProperty('$schema');

    const prose = parseArguments('Sure! {"section_number": 1}', { schema });
    expect(prose.ok).toBe(false);
    const quotes = parseArguments("{'section_number': 1}", { schema });
    expect(quotes.ok).toBe(false);
  });

  it('a non-object value is invalidArguments too', () => {
    for (const raw of ['42', '"text"', '[1, 2]', 'null', 7, true, [1]]) {
      const result = parseArguments(raw, { schema });
      expect(result.ok, String(raw)).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('invalidArguments');
    }
  });

  it('a missing required member or a wrong enum is invalidArguments with the zod message', () => {
    const missing = parseArguments('{}', { schema });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.error.message).toMatch(/section_number/);
      expect(missing.error.expected).toMatchObject({ required: ['section_number'] });
    }
    const wrongEnum = parseArguments('{"section_number": 1, "format": "html"}', { schema });
    expect(wrongEnum.ok).toBe(false);
    if (!wrongEnum.ok) expect(wrongEnum.error.message).toMatch(/format/);
    const notInt = parseArguments('{"section_number": "one"}', { schema });
    expect(notInt.ok).toBe(false);
  });

  it('an explicit expected schema wins over the derived one', () => {
    const expected = { type: 'object', properties: { x: { type: 'string' } } };
    const result = parseArguments('nope', { schema, expected });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.expected).toBe(expected);
  });
});

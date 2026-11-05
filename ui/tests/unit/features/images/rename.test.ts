/**
 * Feature 009, User Story 7 (T068): the id a binary may get, and the whole-model rewrite of its
 * references (data-model §10).
 */
import { describe, expect, it } from 'vitest';

import { newIdProblem, renamedModel } from '@/features/images/rename';
import type { BinaryMeta, Document } from '@/model/document';

import { fakeDocument } from '../testUtils';

const META: BinaryMeta = {
  id: 'pic.png',
  contentType: 'image/png',
  size: 8,
  width: 8,
  height: 6,
  decodable: true,
  willConvert: false,
  referenceCount: 3,
};

function book(): Document {
  const base = fakeDocument();
  return {
    ...base,
    binaries: [META, { ...META, id: 'other.png' }],
    bodies: [
      {
        type: 'body',
        attrs: { nodeId: 'b1' },
        content: [
          {
            type: 'section',
            attrs: { nodeId: 's1', id: 'chapter' },
            content: [
              { type: 'image', attrs: { nodeId: 'i1', href: '#pic.png' } },
              {
                type: 'p',
                attrs: { nodeId: 'p1' },
                content: [
                  { type: 'inline-image', attrs: { href: '#pic.png' } },
                  {
                    type: 'text',
                    text: 'see',
                    marks: [{ type: 'link', attrs: { href: '#pic.png' } }],
                  },
                  {
                    type: 'text',
                    text: ' other',
                    marks: [{ type: 'link', attrs: { href: '#other.png' } }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ] as unknown as Document['bodies'],
    description: {
      ...base.description,
      titleInfo: {
        ...base.description.titleInfo,
        coverpage: [{ href: '#pic.png' }],
        annotation: [
          { type: 'p', content: [{ type: 'inline-image', attrs: { href: '#pic.png' } }] },
        ],
      },
    } as unknown as Document['description'],
  };
}

describe('the new id of a binary (data-model §10)', () => {
  it('is an XML NCName: a letter or _ first, then letters, digits, ".", "-" and "_"', () => {
    const model = book();
    expect(newIdProblem(model, 'pic.png', 'cover-2.v1_x')).toBeNull();
    expect(newIdProblem(model, 'pic.png', '_x')).toBeNull();
    expect(
      newIdProblem(model, 'pic.png', '\u0440\u0438\u0441\u0443\u043d\u043e\u043a.png'),
    ).toBeNull();
    for (const bad of ['1.jpg', '', 'a b', 'x:y', '-a', '.a', 'a/b']) {
      expect(newIdProblem(model, 'pic.png', bad), bad).toBe('descriptionForm.binaries.idInvalid');
    }
  });

  it('is unused by every id of the whole model, binaries included; its own id is fine', () => {
    const model = book();
    expect(newIdProblem(model, 'pic.png', 'other.png')).toBe('descriptionForm.binaries.idTaken');
    expect(newIdProblem(model, 'pic.png', 'chapter')).toBe('descriptionForm.binaries.idTaken');
    expect(newIdProblem(model, 'pic.png', 'pic.png')).toBeNull();
  });
});

describe('the rewrite of the references (data-model §10)', () => {
  it('rewrites pictures, inline pictures, links, the cover and the annotation, nothing else', () => {
    const renamed = renamedModel(book(), 'pic.png', 'new.png');
    const json = JSON.stringify(renamed);
    expect(json).not.toContain('#pic.png');
    expect(json.match(/#new\.png/g)?.length).toBe(5);
    expect(json).toContain('#other.png');
    expect(renamed.binaries.map((b) => b.id)).toEqual(['new.png', 'other.png']);
  });

  it('back again gives the model it started from', () => {
    const start = book();
    const back = renamedModel(renamedModel(start, 'pic.png', 'new.png'), 'new.png', 'pic.png');
    expect(back).toEqual(start);
  });
});

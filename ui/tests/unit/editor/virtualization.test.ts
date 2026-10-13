import { fb2Schema } from '@/editor/schema';
import {
  DEFAULT_WINDOW_SIZE,
  countSections,
  createWindow,
  extendWindow,
  isWholeBook,
  locateSection,
  modelSectionIndex,
  replaceSectionsInModel,
  totalSectionCount,
  windowAround,
} from '@/editor/virtualization';
import type { BodyNode, Document, SectionNode } from '@/model/document';

function section(id: number, bodyTag = 'b'): SectionNode {
  return {
    type: 'section',
    attrs: { nodeId: `${bodyTag}s${id}` },
    content: [
      {
        type: 'p',
        attrs: { nodeId: `${bodyTag}p${id}` },
        content: [{ type: 'text', text: `Section ${id}` }],
      },
    ],
  };
}

function body(sections: number, name?: string, tag = 'b'): BodyNode {
  const content: BodyNode['content'] = [
    {
      type: 'title',
      attrs: { nodeId: `${tag}title` },
      content: [
        { type: 'p', attrs: { nodeId: `${tag}tp` }, content: [{ type: 'text', text: 'Book' }] },
      ],
    },
  ];
  for (let i = 0; i < sections; i += 1) content.push(section(i, tag));
  return {
    type: 'body',
    attrs: name ? { nodeId: `${tag}body`, name } : { nodeId: `${tag}body` },
    content,
  };
}

function model(...bodies: BodyNode[]): Pick<Document, 'bodies'> {
  return { bodies };
}

describe('virtualization', () => {
  it('counts sections and detects whole-book mode', () => {
    const small = model(body(5), body(3, 'notes', 'n'));
    expect(countSections(small.bodies[0])).toBe(5);
    expect(totalSectionCount(small)).toBe(8);
    expect(isWholeBook(small)).toBe(true);
    expect(isWholeBook(model(body(2 * DEFAULT_WINDOW_SIZE)))).toBe(true);
    expect(isWholeBook(model(body(2 * DEFAULT_WINDOW_SIZE + 1)))).toBe(false);
    expect(isWholeBook(small, 2)).toBe(false);
  });

  it('whole-book mode mounts every body completely', () => {
    const m = model(body(3), body(2, 'notes', 'n'));
    const w = createWindow(m);
    expect(w.wholeBook).toBe(true);
    expect(w.doc.childCount).toBe(2);
    expect(w.doc.child(0).childCount).toBe(4); // title + 3 sections
    expect(w.doc.child(1).attrs.name).toBe('notes');
    expect(w.totalSections).toBe(5);
    expect(w.before).toBe(0);
    expect(w.after).toBe(0);
    expect(extendWindow(m, w, 'after')).toBe(w);
    expect(() => w.doc.check()).not.toThrow();
  });

  it('windowed mode mounts the body header plus the first N sections and extends', () => {
    const m = model(body(100), body(7, 'notes', 'n'));
    const w = createWindow(m, { windowSize: 10 });
    expect(w.wholeBook).toBe(false);
    expect(w).toMatchObject({
      bodyIndex: 0,
      start: 0,
      count: 10,
      totalSections: 100,
      before: 0,
      after: 90,
      bodyCount: 2,
    });
    expect(w.doc.childCount).toBe(1);
    const bodyNode = w.doc.child(0);
    expect(bodyNode.childCount).toBe(11); // title + 10 sections
    expect(bodyNode.child(0).type.name).toBe('title');
    expect(bodyNode.child(1).attrs.nodeId).toBe('bs0');
    expect(bodyNode.child(10).attrs.nodeId).toBe('bs9');

    const more = extendWindow(m, w, 'after', 10, { windowSize: 10 });
    expect(more).toMatchObject({ start: 0, count: 20, before: 0, after: 80 });
    const middle = createWindow(m, { windowSize: 10, start: 45, count: 10 });
    expect(middle).toMatchObject({ start: 45, count: 10, before: 45, after: 45 });
    expect(middle.doc.child(0).child(1).attrs.nodeId).toBe('bs45');
    // T069: growing beyond 3 x windowSize unmounts the far end (the DOM stays bounded).
    const earlier = extendWindow(m, middle, 'before', 50, { windowSize: 10 });
    expect(earlier).toMatchObject({ start: 0, count: 30, before: 0, after: 70 });
    const later = extendWindow(m, earlier, 'after', 10, { windowSize: 10 });
    expect(later).toMatchObject({ start: 10, count: 30, before: 10, after: 60 });
    // clamping at the end
    const tail = createWindow(m, { windowSize: 10, start: 95, count: 10 });
    expect(tail).toMatchObject({ start: 95, count: 5, after: 0 });
    // other body
    const notes = createWindow(m, { windowSize: 10, bodyIndex: 1 });
    expect(notes).toMatchObject({ bodyIndex: 1, count: 7, totalSections: 7 });
    expect(notes.doc.child(0).attrs.name).toBe('notes');
    expect(createWindow(m, { windowSize: 10, bodyIndex: 9 }).bodyIndex).toBe(1);
    expect(modelSectionIndex(middle, 2)).toBe(47);
    expect(modelSectionIndex(createWindow(model(body(2))), 1)).toBe(1);
  });

  it('handles descriptors without bodies and bodies without sections', () => {
    const empty = createWindow(model());
    expect(empty.wholeBook).toBe(true);
    expect(empty.doc.childCount).toBe(0);
    const forced = createWindow(model(), { forceWindowed: true });
    expect(forced.doc.childCount).toBe(0);
    expect(forced.bodyCount).toBe(0);
    const noSections: BodyNode = { type: 'body', attrs: { nodeId: 'b' }, content: [] };
    const w = createWindow(model(noSections), { forceWindowed: true });
    expect(w.count).toBe(0);
    expect(w.doc.child(0).childCount).toBe(0);
    expect(w.report.problems.length).toBeGreaterThan(0); // body without sections is reported
  });

  it('locates sections by nodeId and centres a window on them', () => {
    const m = model(body(100), body(7, 'notes', 'n'));
    expect(locateSection(m, 'bp42')).toEqual({ bodyIndex: 0, sectionIndex: 42 });
    expect(locateSection(m, 'ns3')).toEqual({ bodyIndex: 1, sectionIndex: 3 });
    expect(locateSection(m, 'btitle')).toEqual({ bodyIndex: 0, sectionIndex: 0 });
    expect(locateSection(m, 'nbody')).toEqual({ bodyIndex: 1, sectionIndex: 0 });
    expect(locateSection(m, 'nope')).toBeNull();
    const w = windowAround(m, 'bp42', { windowSize: 10 });
    expect(w).toMatchObject({ bodyIndex: 0, start: 37, count: 10 });
    expect(windowAround(m, 'nope')).toBeNull();
    expect(windowAround(m, 'ns3', { windowSize: 10 })).toMatchObject({
      bodyIndex: 1,
      start: 0,
      count: 7,
    });
  });

  it('writes an edited window back into the model (windowed and whole-book)', () => {
    const m = model(body(50), body(2, 'notes', 'n'));
    const w = createWindow(m, { windowSize: 10, start: 10, count: 10 });
    // Edit: replace the text of the first mounted section's paragraph and drop the last section.
    const bodyNode = w.doc.child(0);
    const children: ReturnType<typeof bodyNode.child>[] = [];
    bodyNode.forEach((child) => children.push(child));
    const edited = [...children];
    edited[1] = fb2Schema.nodes.section!.create(children[1]!.attrs, [
      fb2Schema.nodes.p!.create({ nodeId: 'bp10' }, fb2Schema.text('Edited')),
    ]);
    edited.pop();
    const newDoc = fb2Schema.nodes.doc!.create(null, [
      fb2Schema.nodes.body!.create({ ...bodyNode.attrs, lang: 'ru' }, edited),
    ]);
    const result = replaceSectionsInModel(m, w, newDoc);
    const sections = result.model.bodies[0]!.content.filter((c) => c.type === 'section');
    expect(sections).toHaveLength(49);
    expect(result.model.bodies[0]!.attrs).toEqual({ nodeId: 'bbody', lang: 'ru' });
    expect(result.model.bodies[0]!.content[0]!.type).toBe('title');
    expect(sections[9]!.attrs.nodeId).toBe('bs9');
    expect((sections[10] as SectionNode).content[0]).toMatchObject({
      type: 'p',
      content: [{ type: 'text', text: 'Edited' }],
    });
    expect(sections[19]!.attrs.nodeId).toBe('bs20'); // bs19 was removed
    expect(result.model.bodies[1]).toBe(m.bodies[1]); // untouched body keeps its identity
    expect(result.window).toMatchObject({
      start: 10,
      count: 9,
      totalSections: 49,
      before: 10,
      after: 30,
    });
    expect(result.window.doc).toBe(newDoc);

    const small = model(body(2), body(1, 'notes', 'n'));
    const whole = createWindow(small);
    const onlyMain = fb2Schema.nodes.doc!.create(null, [whole.doc.child(0)]);
    const back = replaceSectionsInModel(small, whole, onlyMain);
    expect(back.model.bodies).toHaveLength(1);
    expect(back.window).toMatchObject({
      wholeBook: true,
      count: 2,
      totalSections: 2,
      bodyCount: 1,
    });
  });
});

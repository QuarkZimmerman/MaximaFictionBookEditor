// Structural edits: insert, replace and remove nodes; read parents and children.
// Capabilities: doc.getNode, doc.insertNode, doc.replaceNode, doc.removeNode, doc.parentOf,
//               doc.childrenOf, selection.selectNode, selection.scrollIntoView.
export default async function run() {
  const [section] = await mfbe.doc.getElementsByTagName('section');
  const children = await mfbe.doc.childrenOf(section);
  // Append a subtitle and a paragraph to the first section.
  const subtitle = await mfbe.doc.insertNode('append', section, {
    type: 'subtitle', attrs: {}, content: [{ type: 'text', text: '* * *' }],
  });
  const paragraph = await mfbe.doc.insertNode('after', subtitle, {
    type: 'p', attrs: {},
    content: [
      { type: 'text', text: 'Added with ' },
      { type: 'text', text: 'emphasis', marks: [{ type: 'emphasis' }] },
      { type: 'text', text: ' by a script.' },
    ],
  });
  // Turn the last original child into a plain paragraph if it is a subtitle.
  const last = children[children.length - 1];
  const node = await mfbe.doc.getNode(last);
  if (node.type === 'subtitle') {
    await mfbe.doc.replaceNode(last, { ...node, type: 'p' });
  }
  // Remove empty paragraphs of this section.
  for (const child of await mfbe.doc.childrenOf(section)) {
    if (child.type === 'p' && (await mfbe.doc.textOf(child)).trim() === '') {
      await mfbe.doc.removeNode(child);
    }
  }
  const parent = await mfbe.doc.parentOf(paragraph); // the section
  await mfbe.selection.selectNode(paragraph);
  await mfbe.selection.scrollIntoView();
  await mfbe.ui.status(`Edited ${parent.type} ${parent.nodeId}`);
}

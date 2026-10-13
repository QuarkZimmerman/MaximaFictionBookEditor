// Tree command: receives the node the user right-clicked in the Document Tree.
export default async function run(ctx) {
  const node = ctx.treeNode;
  if (!node) {
    await mfbe.ui.message('No tree node was passed.', { icon: 'warning' });
    return;
  }
  const target = node.type === 'section' ? node : await mfbe.doc.parentOf(node);
  if (!target) return;
  await mfbe.doc.insertNode('append', target, {
    type: 'p', attrs: {}, content: [{ type: 'text', text: `[tree] ${node.type} ${node.nodeId}` }],
  });
}

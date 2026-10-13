// A "tree" script (kind: "tree" in script.json): offered in the Document Tree context menu
// and started with the node the user right-clicked in ctx.treeNode.
// Capabilities: ctx.treeNode, doc.getNode, doc.setDescription, doc.textOf.
export default async function run(ctx) {
  const node = ctx.treeNode;
  if (!node) {
    await mfbe.ui.message('Run this command from the Document Tree.', { icon: 'warning' });
    return;
  }
  if (node.type !== 'section') {
    await mfbe.ui.message(`Select a section (got ${node.type}).`);
    return;
  }
  // Use the section's title as the book title in the description.
  const section = await mfbe.doc.getNode(node);
  const title = section.content.find((child) => child.type === 'title');
  if (!title) {
    await mfbe.ui.message('This section has no title.');
    return;
  }
  const text = await mfbe.doc.textOf(title.attrs.nodeId);
  const document = await mfbe.doc.get();
  const description = document.description;
  description.titleInfo.bookTitle = text.split('\n')[0];
  await mfbe.doc.setDescription(description);
  await mfbe.ui.status(`Book title set to "${description.titleInfo.bookTitle}"`, { sticky: true });
}

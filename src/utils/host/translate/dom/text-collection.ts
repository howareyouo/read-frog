/**
 * The Text-node walk shared by the translation pipeline's three collectors —
 * the host-text staleness baseline (collectHostText), the translationOnly run
 * aggregate (collectRunText) and the swap planner's node collection
 * (collectTextNodes): depth-first in document order, `visitText` receives
 * every Text node, and `descendInto` gates recursion so each caller prunes
 * exactly the subtrees it always pruned (extension wrappers, non-elements).
 */
export type TextNodeVisitor = (text: Text) => void

export function walkTextNodes(
  node: Node,
  descendInto: (node: Node) => boolean,
  visitText: TextNodeVisitor,
): void {
  if (node.nodeType === Node.TEXT_NODE) {
    visitText(node as Text)
    return
  }
  if (!descendInto(node)) return
  for (const child of node.childNodes) walkTextNodes(child, descendInto, visitText)
}

/**
 * The same walk rooted at `root`'s children only: the root itself is neither
 * visited nor gated (collectHostText must read a layout source's whole text
 * without testing the source against wrapper predicates).
 */
export function walkRootChildTextNodes(
  root: Node,
  descendInto: (node: Node) => boolean,
  visitText: TextNodeVisitor,
): void {
  for (const child of root.childNodes) walkTextNodes(child, descendInto, visitText)
}

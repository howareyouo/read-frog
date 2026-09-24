export function getOwnerDocument(node: Node): Document {
  return node.ownerDocument || document
}

export function getContainingShadowRoot(node: Node): ShadowRoot | null {
  const root = node.getRootNode()
  return root instanceof ShadowRoot ? root : null
}

/**
 * Index of `node` among `parent.childNodes` without materializing a throwaway
 * array via `[...childNodes].indexOf(node)`.
 */
export function childNodeIndexOf(parent: Node, node: Node): number {
  const childNodes = parent.childNodes
  for (let i = 0; i < childNodes.length; i += 1) {
    if (childNodes[i] === node) return i
  }
  return -1
}

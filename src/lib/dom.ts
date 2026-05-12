export function mustQuery<T extends Element = Element>(parent: ParentNode, selector: string) {
  const element = parent.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing element: ${selector}`);
  }
  return element;
}

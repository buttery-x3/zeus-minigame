export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function labeledControl(label: string, control: HTMLElement) {
  const wrapper = element("label", "field");
  wrapper.append(element("span", "field-label", label), control);
  return wrapper;
}

export function clear(node: HTMLElement) {
  node.replaceChildren();
}

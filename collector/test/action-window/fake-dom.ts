/**
 * **A fake DOM with a real tree**, shared by the in-page census tests.
 *
 * No jsdom: jsdom has no layout, so every element would read as not painting and every case would pass for the
 * wrong reason. This one has boxes, open shadow roots, and a selector grammar that **throws** on anything it
 * cannot express — a fake that silently answers "no elements" is the shape of a green test over a broken rule.
 *
 * It lives here rather than inside one test file because a second copy is how two probes end up being checked
 * against two different fakes, and then against two different ideas of what the page can do.
 */

export interface ElInit {
  tag: string;
  text?: string;
  attrs?: Record<string, string>;
  display?: string;
  rects?: number;
  /** Where this element paints. A column probe resolves a column geometrically, so this is load-bearing. */
  box?: { left: number; top: number; width: number; height: number };
}

/** A shadow root: queryable like a document, and reachable back to its host — which is how the walk crosses. */
export class ShadowRoot {
  readonly children: El[] = [];
  constructor(readonly host: El) {}
  add(...kids: El[]): this {
    for (const k of kids) {
      k.parent = null;
      k.shadowParent = this;
      this.children.push(k);
    }
    return this;
  }
  descendants(): El[] {
    return this.children.flatMap((c) => [c, ...c.descendants()]);
  }
  querySelectorAll(sel: string): El[] {
    return select(this.descendants(), sel);
  }
}

export class El {
  readonly tagName: string;
  readonly children: El[] = [];
  parent: El | null = null;
  shadowParent: ShadowRoot | null = null;
  shadowRoot: ShadowRoot | null = null;
  private readonly ownText: string;
  private readonly display: string;
  private readonly rects: number;
  private readonly box: { left: number; top: number; width: number; height: number };
  readonly attributes: { name: string; value: string }[];

  constructor(init: ElInit) {
    this.tagName = init.tag.toUpperCase();
    this.ownText = init.text ?? "";
    this.display = init.display ?? "block";
    this.rects = init.rects ?? 1;
    this.box = init.box ?? { left: 0, top: 0, width: 100, height: 20 };
    this.attributes = Object.entries(init.attrs ?? {}).map(([name, value]) => ({ name, value }));
  }

  add(...kids: El[]): this {
    for (const k of kids) {
      k.parent = this;
      this.children.push(k);
    }
    return this;
  }

  get textContent(): string {
    return this.ownText + this.children.map((c) => c.textContent).join("");
  }
  /** Attaches an open shadow root and returns THIS, so a fixture reads like the markup it stands for. */
  attachShadow(...kids: El[]): this {
    this.shadowRoot = new ShadowRoot(this);
    this.shadowRoot.add(...kids);
    return this;
  }
  get parentElement(): El | null {
    return this.parent;
  }
  /** DOM semantics: a shadow child's `parentNode` is the root, whose `host` is the element it hangs off. */
  get parentNode(): El | ShadowRoot | null {
    return this.parent ?? this.shadowParent;
  }
  get childElementCount(): number {
    return this.children.length;
  }
  /** Light-DOM descendants only — a document query does NOT cross into a shadow root, which is the whole point. */
  descendants(): El[] {
    return this.children.flatMap((c) => [c, ...c.descendants()]);
  }
  ancestors(): El[] {
    return this.parent ? [this.parent, ...this.parent.ancestors()] : [];
  }
  /** DOM semantics: an element contains itself. The innermost-match rule relies on it. */
  contains(other: El): boolean {
    return other === this || this.descendants().includes(other);
  }
  querySelectorAll(sel: string): El[] {
    return select(this.descendants(), sel);
  }
  hasAttribute(name: string): boolean {
    return this.attributes.some((a) => a.name === name);
  }
  getAttribute(name: string): string | null {
    return this.attributes.find((a) => a.name === name)?.value ?? null;
  }
  computedStyle(): { display: string; visibility: string } {
    return { display: this.display, visibility: this.display === "hidden" ? "hidden" : "visible" };
  }
  getClientRects(): unknown[] {
    return new Array(this.rects).fill({});
  }
  getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
    return this.box;
  }
}

/**
 * Enough selector grammar for the probes: comma lists, `*`, `[attr]`, `TAG[attr]`, and one level of descendant.
 * Anything unrecognised throws rather than returning nothing.
 */
export function select(els: El[], sel: string): El[] {
  const out: El[] = [];
  for (const part of sel.split(",").map((s) => s.trim())) {
    if (part === "*") {
      out.push(...els);
      continue;
    }
    const words = part.split(/\s+/);
    if (words.length === 2) {
      const [ancestorTag, descendantTag] = words as [string, string];
      out.push(
        ...els.filter(
          (e) =>
            e.tagName === descendantTag.toUpperCase() &&
            e.ancestors().some((a) => a.tagName === ancestorTag.toUpperCase()),
        ),
      );
      continue;
    }
    const attrMatch = /^([a-zA-Z]*)\[([a-zA-Z-]+)(?:=([^\]]+))?\]$/.exec(part);
    if (attrMatch) {
      const [, tag, name, value] = attrMatch;
      out.push(
        ...els.filter(
          (e) =>
            (!tag || e.tagName === tag.toUpperCase()) &&
            e.hasAttribute(name!) &&
            (value === undefined || e.getAttribute(name!) === value),
        ),
      );
      continue;
    }
    if (/^[a-zA-Z]+$/.test(part)) {
      out.push(...els.filter((e) => e.tagName === part.toUpperCase()));
      continue;
    }
    throw new Error(`fake DOM cannot express selector: ${part}`);
  }
  return [...new Set(out)];
}

export function el(init: ElInit): El {
  return new El(init);
}

/** Executes the REAL generated script — the same string the driver evaluates in the page. */
export function run<T>(script: string, root: El): T {
  const all = root.descendants();
  const document = {
    querySelectorAll(sel: string): El[] {
      return select(all, sel);
    },
  };
  const window = { getComputedStyle: (e: El) => e.computedStyle() };
  return new Function("document", "window", `return (${script});`)(document, window) as T;
}

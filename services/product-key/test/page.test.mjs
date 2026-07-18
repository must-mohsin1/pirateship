import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../../../page.js", import.meta.url), "utf8");
const html = await readFile(new URL("../../../pirate-network-blog.html", import.meta.url), "utf8");

test("the launch is directly reachable from desktop and compact navigation", () => {
  assert.equal((html.match(/href="#preorder"/g) ?? []).length, 2);
  assert.match(html, /aria-label="Launch"/);
  assert.match(html, /<span class="dot"><\/span>Pre-order<\/a>/);
});

class FakeElement {
  constructor({ id = "", attributes = {}, innerHTML = "", top = 0 } = {}) {
    this.id = id;
    this.attributes = new Map(Object.entries(attributes));
    this.innerHTML = innerHTML;
    this.top = top;
    this.currentTime = 9;
    this.pauseCount = 0;
    this.listeners = new Map();
    this.classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => this.classes.add(name)),
      toggle: (name, enabled) => {
        if (enabled) this.classes.add(name);
        else this.classes.delete(name);
      },
    };
  }

  addEventListener(name, listener) {
    this.listeners.set(name, listener);
  }

  dispatch(name) {
    this.listeners.get(name)?.({ target: this });
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  getBoundingClientRect() {
    return { top: this.top };
  }

  pause() {
    this.pauseCount += 1;
  }
}

function runPage({ reducedMotion = false, selectors = {}, elements = {} } = {}) {
  const windowListeners = new Map();
  const observers = [];
  const document = {
    documentElement: { clientHeight: 1_000, lang: "en" },
    getElementById: (id) => elements[id] ?? null,
    querySelectorAll: (selector) => selectors[selector] ?? [],
  };
  const window = {
    innerHeight: 1_000,
    addEventListener: (name, listener) => windowListeners.set(name, listener),
  };
  class FakeIntersectionObserver {
    constructor(callback, options) {
      this.callback = callback;
      this.options = options;
      this.observed = [];
      this.unobserved = [];
      observers.push(this);
    }

    observe(element) {
      this.observed.push(element);
    }

    unobserve(element) {
      this.unobserved.push(element);
    }
  }
  window.IntersectionObserver = FakeIntersectionObserver;

  vm.runInNewContext(source, {
    document,
    window,
    matchMedia: () => ({ matches: reducedMotion }),
    requestAnimationFrame: (callback) => callback(),
    IntersectionObserver: FakeIntersectionObserver,
  });

  return { document, observers, windowListeners };
}

test("reduced-motion mode pins the background video to its poster frame", () => {
  const video = new FakeElement({ attributes: { autoplay: "" } });
  runPage({ reducedMotion: true, elements: { sea: video } });

  assert.equal(video.pauseCount, 1);
  assert.equal(video.currentTime, 0);
  assert.equal(video.getAttribute("autoplay"), null);

  video.currentTime = 7;
  video.dispatch("play");
  assert.equal(video.pauseCount, 2);
  assert.equal(video.currentTime, 0);
});

test("the side rail tracks the last heading above the viewport trigger", () => {
  const firstLink = new FakeElement({ attributes: { href: "#first" } });
  const secondLink = new FakeElement({ attributes: { href: "#second" } });
  const firstHeading = new FakeElement({ id: "first", top: 100 });
  const secondHeading = new FakeElement({ id: "second", top: 500 });

  const page = runPage({
    selectors: { ".toc a": [firstLink, secondLink] },
    elements: { first: firstHeading, second: secondHeading },
  });
  assert.equal(firstLink.classes.has("active"), true);
  assert.equal(secondLink.classes.has("active"), false);

  secondHeading.top = 250;
  page.windowListeners.get("scroll")();
  assert.equal(firstLink.classes.has("active"), false);
  assert.equal(secondLink.classes.has("active"), true);
});

test("visible section headings animate once and are then unobserved", () => {
  const first = new FakeElement();
  const second = new FakeElement();
  const page = runPage({ selectors: { ".post > h2": [first, second] } });

  assert.equal(page.observers.length, 1);
  assert.deepEqual(page.observers[0].observed, [first, second]);
  assert.equal(page.observers[0].options.threshold, 0.15);

  page.observers[0].callback([
    { target: first, isIntersecting: false },
    { target: second, isIntersecting: true },
  ]);
  assert.equal(first.classes.has("in"), false);
  assert.equal(second.classes.has("in"), true);
  assert.deepEqual(page.observers[0].unobserved, [second]);
});

test("the language toggle swaps Korean copy and restores the cached English markup", () => {
  const heading = new FakeElement({ attributes: { "data-ko": "출시" }, innerHTML: "Launch" });
  const richCopy = new FakeElement({
    attributes: { "data-ko": "<strong>환불</strong>" },
    innerHTML: "<strong>Refund</strong>",
  });
  const english = new FakeElement({ attributes: { "data-lang": "en" } });
  const korean = new FakeElement({ attributes: { "data-lang": "ko" } });
  const page = runPage({
    selectors: {
      "[data-ko]:not([data-live])": [heading, richCopy],
      ".lang button": [english, korean],
    },
  });

  korean.dispatch("click");
  assert.equal(page.document.documentElement.lang, "ko");
  assert.equal(heading.innerHTML, "출시");
  assert.equal(richCopy.innerHTML, "<strong>환불</strong>");
  assert.equal(korean.getAttribute("aria-pressed"), "true");
  assert.equal(english.getAttribute("aria-pressed"), "false");

  english.dispatch("click");
  assert.equal(page.document.documentElement.lang, "en");
  assert.equal(heading.innerHTML, "Launch");
  assert.equal(richCopy.innerHTML, "<strong>Refund</strong>");
});

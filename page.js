(function () {
  "use strict";

  // Respect reduced-motion: leave the poster frame up instead of autoplaying.
  var video = document.getElementById("sea");
  if (video && matchMedia("(prefers-reduced-motion: reduce)").matches) {
    var stop = function () {
      video.pause();
      video.removeAttribute("autoplay");
      video.currentTime = 0;
    };
    stop();
    video.addEventListener("play", stop);
  }

  // Left rail: highlight the last heading scrolled past the trigger line.
  var links = Array.prototype.slice.call(document.querySelectorAll(".toc a"));
  var heads = links.map(function (link) {
    return document.getElementById(link.getAttribute("href").slice(1));
  }).filter(Boolean);
  if (heads.length) {
    var ticking = false;
    var setActive = function (id) {
      links.forEach(function (link) {
        link.classList.toggle("active", link.getAttribute("href") === "#" + id);
      });
    };
    var update = function () {
      ticking = false;
      var line = (window.innerHeight || document.documentElement.clientHeight) * 0.3;
      var current = heads[0].id;
      for (var index = 0; index < heads.length; index += 1) {
        if (heads[index].getBoundingClientRect().top <= line) current = heads[index].id;
      }
      setActive(current);
    };
    var onScroll = function () {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    update();
  }

  // Pop each section heading in as it enters view.
  var sectionHeads = document.querySelectorAll(".post > h2");
  if (sectionHeads.length && "IntersectionObserver" in window) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15 });
    sectionHeads.forEach(function (heading) { observer.observe(heading); });
  }

  // Language toggle: swap innerHTML of every [data-ko] element, English cached on load.
  // Escrow controls marked live nodes after it reads wallet and contract state.
  // Leaving them out prevents a language toggle from restoring stale launch copy.
  var nodes = Array.prototype.slice.call(document.querySelectorAll("[data-ko]:not([data-live])"));
  var english = nodes.map(function (node) { return node.innerHTML; });
  var buttons = Array.prototype.slice.call(document.querySelectorAll(".lang button"));
  var language = "en";
  var setLanguage = function (nextLanguage) {
    if (nextLanguage === language) return;
    language = nextLanguage;
    nodes.forEach(function (node, index) {
      node.innerHTML = nextLanguage === "ko" ? node.getAttribute("data-ko") : english[index];
    });
    document.documentElement.lang = nextLanguage;
    buttons.forEach(function (button) {
      var active = button.getAttribute("data-lang") === nextLanguage;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
  };
  buttons.forEach(function (button) {
    button.addEventListener("click", function () {
      setLanguage(button.getAttribute("data-lang"));
    });
  });
}());

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

  // Right rail: a five-stop voyage down the gutter, drawn once.
  (function () {
    var rail = document.querySelector(".rail");
    if (!rail) return;
    var route = document.getElementById("route");
    var sailed = document.getElementById("routeSailed");
    var boat = rail.querySelector(".boat");
    var face = rail.querySelector(".boat-face");
    var clip = document.getElementById("sailedRect");
    var isles = document.getElementById("isles");
    if (!route || !sailed || !boat || !face || !clip || !isles) return;

    var namespace = "http://www.w3.org/2000/svg";
    var top = 16;
    var bottom = 384;
    var left = 32;
    var right = 96;
    var chestX = 65;
    var markerOffset = 13;
    var stops = [
      { progress: 0.16, icon: "#icoLetter", label: ["PIRATE", "INVITE"] },
      { progress: 0.38, icon: "#icoScope", label: ["PEEK", "THE SHIP"] },
      { progress: 0.60, icon: "#icoGem", label: ["REVEAL", "TREASURE"] },
      { progress: 0.82, icon: "#icoHelm", label: ["COME", "ABOARD"] },
    ];
    var points = [{ x: right, y: top }]
      .concat(stops.map(function (stop, index) {
        return {
          x: index % 2 === 0 ? left : right,
          y: top + stop.progress * (bottom - top),
        };
      }))
      .concat([{ x: chestX, y: bottom }]);
    var markers = [];

    var path = "M" + points[0].x.toFixed(1) + " " + points[0].y.toFixed(1);
    for (var index = 0; index < points.length - 1; index += 1) {
      var start = points[index];
      var end = points[index + 1];
      var handle = (end.y - start.y) / 2;
      path += " C" + start.x.toFixed(1) + " " + (start.y + handle).toFixed(1)
        + " " + end.x.toFixed(1) + " " + (end.y - handle).toFixed(1)
        + " " + end.x.toFixed(1) + " " + end.y.toFixed(1);
    }
    route.setAttribute("d", path);
    sailed.setAttribute("d", path);

    stops.forEach(function (stop, index) {
      var point = points[index + 1];
      var group = document.createElementNS(namespace, "g");
      group.setAttribute("class", "isle");
      group.setAttribute(
        "transform",
        "translate("
          + (point.x + (point.x === left ? -markerOffset : markerOffset)).toFixed(1)
          + ","
          + point.y.toFixed(1)
          + ")",
      );
      var use = document.createElementNS(namespace, "use");
      use.setAttribute("href", stop.icon);
      use.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", stop.icon);
      group.appendChild(use);
      stop.label.forEach(function (line, lineIndex) {
        var text = document.createElementNS(namespace, "text");
        text.setAttribute("y", (13.5 + lineIndex * 7).toFixed(1));
        text.textContent = line;
        group.appendChild(text);
      });
      isles.appendChild(group);
      markers.push({ progress: stop.progress, element: group });
    });

    function positionAtY(y) {
      for (var index = 0; index < points.length - 1; index += 1) {
        var start = points[index];
        var end = points[index + 1];
        if (y <= end.y || index === points.length - 2) {
          var height = end.y - start.y;
          if (height <= 0) return { x: end.x, unitX: 0 };
          var target = Math.min(1, Math.max(0, (y - start.y) / height));
          var low = 0;
          var high = 1;
          var time = 0;
          for (var step = 0; step < 24; step += 1) {
            time = (low + high) / 2;
            if (time ** 3 - 1.5 * time ** 2 + 1.5 * time < target) low = time;
            else high = time;
          }
          time = (low + high) / 2;
          var deltaX = end.x - start.x;
          var dx = deltaX * 6 * time * (1 - time);
          var dy = height * (3 * time ** 2 - 3 * time + 1.5);
          var length = Math.sqrt(dx * dx + dy * dy) || 1;
          return {
            x: start.x + deltaX * (time ** 2 * (3 - 2 * time)),
            unitX: dx / length,
          };
        }
      }
      return { x: chestX, unitX: 0 };
    }

    var ticking = false;
    function update() {
      ticking = false;
      var maximum = document.documentElement.scrollHeight - window.innerHeight;
      var progress = maximum > 0
        ? Math.min(1, Math.max(0, window.pageYOffset / maximum))
        : 0;
      markers.forEach(function (marker) {
        marker.element.classList.toggle("lit", progress >= marker.progress);
      });
      var y = top + progress * (bottom - top);
      var position = positionAtY(y);
      boat.setAttribute(
        "transform",
        "translate(" + position.x.toFixed(2) + "," + y.toFixed(2) + ") rotate("
          + (position.unitX * 10).toFixed(2) + ")",
      );
      face.setAttribute(
        "transform",
        "scale(" + (position.unitX >= 0 ? -0.92 : 0.92) + ",0.92)",
      );
      clip.setAttribute("height", y.toFixed(2));
      rail.classList.toggle("arrived", progress > 0.985);
    }
    function onScroll() {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    if ("ResizeObserver" in window) new ResizeObserver(onScroll).observe(document.body);
    update();
  }());

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

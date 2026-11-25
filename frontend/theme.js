// Theme flavors: applied before first paint (loaded in <head>), and switched from Settings via window.gcTheme.
(function () {
  var KEY = "gc.theme";
  var FONTS = "https://fonts.googleapis.com/css2?display=swap&family=";
  var THEMES = {
    main:   { name: "Main",      bg: "#0E0F11", dark: true,  fonts: "Space+Grotesk:wght@600;700&family=Inter:wght@400;500;600" },
    cyber:  { name: "Cyberpunk", bg: "#08070D", dark: true,  fonts: "Orbitron:wght@600;700&family=Rajdhani:wght@500;600;700&family=Share+Tech+Mono" },
    pastel: { name: "Pastel",    bg: "#F7F4FB", dark: false, fonts: "Fredoka:wght@500;600;700&family=Nunito:wght@400;600;700" },
    forest: { name: "Forest",    bg: "#10201A", dark: true,  fonts: "DM+Serif+Display&family=DM+Sans:wght@400;500;600;700" },
    brutal: { name: "Brutalist", bg: "#FFE14D", dark: false, fonts: "Archivo+Black&family=Archivo:wght@400;500;600;700" },
    frost:  { name: "Frost",     bg: "#EEF3F7", dark: false, fonts: "Manrope:wght@500;600;700;800" },
  };

  function current() {
    try { var t = localStorage.getItem(KEY); return THEMES[t] ? t : "main"; } catch (e) { return "main"; }
  }

  function set(sel, attr, value) {
    var el = document.querySelector(sel);
    if (el) el.setAttribute(attr, value);
  }

  function apply(id) {
    if (!THEMES[id]) id = "main";
    var t = THEMES[id];
    document.documentElement.setAttribute("data-theme", id);
    set("#theme-fonts", "href", FONTS + t.fonts);
    set('meta[name="theme-color"]', "content", t.bg);
    set('meta[name="apple-mobile-web-app-status-bar-style"]', "content", t.dark ? "black-translucent" : "default");
    // iOS reads the home-screen icon when "Add to Home Screen" is tapped
    set('link[rel="apple-touch-icon"]', "href", id === "main" ? "apple-touch-icon.png" : "icons/themes/" + id + "-180.png");
    set('link[rel="icon"]', "href", "icons/themes/" + id + "-180.png");
    return id;
  }

  window.gcTheme = {
    list: THEMES,
    current: current,
    apply: apply,
    choose: function (id) {
      id = apply(id);
      try { localStorage.setItem(KEY, id); } catch (e) {}
    },
  };
  apply(current());
})();

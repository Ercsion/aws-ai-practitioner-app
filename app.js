/* AIF-C01 题库 - mobile study app
 * Pure vanilla JS, no build step, works fully offline as a local file.
 */
(function () {
  "use strict";

  var QUESTIONS = window.QUESTIONS || [];
  var TOTAL = QUESTIONS.length;
  var STORAGE_KEY = "aif_app_state_v1";

  var FONT_SCALES = [0.85, 1, 1.15, 1.3, 1.45];
  var FONT_LABELS = ["小", "标准", "大", "较大", "特大"];
  var DEFAULT_FONT_INDEX = 1;

  // ---------- Persistent state ----------
  var state = loadState();

  function loadState() {
    var defaults = {
      lang: "both",          // 'zh' | 'en' | 'both'
      wrongIds: [],          // question ids ever answered wrong (current wrong book)
      progress: {},          // id -> { attempted: bool, correct: bool }
      fontIndex: DEFAULT_FONT_INDEX, // index into FONT_SCALES
      quizSeqCursor: 1       // next question id to start from for sequential quizzes
    };
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaults;
      var parsed = JSON.parse(raw);
      return Object.assign(defaults, parsed);
    } catch (e) {
      return defaults;
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) { /* ignore quota errors */ }
  }

  function markWrong(id) {
    if (state.wrongIds.indexOf(id) === -1) state.wrongIds.push(id);
    state.progress[id] = { attempted: true, correct: false };
    saveState();
  }
  function markCorrect(id) {
    var idx = state.wrongIds.indexOf(id);
    if (idx !== -1) state.wrongIds.splice(idx, 1);
    state.progress[id] = { attempted: true, correct: true };
    saveState();
  }
  function clearWrongBook() {
    state.wrongIds = [];
    saveState();
  }
  function removeFromWrongBook(id) {
    var idx = state.wrongIds.indexOf(id);
    if (idx !== -1) state.wrongIds.splice(idx, 1);
    saveState();
  }

  // ---------- DOM refs ----------
  var elApp = document.getElementById("app");
  var elTopTitle = document.getElementById("top-title");
  var elBtnBack = document.getElementById("btn-back");
  var elBtnFontSize = document.getElementById("btn-font-size");
  var elLangSwitch = document.getElementById("lang-switch");
  var elBottomNav = document.getElementById("bottom-nav");
  var elOverlayRoot = document.getElementById("overlay-root");

  // ---------- Font size control ----------
  function applyFontScale() {
    var idx = clampFontIndex(state.fontIndex);
    document.documentElement.style.setProperty("--font-scale", String(FONT_SCALES[idx]));
  }
  function clampFontIndex(idx) {
    return Math.min(Math.max(idx, 0), FONT_SCALES.length - 1);
  }
  function setFontIndex(idx) {
    state.fontIndex = clampFontIndex(idx);
    saveState();
    applyFontScale();
    renderFontSizePanel();
  }

  function openFontSizePanel() {
    if (elOverlayRoot.querySelector(".font-size-panel")) return;
    var backdrop = document.createElement("div");
    backdrop.className = "overlay-backdrop";
    backdrop.addEventListener("click", closeFontSizePanel);

    var panel = document.createElement("div");
    panel.className = "font-size-panel";
    panel.addEventListener("click", function (e) { e.stopPropagation(); });

    elOverlayRoot.appendChild(backdrop);
    elOverlayRoot.appendChild(panel);
    renderFontSizePanel();
  }
  function closeFontSizePanel() {
    var backdrop = elOverlayRoot.querySelector(".overlay-backdrop");
    var panel = elOverlayRoot.querySelector(".font-size-panel");
    if (backdrop) backdrop.remove();
    if (panel) panel.remove();
  }
  function renderFontSizePanel() {
    var panel = elOverlayRoot.querySelector(".font-size-panel");
    if (!panel) return;
    var idx = clampFontIndex(state.fontIndex);

    var dots = "";
    FONT_SCALES.forEach(function (_, i) {
      dots += '<span class="fsp-dot' + (i === idx ? " active" : "") + '"></span>';
    });

    panel.innerHTML =
      '<div class="fsp-title">字体大小 · ' + FONT_LABELS[idx] + "</div>" +
      '<div class="fsp-preview">示例文字 Sample text 中英文预览</div>' +
      '<div class="fsp-steps">' +
      '<button class="fsp-step-btn" id="fsp-dec" aria-label="缩小字体"' + (idx === 0 ? " disabled" : "") + ">A-</button>" +
      '<div class="fsp-dots">' + dots + "</div>" +
      '<button class="fsp-step-btn" id="fsp-inc" aria-label="放大字体"' + (idx === FONT_SCALES.length - 1 ? " disabled" : "") + ">A+</button>" +
      "</div>" +
      '<button class="fsp-reset" id="fsp-reset">恢复默认</button>';

    panel.querySelector("#fsp-dec").addEventListener("click", function () { setFontIndex(idx - 1); });
    panel.querySelector("#fsp-inc").addEventListener("click", function () { setFontIndex(idx + 1); });
    panel.querySelector("#fsp-reset").addEventListener("click", function () { setFontIndex(DEFAULT_FONT_INDEX); });
  }

  elBtnFontSize.addEventListener("click", openFontSizePanel);

  // ---------- Jump-to-question panel (reused by study mode progress bar) ----------
  function openJumpPanel(onJump) {
    if (elOverlayRoot.querySelector(".jump-panel")) return;
    var backdrop = document.createElement("div");
    backdrop.className = "overlay-backdrop";
    backdrop.addEventListener("click", closeJumpPanel);

    var panel = document.createElement("div");
    panel.className = "font-size-panel jump-panel";
    panel.addEventListener("click", function (e) { e.stopPropagation(); });

    panel.innerHTML =
      '<div class="fsp-title">跳转到题目</div>' +
      '<div class="jump-row">' +
      '<input type="number" id="jump-input" class="num-input" min="1" max="' + TOTAL + '" placeholder="1-' + TOTAL + '" />' +
      '<button class="btn-primary jump-go-btn" id="jump-go">跳转</button>' +
      "</div>";

    elOverlayRoot.appendChild(backdrop);
    elOverlayRoot.appendChild(panel);

    var input = panel.querySelector("#jump-input");
    input.focus();
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") doJump();
    });
    panel.querySelector("#jump-go").addEventListener("click", doJump);

    function doJump() {
      var val = parseInt(input.value, 10);
      if (!val || val < 1 || val > TOTAL) {
        toast("请输入 1-" + TOTAL + " 之间的题号");
        return;
      }
      closeJumpPanel();
      onJump(val);
    }
  }
  function closeJumpPanel() {
    var backdrop = elOverlayRoot.querySelector(".overlay-backdrop");
    var panel = elOverlayRoot.querySelector(".jump-panel");
    if (backdrop) backdrop.remove();
    if (panel) panel.remove();
  }

  // ---------- Navigation / view stack ----------
  var viewStack = [];

  function navigate(view, opts) {
    viewStack.push({ view: view, opts: opts || {} });
    render();
  }
  function replaceView(view, opts) {
    viewStack[viewStack.length - 1] = { view: view, opts: opts || {} };
    render();
  }
  function goBack() {
    if (viewStack.length > 1) {
      viewStack.pop();
      render();
    }
  }
  function goHome() {
    viewStack = [{ view: "home", opts: {} }];
    render();
  }

  // ---------- Lang switch UI ----------
  function setLang(lang) {
    state.lang = lang;
    saveState();
    updateLangButtons();
    render();
  }
  function updateLangButtons() {
    var btns = elLangSwitch.querySelectorAll(".seg-btn");
    btns.forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-lang") === state.lang);
    });
  }
  elLangSwitch.addEventListener("click", function (e) {
    var btn = e.target.closest(".seg-btn");
    if (!btn) return;
    setLang(btn.getAttribute("data-lang"));
  });

  elBtnBack.addEventListener("click", goBack);

  elBottomNav.addEventListener("click", function (e) {
    var btn = e.target.closest(".nav-btn");
    if (!btn) return;
    var view = btn.getAttribute("data-view");
    if (view === "home") { goHome(); return; }
    if (view === "study") { viewStack = [{ view: "home", opts: {} }, { view: "study-setup", opts: {} }]; render(); return; }
    if (view === "quiz") { viewStack = [{ view: "home", opts: {} }, { view: "quiz-setup", opts: {} }]; render(); return; }
    if (view === "wrongbook") { viewStack = [{ view: "home", opts: {} }, { view: "wrongbook", opts: {} }]; render(); return; }
  });

  // ---------- Utility ----------
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  function toast(msg) {
    var el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    elOverlayRoot.appendChild(el);
    requestAnimationFrame(function () { el.classList.add("show"); });
    setTimeout(function () {
      el.classList.remove("show");
      setTimeout(function () { el.remove(); }, 250);
    }, 1600);
  }

  function questionById(id) {
    return QUESTIONS.find(function (q) { return q.id === id; });
  }

  // Renders bilingual text according to current lang setting.
  // Returns HTML string with a primary line and (if 'both') a secondary line.
  function bilingualBlock(zhText, enText, opts) {
    opts = opts || {};
    var primaryClass = opts.primaryClass || "";
    var secondaryClass = opts.secondaryClass || "secondary";
    if (state.lang === "zh") {
      return '<div class="' + primaryClass + '">' + escapeHtml(zhText) + "</div>";
    }
    if (state.lang === "en") {
      return '<div class="' + primaryClass + '">' + escapeHtml(enText) + "</div>";
    }
    // both
    return (
      '<div class="' + primaryClass + '">' + escapeHtml(zhText) + "</div>" +
      '<div class="' + secondaryClass + '">' + escapeHtml(enText) + "</div>"
    );
  }

  function bilingualInline(zhText, enText) {
    if (state.lang === "zh") return escapeHtml(zhText);
    if (state.lang === "en") return escapeHtml(enText);
    return escapeHtml(zhText) + '<span class="secondary-line">' + escapeHtml(enText) + "</span>";
  }

  // ---------- Views ----------
  var VIEW_TITLES = {
    home: "AIF-C01 题库",
    "study-setup": "背题模式",
    study: "背题模式",
    "quiz-setup": "测试模式",
    quiz: "测试模式",
    "quiz-result": "测试结果",
    wrongbook: "错题本",
    "wrongbook-review": "错题回顾"
  };

  function render() {
    closeFontSizePanel();
    closeJumpPanel();
    var top = viewStack[viewStack.length - 1];
    elBtnBack.hidden = viewStack.length <= 1;
    elTopTitle.textContent = VIEW_TITLES[top.view] || "AIF-C01 题库";
    updateLangButtons();

    var navButtons = elBottomNav.querySelectorAll(".nav-btn");
    navButtons.forEach(function (b) {
      var v = b.getAttribute("data-view");
      var active = (v === "home" && top.view === "home") ||
        (v === "study" && (top.view === "study-setup" || top.view === "study")) ||
        (v === "quiz" && (top.view === "quiz-setup" || top.view === "quiz" || top.view === "quiz-result")) ||
        (v === "wrongbook" && (top.view === "wrongbook" || top.view === "wrongbook-review"));
      b.classList.toggle("active", active);
    });

    elApp.innerHTML = "";
    elApp.scrollTop = 0;

    switch (top.view) {
      case "home": renderHome(); break;
      case "study-setup": renderStudySetup(); break;
      case "study": renderStudy(top.opts); break;
      case "quiz-setup": renderQuizSetup(); break;
      case "quiz": renderQuiz(top.opts); break;
      case "quiz-result": renderQuizResult(top.opts); break;
      case "wrongbook": renderWrongbook(); break;
      case "wrongbook-review": renderWrongbookReview(top.opts); break;
      default: renderHome();
    }
  }

  // ---- Home ----
  function renderHome() {
    var attemptedIds = Object.keys(state.progress);
    var correctCount = attemptedIds.filter(function (id) { return state.progress[id].correct; }).length;
    var wrongCount = state.wrongIds.length;

    var html = "";
    html += '<div class="home-hero"><h2>AWS AI Practitioner (AIF-C01)</h2>' +
      "<p>共 " + TOTAL + " 题 · 支持背题与测试两种模式</p></div>";

    html += '<div class="stat-row">' +
      statBox(TOTAL, "题库总数") +
      statBox(attemptedIds.length, "已作答") +
      statBox(correctCount, "答对") +
      "</div>";

    html += '<div class="section-title">开始学习</div>';
    html += actionCard("orange", "&#128218;", "背题模式", "逐题浏览题干、选项与解析，双语对照", "go-study");
    html += actionCard("navy", "&#9998;", "测试模式", "互动答题，作答后立即查看对错和解析", "go-quiz");
    html += actionCard("red", "&#9888;", "错题本", wrongCount + " 道错题待复习", "go-wrongbook");

    elApp.innerHTML = html;

    elApp.querySelector('[data-action="go-study"]').addEventListener("click", function () {
      navigate("study-setup");
    });
    elApp.querySelector('[data-action="go-quiz"]').addEventListener("click", function () {
      navigate("quiz-setup");
    });
    elApp.querySelector('[data-action="go-wrongbook"]').addEventListener("click", function () {
      navigate("wrongbook");
    });
  }

  function statBox(num, label) {
    return '<div class="stat-box"><div class="num">' + num + '</div><div class="lbl">' + escapeHtml(label) + "</div></div>";
  }
  function actionCard(color, icon, title, desc, action) {
    return (
      '<div class="action-card" data-action="' + action + '">' +
      '<div class="ic ' + color + '">' + icon + "</div>" +
      '<div class="body"><div class="title">' + escapeHtml(title) + '</div><div class="desc">' + escapeHtml(desc) + "</div></div>" +
      '<div class="chev">&#8250;</div>' +
      "</div>"
    );
  }

  // ---- Study setup ----
  function renderStudySetup() {
    var html = "";
    html += '<div class="section-title">选择范围</div>';
    html += '<div class="setup-group">' +
      setupRow("从第几题开始", "共 " + TOTAL + " 题", '<input type="number" id="study-start" class="num-input" min="1" max="' + TOTAL + '" value="1" />') +
      setupRow("顺序", "", chipGroup("study-order", [["seq", "顺序"], ["random", "随机"]], "seq")) +
      "</div>";

    html += '<button class="btn-primary" id="btn-start-study">开始背题</button>';

    elApp.innerHTML = html;
    bindChipGroups(elApp);

    elApp.querySelector("#btn-start-study").addEventListener("click", function () {
      var startVal = parseInt(elApp.querySelector("#study-start").value, 10) || 1;
      startVal = Math.min(Math.max(startVal, 1), TOTAL);
      var order = getChipValue(elApp, "study-order");
      var ids = QUESTIONS.map(function (q) { return q.id; });
      if (order === "random") {
        ids = shuffle(ids);
      } else {
        ids = ids.filter(function (id) { return id >= startVal; }).concat(ids.filter(function (id) { return id < startVal; }));
      }
      replaceView("study", { ids: ids, index: 0 });
    });
  }

  function setupRow(label, sub, controlHtml) {
    return (
      '<div class="setup-row"><div><div class="lbl">' + escapeHtml(label) + "</div>" +
      (sub ? '<div class="sub">' + escapeHtml(sub) + "</div>" : "") +
      "</div>" + controlHtml + "</div>"
    );
  }
  function chipGroup(name, options, def) {
    var html = '<div class="chip-group" data-chip-group="' + name + '">';
    options.forEach(function (opt) {
      html += '<button class="chip' + (opt[0] === def ? " active" : "") + '" data-value="' + opt[0] + '">' + escapeHtml(opt[1]) + "</button>";
    });
    html += "</div>";
    return html;
  }
  function bindChipGroups(root) {
    root.querySelectorAll("[data-chip-group]").forEach(function (group) {
      group.addEventListener("click", function (e) {
        var chip = e.target.closest(".chip");
        if (!chip) return;
        group.querySelectorAll(".chip").forEach(function (c) { c.classList.remove("active"); });
        chip.classList.add("active");
      });
    });
  }
  function getChipValue(root, name) {
    var group = root.querySelector('[data-chip-group="' + name + '"]');
    var active = group.querySelector(".chip.active");
    return active ? active.getAttribute("data-value") : null;
  }

  // ---- Study mode ----
  function renderStudy(opts) {
    var ids = opts.ids;
    var index = opts.index;
    var q = questionById(ids[index]);

    var html = "";
    html += '<div class="q-progress"><button class="q-progress-jump" id="btn-jump-progress">第 ' + (index + 1) + " / " + ids.length + " 题 &#9998;</button>" +
      '<span>原题号 #' + q.id + "</span></div>";

    html += '<div class="q-card">';
    html += '<span class="q-num-badge">Q' + q.id + "</span>";
    if (q.multiple) html += '<span class="q-multi-badge">多选</span>';
    html += bilingualBlock(q.stem.zh, q.stem.en, { primaryClass: "q-stem", secondaryClass: "q-stem secondary" });

    html += '<div class="opt-list">';
    q.options.zh.forEach(function (optZh, i) {
      var optEn = q.options.en[i];
      var isCorrect = q.correct.indexOf(optZh.label) !== -1;
      html += '<div class="opt-item' + (isCorrect ? " correct" : "") + '">' +
        '<div class="opt-mark">' + optZh.label + "</div>" +
        '<div class="opt-text">' + bilingualInline(optZh.text, optEn.text) + "</div>" +
        "</div>";
    });
    html += "</div>";

    html += '<div class="explain-box"><div class="explain-title">解析</div>';
    html += bilingualBlock(q.explanation.zh || "（无）", q.explanation.en || "(none)", { primaryClass: "explain-text", secondaryClass: "explain-text secondary" });
    html += "</div>";
    html += "</div>";

    html += '<div class="nav-row">' +
      '<button class="btn-secondary" id="btn-prev" ' + (index === 0 ? "disabled" : "") + '>&#8592; 上一题</button>' +
      '<button class="btn-primary" id="btn-next" ' + (index === ids.length - 1 ? "disabled" : "") + '>下一题 &#8594;</button>' +
      "</div>";

    elApp.innerHTML = html;

    var prevBtn = elApp.querySelector("#btn-prev");
    var nextBtn = elApp.querySelector("#btn-next");
    if (prevBtn) prevBtn.addEventListener("click", function () {
      if (index > 0) replaceView("study", { ids: ids, index: index - 1 });
    });
    if (nextBtn) nextBtn.addEventListener("click", function () {
      if (index < ids.length - 1) replaceView("study", { ids: ids, index: index + 1 });
    });

    var jumpBtn = elApp.querySelector("#btn-jump-progress");
    if (jumpBtn) jumpBtn.addEventListener("click", function () {
      openJumpPanel(function (qid) {
        var newIndex = ids.indexOf(qid);
        if (newIndex === -1) {
          toast("当前列表中没有第 " + qid + " 题，请回到设置页从该题开始");
          return;
        }
        replaceView("study", { ids: ids, index: newIndex });
      });
    });
  }

  // ---- Quiz setup ----
  function renderQuizSetup() {
    var resumeId = clampSeqCursor(state.quizSeqCursor);
    var html = "";
    html += '<div class="section-title">测试设置</div>';
    html += '<div class="setup-group">' +
      setupRow("题目范围", "", chipGroup("quiz-scope", [["all", "全部题库"], ["custom", "自定义数量"]], "all")) +
      setupRow("题目数量", "范围: 5-" + TOTAL, '<input type="number" id="quiz-count" class="num-input" min="5" max="' + TOTAL + '" value="20" />') +
      setupRow("题目顺序", "顺序模式将从第 " + resumeId + " 题接续开始", chipGroup("quiz-order", [["random", "随机"], ["seq", "顺序"]], "random")) +
      "</div>";
    html += '<button class="btn-primary" id="btn-start-quiz">开始测试</button>';

    elApp.innerHTML = html;
    bindChipGroups(elApp);

    var countInput = elApp.querySelector("#quiz-count");
    var scopeGroup = elApp.querySelector('[data-chip-group="quiz-scope"]');
    function syncCountDisabled() {
      var scope = getChipValue(elApp, "quiz-scope");
      countInput.disabled = scope === "all";
    }
    scopeGroup.addEventListener("click", syncCountDisabled);
    syncCountDisabled();

    elApp.querySelector("#btn-start-quiz").addEventListener("click", function () {
      var scope = getChipValue(elApp, "quiz-scope");
      var order = getChipValue(elApp, "quiz-order");
      var ids = QUESTIONS.map(function (q) { return q.id; });
      var isSeq = order === "seq";
      if (isSeq) {
        // Resume sequential order from where the user last left off.
        ids = ids.filter(function (id) { return id >= resumeId; }).concat(ids.filter(function (id) { return id < resumeId; }));
      } else {
        ids = shuffle(ids);
      }
      if (scope === "custom") {
        var n = parseInt(countInput.value, 10) || 20;
        n = Math.min(Math.max(n, 5), TOTAL);
        ids = ids.slice(0, n);
      }
      replaceView("quiz", { ids: ids, index: 0, answers: {}, submitted: {}, seq: isSeq });
    });
  }

  function clampSeqCursor(id) {
    if (!id || id < 1 || id > TOTAL) return 1;
    return id;
  }
  function advanceSeqCursor(id) {
    var next = id + 1;
    if (next > TOTAL) next = 1;
    state.quizSeqCursor = next;
    saveState();
  }

  // ---- Quiz mode ----
  function renderQuiz(opts) {
    var ids = opts.ids;
    var index = opts.index;
    var answers = opts.answers; // id -> array of selected labels
    var submitted = opts.submitted; // id -> true/false
    var isSeq = !!opts.seq;

    var q = questionById(ids[index]);
    var selected = answers[q.id] || [];
    var isSubmitted = !!submitted[q.id];

    var html = "";
    html += '<div class="q-progress"><span>第 ' + (index + 1) + " / " + ids.length + " 题</span>" +
      '<span>原题号 #' + q.id + "</span></div>";

    html += '<div class="q-card">';
    html += '<span class="q-num-badge">Q' + q.id + "</span>";
    if (q.multiple) html += '<span class="q-multi-badge">多选 (' + q.correct.length + ")</span>";
    html += bilingualBlock(q.stem.zh, q.stem.en, { primaryClass: "q-stem", secondaryClass: "q-stem secondary" });

    html += '<div class="opt-list">';
    q.options.zh.forEach(function (optZh, i) {
      var optEn = q.options.en[i];
      var label = optZh.label;
      var classes = ["opt-item"];
      if (!isSubmitted) classes.push("selectable");
      if (isSubmitted) {
        var isCorrectOpt = q.correct.indexOf(label) !== -1;
        var wasSelected = selected.indexOf(label) !== -1;
        if (isCorrectOpt) classes.push("correct");
        else if (wasSelected) classes.push("incorrect");
      } else if (selected.indexOf(label) !== -1) {
        classes.push("selected");
      }
      html += '<div class="' + classes.join(" ") + '" data-label="' + label + '">' +
        '<div class="opt-mark">' + label + "</div>" +
        '<div class="opt-text">' + bilingualInline(optZh.text, optEn.text) + "</div>" +
        "</div>";
    });
    html += "</div>";

    if (!isSubmitted) {
      html += '<button class="btn-primary" id="btn-submit-answer"' + (selected.length === 0 ? " disabled" : "") + ">提交答案</button>";
    } else {
      var userCorrect = arraysEqualAsSets(selected, q.correct.split(""));
      html += '<div class="result-banner ' + (userCorrect ? "correct" : "incorrect") + '">' +
        (userCorrect ? "&#10003; 回答正确" : "&#10007; 回答错误 · 正确答案: " + q.correct) +
        "</div>";
      html += '<div class="explain-box"><div class="explain-title">解析</div>';
      html += bilingualBlock(q.explanation.zh || "（无）", q.explanation.en || "(none)", { primaryClass: "explain-text", secondaryClass: "explain-text secondary" });
      html += "</div>";
    }
    html += "</div>";

    html += '<div class="nav-row">';
    html += '<button class="btn-secondary" id="btn-prev" ' + (index === 0 ? "disabled" : "") + '>&#8592; 上一题</button>';
    if (index === ids.length - 1) {
      html += '<button class="btn-primary" id="btn-finish"' + (!allSubmitted(ids, submitted) ? " disabled" : "") + ">完成测试</button>";
    } else {
      html += '<button class="btn-primary" id="btn-next"' + (!isSubmitted ? " disabled" : "") + ">下一题 &#8594;</button>";
    }
    html += "</div>";

    elApp.innerHTML = html;

    if (!isSubmitted) {
      elApp.querySelectorAll(".opt-item.selectable").forEach(function (el) {
        el.addEventListener("click", function () {
          var label = el.getAttribute("data-label");
          var cur = answers[q.id] || [];
          if (q.multiple) {
            var pos = cur.indexOf(label);
            if (pos === -1) cur.push(label); else cur.splice(pos, 1);
          } else {
            cur = [label];
          }
          answers[q.id] = cur;
          replaceView("quiz", { ids: ids, index: index, answers: answers, submitted: submitted, seq: isSeq });
        });
      });

      var submitBtn = elApp.querySelector("#btn-submit-answer");
      if (submitBtn) submitBtn.addEventListener("click", function () {
        submitted[q.id] = true;
        var correctSet = q.correct.split("");
        var isRight = arraysEqualAsSets(answers[q.id] || [], correctSet);
        if (isRight) markCorrect(q.id); else markWrong(q.id);
        if (isSeq) advanceSeqCursor(q.id);
        replaceView("quiz", { ids: ids, index: index, answers: answers, submitted: submitted, seq: isSeq });
      });
    }

    var prevBtn = elApp.querySelector("#btn-prev");
    if (prevBtn) prevBtn.addEventListener("click", function () {
      if (index > 0) replaceView("quiz", { ids: ids, index: index - 1, answers: answers, submitted: submitted, seq: isSeq });
    });
    var nextBtn = elApp.querySelector("#btn-next");
    if (nextBtn) nextBtn.addEventListener("click", function () {
      if (index < ids.length - 1) replaceView("quiz", { ids: ids, index: index + 1, answers: answers, submitted: submitted, seq: isSeq });
    });
    var finishBtn = elApp.querySelector("#btn-finish");
    if (finishBtn) finishBtn.addEventListener("click", function () {
      replaceView("quiz-result", { ids: ids, answers: answers, submitted: submitted });
    });
  }

  function allSubmitted(ids, submitted) {
    return ids.every(function (id) { return submitted[id]; });
  }
  function arraysEqualAsSets(a, b) {
    if (a.length !== b.length) return false;
    var as = a.slice().sort().join("");
    var bs = b.slice().sort().join("");
    return as === bs;
  }

  // ---- Quiz result ----
  function renderQuizResult(opts) {
    var ids = opts.ids;
    var answers = opts.answers;
    var correctCount = 0;
    var wrongList = [];
    ids.forEach(function (id) {
      var q = questionById(id);
      var isRight = arraysEqualAsSets(answers[id] || [], q.correct.split(""));
      if (isRight) correctCount++;
      else wrongList.push(id);
    });
    var pct = Math.round((correctCount / ids.length) * 100);

    var html = "";
    html += '<div class="score-hero">' +
      '<div class="score-num">' + pct + "%</div>" +
      '<div class="score-sub">共 ' + ids.length + " 题 · 答对 " + correctCount + " 题</div>" +
      '<div class="score-row">' +
      '<div class="item g"><div class="v">' + correctCount + '</div><div class="k">正确</div></div>' +
      '<div class="item r"><div class="v">' + wrongList.length + '</div><div class="k">错误</div></div>' +
      "</div></div>";

    if (wrongList.length > 0) {
      html += '<div class="section-title">本次错题</div>';
      wrongList.forEach(function (id) {
        var q = questionById(id);
        html += '<div class="list-row wrong" data-id="' + id + '">' +
          '<div class="lr-num">Q' + id + "</div>" +
          '<div class="lr-text">' + escapeHtml(state.lang === "en" ? q.stem.en : q.stem.zh) + "</div>" +
          '<div class="lr-chev">&#8250;</div>' +
          "</div>";
      });
    } else {
      html += '<div class="empty-state"><div class="ic">&#127881;</div><div class="msg">全部答对，太棒了！</div></div>';
    }

    html += '<button class="btn-primary" id="btn-retry">再测一次</button>';
    html += '<button class="btn-secondary" id="btn-home">返回首页</button>';

    elApp.innerHTML = html;

    elApp.querySelectorAll(".list-row").forEach(function (row) {
      row.addEventListener("click", function () {
        var id = parseInt(row.getAttribute("data-id"), 10);
        navigate("wrongbook-review", { ids: wrongList, index: wrongList.indexOf(id) });
      });
    });
    elApp.querySelector("#btn-retry").addEventListener("click", function () {
      replaceView("quiz-setup");
    });
    elApp.querySelector("#btn-home").addEventListener("click", goHome);
  }

  // ---- Wrong book list ----
  function renderWrongbook() {
    var ids = state.wrongIds.slice();
    var html = "";
    html += '<div class="stat-row">' + statBox(ids.length, "错题数量") + "</div>";

    if (ids.length === 0) {
      html += '<div class="empty-state"><div class="ic">&#128077;</div><div class="msg">暂无错题，继续加油！</div></div>';
    } else {
      html += '<div class="section-title">错题列表</div>';
      ids.forEach(function (id) {
        var q = questionById(id);
        if (!q) return;
        html += '<div class="list-row wrong" data-id="' + id + '">' +
          '<div class="lr-num">Q' + id + "</div>" +
          '<div class="lr-text">' + escapeHtml(state.lang === "en" ? q.stem.en : q.stem.zh) + "</div>" +
          '<div class="lr-chev">&#8250;</div>' +
          "</div>";
      });
      html += '<button class="btn-primary" id="btn-review-all">开始复习错题</button>';
      html += '<button class="btn-secondary btn-danger-outline" id="btn-clear-wrong">清空错题本</button>';
    }

    elApp.innerHTML = html;

    elApp.querySelectorAll(".list-row").forEach(function (row) {
      row.addEventListener("click", function () {
        var id = parseInt(row.getAttribute("data-id"), 10);
        var idx = ids.indexOf(id);
        navigate("wrongbook-review", { ids: ids, index: idx });
      });
    });
    var reviewBtn = elApp.querySelector("#btn-review-all");
    if (reviewBtn) reviewBtn.addEventListener("click", function () {
      navigate("wrongbook-review", { ids: ids, index: 0 });
    });
    var clearBtn = elApp.querySelector("#btn-clear-wrong");
    if (clearBtn) clearBtn.addEventListener("click", function () {
      if (confirm("确定要清空错题本吗？此操作不可撤销。")) {
        clearWrongBook();
        render();
        toast("错题本已清空");
      }
    });
  }

  // ---- Wrong book review (study-style with remove option) ----
  function renderWrongbookReview(opts) {
    var ids = opts.ids;
    var index = opts.index;
    if (ids.length === 0) { replaceView("wrongbook"); return; }
    index = Math.min(index, ids.length - 1);
    var q = questionById(ids[index]);

    var html = "";
    html += '<div class="q-progress"><span>第 ' + (index + 1) + " / " + ids.length + " 题</span>" +
      '<span>原题号 #' + q.id + "</span></div>";

    html += '<div class="q-card">';
    html += '<span class="q-num-badge">Q' + q.id + "</span>";
    if (q.multiple) html += '<span class="q-multi-badge">多选</span>';
    html += bilingualBlock(q.stem.zh, q.stem.en, { primaryClass: "q-stem", secondaryClass: "q-stem secondary" });

    html += '<div class="opt-list">';
    q.options.zh.forEach(function (optZh, i) {
      var optEn = q.options.en[i];
      var isCorrect = q.correct.indexOf(optZh.label) !== -1;
      html += '<div class="opt-item' + (isCorrect ? " correct" : "") + '">' +
        '<div class="opt-mark">' + optZh.label + "</div>" +
        '<div class="opt-text">' + bilingualInline(optZh.text, optEn.text) + "</div>" +
        "</div>";
    });
    html += "</div>";

    html += '<div class="explain-box"><div class="explain-title">解析</div>';
    html += bilingualBlock(q.explanation.zh || "（无）", q.explanation.en || "(none)", { primaryClass: "explain-text", secondaryClass: "explain-text secondary" });
    html += "</div>";
    html += "</div>";

    html += '<button class="btn-secondary btn-danger-outline" id="btn-remove-wrong">从错题本移除</button>';

    html += '<div class="nav-row">' +
      '<button class="btn-secondary" id="btn-prev" ' + (index === 0 ? "disabled" : "") + '>&#8592; 上一题</button>' +
      '<button class="btn-primary" id="btn-next" ' + (index === ids.length - 1 ? "disabled" : "") + '>下一题 &#8594;</button>' +
      "</div>";

    elApp.innerHTML = html;

    elApp.querySelector("#btn-remove-wrong").addEventListener("click", function () {
      removeFromWrongBook(q.id);
      var newIds = ids.filter(function (id) { return id !== q.id; });
      toast("已从错题本移除");
      if (newIds.length === 0) { replaceView("wrongbook"); return; }
      var newIndex = Math.min(index, newIds.length - 1);
      replaceView("wrongbook-review", { ids: newIds, index: newIndex });
    });

    var prevBtn = elApp.querySelector("#btn-prev");
    if (prevBtn) prevBtn.addEventListener("click", function () {
      if (index > 0) replaceView("wrongbook-review", { ids: ids, index: index - 1 });
    });
    var nextBtn = elApp.querySelector("#btn-next");
    if (nextBtn) nextBtn.addEventListener("click", function () {
      if (index < ids.length - 1) replaceView("wrongbook-review", { ids: ids, index: index + 1 });
    });
  }

  // ---------- Boot ----------
  applyFontScale();
  viewStack = [{ view: "home", opts: {} }];
  render();
})();

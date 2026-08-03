/* AI Practitioner题库 - mobile study app
 * Pure vanilla JS, no build step, works fully offline as a local file.
 */
(function () {
  "use strict";

  var ALL_QUESTIONS = window.QUESTIONS || [];
  var STORAGE_KEY = "aif_app_state_v1";

  // ---------- Exams ----------
  // Each exam is a distinct question bank the user can switch between from
  // the top bar. "exam" on a question record ties it to one of these ids.
  var EXAMS = [
    { id: "AIF-C01", name: "AWS Certified AI Practitioner", shortName: "AIF-C01" },
    { id: "AIP-C01", name: "AWS Certified Generative AI Developer – Professional", shortName: "AIP-C01" }
  ];
  var DEFAULT_EXAM_ID = "AIF-C01";

  function examById(id) {
    return EXAMS.find(function (e) { return e.id === id; }) || EXAMS[0];
  }

  // QUESTIONS/TOTAL are recomputed whenever the active exam changes (see
  // setExam below). Declared here so all existing code referencing them
  // keeps working without further changes.
  var QUESTIONS = [];
  var TOTAL = 0;
  function refreshExamQuestions() {
    var examId = state.exam || DEFAULT_EXAM_ID;
    QUESTIONS = ALL_QUESTIONS.filter(function (q) { return (q.exam || DEFAULT_EXAM_ID) === examId; });
    TOTAL = QUESTIONS.length;
  }

  var FONT_SCALES = [0.85, 1, 1.15, 1.3, 1.45];
  var FONT_LABELS = ["小", "标准", "大", "较大", "特大"];
  var DEFAULT_FONT_INDEX = 1;

  // ---------- Persistent state ----------
  var state = loadState();

  // Per-exam progress/wrongbook/etc, keyed by exam id. Global settings like
  // lang and fontIndex are shared across exams; study/quiz progress is not,
  // since question ids are only meaningful within their own exam's bank.
  function defaultExamState() {
    return {
      wrongIds: [],          // question ids ever answered wrong (current wrong book)
      progress: {},          // id -> { attempted: bool, correct: bool }
      quizSeqCursor: 1,      // next question id to start from for sequential quizzes
      studyProgress: null    // { ids: [...], index: N } - last study mode position
    };
  }

  function loadState() {
    var defaults = {
      lang: "both",          // 'zh' | 'en' | 'both'
      fontIndex: DEFAULT_FONT_INDEX, // index into FONT_SCALES
      exam: DEFAULT_EXAM_ID,  // currently selected exam id
      examState: {}           // exam id -> defaultExamState() shape
    };
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaults;
      var parsed = JSON.parse(raw);
      var merged = Object.assign(defaults, parsed);
      if (!merged.examState) merged.examState = {};
      // Migration: versions before the multi-exam feature stored
      // wrongIds/progress/quizSeqCursor/studyProgress directly on the root
      // state object (there was only ever one exam, AIF-C01). If we see
      // any of those old flat fields and there's no migrated data for
      // AIF-C01 yet, move them into examState so existing users don't
      // lose their study/quiz progress and wrong book after this update.
      var hasOldFlatData = parsed && (parsed.wrongIds || parsed.progress || parsed.quizSeqCursor || parsed.studyProgress);
      if (hasOldFlatData && !merged.examState[DEFAULT_EXAM_ID]) {
        merged.examState[DEFAULT_EXAM_ID] = {
          wrongIds: parsed.wrongIds || [],
          progress: parsed.progress || {},
          quizSeqCursor: parsed.quizSeqCursor || 1,
          studyProgress: parsed.studyProgress || null
        };
      }
      // Clean up the stale root-level copies now that they've been (or
      // never needed to be) migrated, so they don't shadow anything later.
      delete merged.wrongIds;
      delete merged.progress;
      delete merged.quizSeqCursor;
      delete merged.studyProgress;
      return merged;
    } catch (e) {
      return defaults;
    }
  }

  // Returns (creating if needed) the per-exam state bucket for the
  // currently active exam.
  function currentExamState() {
    var examId = state.exam || DEFAULT_EXAM_ID;
    if (!state.examState[examId]) {
      state.examState[examId] = defaultExamState();
    }
    return state.examState[examId];
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) { /* ignore quota errors */ }
  }

  function markWrong(id) {
    var es = currentExamState();
    if (es.wrongIds.indexOf(id) === -1) es.wrongIds.push(id);
    es.progress[id] = { attempted: true, correct: false };
    saveState();
  }
  function markCorrect(id) {
    var es = currentExamState();
    var idx = es.wrongIds.indexOf(id);
    if (idx !== -1) es.wrongIds.splice(idx, 1);
    es.progress[id] = { attempted: true, correct: true };
    saveState();
  }
  function clearWrongBook() {
    currentExamState().wrongIds = [];
    saveState();
  }
  function removeFromWrongBook(id) {
    var es = currentExamState();
    var idx = es.wrongIds.indexOf(id);
    if (idx !== -1) es.wrongIds.splice(idx, 1);
    saveState();
  }
  function isInWrongBook(id) {
    return currentExamState().wrongIds.indexOf(id) !== -1;
  }
  function toggleWrongBook(id) {
    var es = currentExamState();
    var idx = es.wrongIds.indexOf(id);
    if (idx !== -1) {
      es.wrongIds.splice(idx, 1);
      saveState();
      return false;
    }
    es.wrongIds.push(id);
    saveState();
    return true;
  }
  function saveStudyProgress(ids, index) {
    currentExamState().studyProgress = { ids: ids, index: index };
    saveState();
  }
  function tryResumeStudy() {
    var sp = currentExamState().studyProgress;
    if (!sp || !Array.isArray(sp.ids) || sp.ids.length === 0) return null;
    var validIds = sp.ids.filter(function (id) { return !!questionById(id); });
    if (validIds.length === 0) return null;
    var idx = Math.min(sp.index || 0, validIds.length - 1);
    return { ids: validIds, index: idx };
  }
  function setExam(examId) {
    if (state.exam === examId) return;
    state.exam = examId;
    saveState();
    refreshExamQuestions();
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

  // ---------- Exam switcher ----------
  var elBtnExamSwitch = document.getElementById("btn-exam-switch");
  var elExamSwitchLabel = document.getElementById("exam-switch-label");

  function updateExamLabel() {
    elExamSwitchLabel.textContent = examById(state.exam || DEFAULT_EXAM_ID).shortName;
  }

  function openExamSwitchPanel() {
    if (elOverlayRoot.querySelector(".exam-panel")) return;
    var backdrop = document.createElement("div");
    backdrop.className = "overlay-backdrop";
    backdrop.addEventListener("click", closeExamSwitchPanel);

    var panel = document.createElement("div");
    panel.className = "font-size-panel exam-panel";
    panel.addEventListener("click", function (e) { e.stopPropagation(); });

    var activeExamId = state.exam || DEFAULT_EXAM_ID;
    var html = '<div class="fsp-title">选择考试</div><div class="exam-option-list">';
    EXAMS.forEach(function (exam) {
      var count = ALL_QUESTIONS.filter(function (q) { return (q.exam || DEFAULT_EXAM_ID) === exam.id; }).length;
      var isActive = exam.id === activeExamId;
      html += '<button class="exam-option' + (isActive ? " active" : "") + '" data-exam-id="' + exam.id + '">' +
        '<div class="exam-option-main">' +
        '<div class="exam-option-name">' + escapeHtml(exam.name) + "</div>" +
        '<div class="exam-option-sub">' + escapeHtml(exam.shortName) + " · " + count + " 题</div>" +
        "</div>" +
        (isActive ? '<div class="exam-option-check">&#10003;</div>' : "") +
        "</button>";
    });
    html += "</div>";
    panel.innerHTML = html;

    elOverlayRoot.appendChild(backdrop);
    elOverlayRoot.appendChild(panel);

    panel.querySelectorAll(".exam-option").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var examId = btn.getAttribute("data-exam-id");
        closeExamSwitchPanel();
        if (examId !== (state.exam || DEFAULT_EXAM_ID)) {
          setExam(examId);
          updateExamLabel();
          goHome();
          toast("已切换到 " + examById(examId).shortName);
        }
      });
    });
  }
  function closeExamSwitchPanel() {
    var backdrop = elOverlayRoot.querySelector(".overlay-backdrop");
    var panel = elOverlayRoot.querySelector(".exam-panel");
    if (backdrop) backdrop.remove();
    if (panel) panel.remove();
  }

  elBtnExamSwitch.addEventListener("click", openExamSwitchPanel);

  // ---------- App update banner ----------
  // Called by index.html's service worker registration code when a new
  // version has been installed and is ready to activate.
  window.__showUpdateBanner = function (registration) {
    if (document.getElementById("update-banner")) return;
    var bar = document.createElement("div");
    bar.id = "update-banner";
    bar.className = "update-banner";
    bar.innerHTML =
      '<span class="update-banner-text">发现新版本</span>' +
      '<button class="update-banner-btn" id="update-banner-btn">立即更新</button>';
    document.body.appendChild(bar);
    requestAnimationFrame(function () { bar.classList.add("show"); });

    document.getElementById("update-banner-btn").addEventListener("click", function () {
      if (registration.waiting) {
        registration.waiting.postMessage("SKIP_WAITING");
      }
      bar.querySelector(".update-banner-btn").textContent = "更新中…";
    });
  };

  // Question ids are not guaranteed to be a contiguous 1..TOTAL range once
  // multiple exams share the same underlying array (e.g. AIP-C01 ids start
  // at 503, not 1). These helpers give the real min/max id for the exam
  // that's currently active, used for input bounds and validation.
  function examMinId() {
    return QUESTIONS.reduce(function (min, q) { return Math.min(min, q.id); }, Infinity);
  }
  function examMaxId() {
    return QUESTIONS.reduce(function (max, q) { return Math.max(max, q.id); }, -Infinity);
  }

  // ---------- Jump-to-question panel (reused by study mode progress bar) ----------
  // The panel is display-number-facing: users type the number printed on
  // the question card (Q1, Q2, ... which may skip a few values for exams
  // like AIP-C01 where some source questions were dropped), not the
  // internal id used for storage/lookup. We resolve the typed display
  // number back to the matching question's internal id before jumping.
  function openJumpPanel(onJump) {
    if (elOverlayRoot.querySelector(".jump-panel")) return;
    var minNum = QUESTIONS.reduce(function (min, q) { return Math.min(min, displayQNum(q)); }, Infinity);
    var maxNum = QUESTIONS.reduce(function (max, q) { return Math.max(max, displayQNum(q)); }, -Infinity);
    var backdrop = document.createElement("div");
    backdrop.className = "overlay-backdrop";
    backdrop.addEventListener("click", closeJumpPanel);

    var panel = document.createElement("div");
    panel.className = "font-size-panel jump-panel";
    panel.addEventListener("click", function (e) { e.stopPropagation(); });

    panel.innerHTML =
      '<div class="fsp-title">跳转到题目</div>' +
      '<div class="jump-row">' +
      '<input type="number" id="jump-input" class="num-input" min="' + minNum + '" max="' + maxNum + '" placeholder="' + minNum + '-' + maxNum + '" />' +
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
      var target = QUESTIONS.find(function (q) { return displayQNum(q) === val; });
      if (!val || !target) {
        toast("请输入 " + minNum + "-" + maxNum + " 之间的题号");
        return;
      }
      closeJumpPanel();
      onJump(target.id);
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
    if (view === "study") { goToStudy(); return; }
    if (view === "quiz") { viewStack = [{ view: "home", opts: {} }, { view: "quiz-setup", opts: {} }]; render(); return; }
    if (view === "wrongbook") { viewStack = [{ view: "home", opts: {} }, { view: "wrongbook", opts: {} }]; render(); return; }
  });

  // Opens study mode: resumes the last saved position automatically if one
  // exists, otherwise shows the setup screen for a first-time start.
  function goToStudy() {
    var resume = tryResumeStudy();
    if (resume) {
      viewStack = [{ view: "home", opts: {} }, { view: "study", opts: resume }];
    } else {
      viewStack = [{ view: "home", opts: {} }, { view: "study-setup", opts: {} }];
    }
    render();
  }

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

  // Display-facing question number. Most questions use their internal id
  // directly, but some (e.g. AIP-C01, whose ids were renumbered to a shared
  // 503+ range because a few source questions were skipped) carry an
  // explicit "num" field with the original source question number, which
  // should be shown instead so it lines up with the source material.
  function displayQNum(q) {
    return (q && q.num != null) ? q.num : q.id;
  }

  // ---------- Question type helpers ----------
  // qtype is omitted for regular single/multi-choice questions ("choice").
  // "matching" and "ordering" are special AWS Skill Builder question types.
  function isMatchingType(q) { return q.qtype === "matching"; }
  function isOrderingType(q) { return q.qtype === "ordering"; }
  function isChoiceType(q) { return !isMatchingType(q) && !isOrderingType(q); }

  function matchingAnswerChoices(q) {
    var seen = {};
    var arr = [];
    q.pairs.forEach(function (p) {
      var key = p.answer.zh;
      if (!seen[key]) {
        seen[key] = true;
        arr.push(p.answer);
      }
    });
    return arr;
  }

  function arraysEqualInOrder(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  // Generic correctness check across all question types. userAnswer format:
  // choice    -> array of selected option labels
  // matching  -> array of selected answer .zh strings, parallel to q.pairs
  // ordering  -> array of item .zh strings in the user's chosen order
  function isAnswerCorrect(q, userAnswer) {
    if (isMatchingType(q)) {
      if (!userAnswer) return false;
      return q.pairs.every(function (p, i) { return userAnswer[i] === p.answer.zh; });
    }
    if (isOrderingType(q)) {
      var correctOrder = q.items.map(function (it) { return it.zh; });
      return arraysEqualInOrder(userAnswer, correctOrder);
    }
    return arraysEqualAsSets(userAnswer || [], q.correct.split(""));
  }

  function questionTypeBadge(q) {
    if (isMatchingType(q)) return '<span class="q-multi-badge">配对题</span>';
    if (isOrderingType(q)) return '<span class="q-multi-badge">排序题</span>';
    if (q.multiple) return '<span class="q-multi-badge">多选</span>';
    return "";
  }

  // Read-only reveal of the correct answer, used in study mode and wrongbook
  // review where there's no interactive answering, just the answer shown.
  function renderAnswerReveal(q) {
    if (isMatchingType(q)) {
      var html = '<div class="match-list">';
      q.pairs.forEach(function (p) {
        html += '<div class="match-row">' +
          '<div class="match-statement">' + bilingualInline(p.statement.zh, p.statement.en) + "</div>" +
          '<div class="match-arrow">&#8594;</div>' +
          '<div class="match-answer correct">' + bilingualInline(p.answer.zh, p.answer.en) + "</div>" +
          "</div>";
      });
      html += "</div>";
      return html;
    }
    if (isOrderingType(q)) {
      var html2 = '<div class="order-list">';
      q.items.forEach(function (it, i) {
        html2 += '<div class="order-row correct">' +
          '<div class="order-num">' + (i + 1) + "</div>" +
          '<div class="order-text">' + bilingualInline(it.zh, it.en) + "</div>" +
          "</div>";
      });
      html2 += "</div>";
      return html2;
    }
    // choice type
    var html3 = '<div class="opt-list">';
    q.options.zh.forEach(function (optZh, i) {
      var optEn = q.options.en[i];
      var isCorrect = q.correct.indexOf(optZh.label) !== -1;
      html3 += '<div class="opt-item' + (isCorrect ? " correct" : "") + '">' +
        '<div class="opt-mark">' + optZh.label + "</div>" +
        '<div class="opt-text">' + bilingualInline(optZh.text, optEn.text) + "</div>" +
        "</div>";
    });
    html3 += "</div>";
    return html3;
  }

  // ---------- Interactive answer areas for quiz mode ----------
  function renderChoiceAnswerArea(q, userAnswer, isSubmitted) {
    var selected = userAnswer || [];
    var html = '<div class="opt-list">';
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
    return html;
  }
  function bindChoiceEvents(q, answers, rerender) {
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
        rerender();
      });
    });
  }

  // Matching: user picks an answer choice for each statement via a dropdown-
  // like tap-to-select chip list per row.
  function renderMatchingAnswerArea(q, userAnswer, isSubmitted) {
    var choices = matchingAnswerChoices(q);
    var sel = userAnswer || q.pairs.map(function () { return null; });
    var html = '<div class="match-list">';
    q.pairs.forEach(function (p, i) {
      var picked = sel[i];
      var isRowCorrect = isSubmitted && picked === p.answer.zh;
      var isRowWrong = isSubmitted && picked !== p.answer.zh;
      html += '<div class="match-qrow">';
      html += '<div class="match-statement">' + bilingualInline(p.statement.zh, p.statement.en) + "</div>";
      html += '<div class="match-choice-list">';
      choices.forEach(function (choice) {
        var isPicked = picked === choice.zh;
        var classes = ["match-choice"];
        if (!isSubmitted) {
          if (isPicked) classes.push("selected");
        } else {
          var isCorrectChoice = choice.zh === p.answer.zh;
          if (isCorrectChoice) classes.push("correct");
          else if (isPicked) classes.push("incorrect");
        }
        html += '<button class="' + classes.join(" ") + '"' + (isSubmitted ? " disabled" : "") +
          ' data-row="' + i + '" data-choice="' + escapeHtml(choice.zh) + '">' +
          bilingualInline(choice.zh, choice.en) + "</button>";
      });
      html += "</div>";
      if (isSubmitted && isRowWrong) {
        html += '<div class="match-correct-hint">正确答案: ' + bilingualInline(p.answer.zh, p.answer.en) + "</div>";
      }
      html += "</div>";
    });
    html += "</div>";
    return html;
  }
  function bindMatchingEvents(q, answers, rerender) {
    if (!answers[q.id]) answers[q.id] = q.pairs.map(function () { return null; });
    elApp.querySelectorAll(".match-choice:not([disabled])").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var row = parseInt(btn.getAttribute("data-row"), 10);
        var choiceZh = btn.getAttribute("data-choice");
        answers[q.id][row] = choiceZh;
        rerender();
      });
    });
  }

  // Ordering: user builds a sequence by tapping items in the desired order;
  // tapping a chosen item again removes it so they can re-pick.
  function renderOrderingAnswerArea(q, userAnswer, isSubmitted) {
    var chosen = userAnswer || [];
    var correctOrder = q.items.map(function (it) { return it.zh; });
    var html = "";

    if (isSubmitted) {
      html += '<div class="order-list">';
      chosen.forEach(function (zh, i) {
        var item = q.items.find(function (it) { return it.zh === zh; });
        var isRight = correctOrder[i] === zh;
        html += '<div class="order-row' + (isRight ? " correct" : " incorrect") + '">' +
          '<div class="order-num">' + (i + 1) + "</div>" +
          '<div class="order-text">' + bilingualInline(item.zh, item.en) + "</div>" +
          "</div>";
      });
      html += "</div>";
      html += '<div class="order-correct-hint"><div class="explain-title">正确顺序</div><div class="order-list">';
      q.items.forEach(function (it, i) {
        html += '<div class="order-row correct">' +
          '<div class="order-num">' + (i + 1) + "</div>" +
          '<div class="order-text">' + bilingualInline(it.zh, it.en) + "</div>" +
          "</div>";
      });
      html += "</div></div>";
      return html;
    }

    html += '<div class="order-progress-list">';
    if (chosen.length === 0) {
      html += '<div class="order-placeholder">点击下方选项，按顺序添加</div>';
    } else {
      chosen.forEach(function (zh, i) {
        var item = q.items.find(function (it) { return it.zh === zh; });
        html += '<div class="order-row selected" data-chosen-index="' + i + '">' +
          '<div class="order-num">' + (i + 1) + "</div>" +
          '<div class="order-text">' + bilingualInline(item.zh, item.en) + "</div>" +
          '<div class="order-remove">&#10005;</div>' +
          "</div>";
      });
    }
    html += "</div>";

    html += '<div class="order-bank">';
    q.items.forEach(function (it) {
      var isChosen = chosen.indexOf(it.zh) !== -1;
      if (isChosen) return;
      html += '<button class="order-bank-item" data-item="' + escapeHtml(it.zh) + '">' +
        bilingualInline(it.zh, it.en) + "</button>";
    });
    html += "</div>";
    return html;
  }
  function bindOrderingEvents(q, answers, rerender) {
    if (!answers[q.id]) answers[q.id] = [];
    elApp.querySelectorAll(".order-bank-item").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var itemZh = btn.getAttribute("data-item");
        answers[q.id].push(itemZh);
        rerender();
      });
    });
    elApp.querySelectorAll(".order-row.selected").forEach(function (row) {
      row.addEventListener("click", function () {
        var idx = parseInt(row.getAttribute("data-chosen-index"), 10);
        answers[q.id].splice(idx, 1);
        rerender();
      });
    });
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
    home: "AI Practitioner题库",
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
    closeExamSwitchPanel();
    var top = viewStack[viewStack.length - 1];
    elBtnBack.hidden = viewStack.length <= 1;
    elTopTitle.textContent = VIEW_TITLES[top.view] || "AI Practitioner题库";
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
    var es = currentExamState();
    var attemptedIds = Object.keys(es.progress);
    var correctCount = attemptedIds.filter(function (id) { return es.progress[id].correct; }).length;
    var wrongCount = es.wrongIds.length;
    var exam = examById(state.exam || DEFAULT_EXAM_ID);

    var html = "";
    html += '<div class="home-hero"><h2>' + escapeHtml(exam.name) + "</h2>" +
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
      var resume = tryResumeStudy();
      if (resume) navigate("study", resume);
      else navigate("study-setup");
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
    var resume = tryResumeStudy();
    var html = "";

    if (resume) {
      var resumeQ = questionById(resume.ids[resume.index]);
      html += '<div class="section-title">继续上次学习</div>';
      html += '<div class="setup-group">' +
        setupRow("上次进度", "第 " + (resume.index + 1) + " / " + resume.ids.length + " 题 · 原题号 #" + displayQNum(resumeQ), "") +
        "</div>";
      html += '<button class="btn-primary" id="btn-resume-study">继续背题</button>';
    }

    // The "start from question #" input is display-number-facing (matches
    // the number printed on the card), not the internal id. For exams
    // where a few source questions were dropped (e.g. AIP-C01), display
    // numbers have gaps while ids stay contiguous, so these ranges differ.
    var minNum = QUESTIONS.reduce(function (min, q) { return Math.min(min, displayQNum(q)); }, Infinity);
    var maxNum = QUESTIONS.reduce(function (max, q) { return Math.max(max, displayQNum(q)); }, -Infinity);

    html += '<div class="section-title">重新开始</div>';
    html += '<div class="setup-group">' +
      setupRow("从第几题开始", "题号范围 " + minNum + "-" + maxNum, '<input type="number" id="study-start" class="num-input" min="' + minNum + '" max="' + maxNum + '" value="' + minNum + '" />') +
      setupRow("顺序", "", chipGroup("study-order", [["seq", "顺序"], ["random", "随机"]], "seq")) +
      "</div>";

    html += '<button class="' + (resume ? "btn-secondary" : "btn-primary") + '" id="btn-start-study">开始背题</button>';

    elApp.innerHTML = html;
    bindChipGroups(elApp);

    var resumeBtn = elApp.querySelector("#btn-resume-study");
    if (resumeBtn) resumeBtn.addEventListener("click", function () {
      replaceView("study", { ids: resume.ids, index: resume.index });
    });

    elApp.querySelector("#btn-start-study").addEventListener("click", function () {
      var startNum = parseInt(elApp.querySelector("#study-start").value, 10) || minNum;
      startNum = Math.min(Math.max(startNum, minNum), maxNum);
      // Resolve the typed display number to the closest question at or
      // after it (in display-number order), in case the exact number was
      // skipped in the source material.
      var sortedByNum = QUESTIONS.slice().sort(function (a, b) { return displayQNum(a) - displayQNum(b); });
      var startQ = sortedByNum.find(function (q) { return displayQNum(q) >= startNum; }) || sortedByNum[0];
      var startId = startQ.id;
      var order = getChipValue(elApp, "study-order");
      var ids = sortedByNum.map(function (q) { return q.id; });
      if (order === "random") {
        ids = shuffle(ids);
      } else {
        ids = ids.filter(function (id) { return id >= startId; }).concat(ids.filter(function (id) { return id < startId; }));
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

    saveStudyProgress(ids, index);

    var inWrongBook = isInWrongBook(q.id);

    var html = "";
    html += '<div class="q-progress"><button class="q-progress-jump" id="btn-jump-progress">第 ' + (index + 1) + " / " + ids.length + " 题 &#9998;</button>" +
      '<span>原题号 #' + displayQNum(q) + "</span></div>";

    html += '<div class="q-card">';
    html += '<span class="q-num-badge">Q' + displayQNum(q) + "</span>";
    html += questionTypeBadge(q);
    html += bilingualBlock(q.stem.zh, q.stem.en, { primaryClass: "q-stem", secondaryClass: "q-stem secondary" });

    html += renderAnswerReveal(q);

    html += '<div class="explain-box"><div class="explain-title">解析</div>';
    html += bilingualBlock(q.explanation.zh || "（无）", q.explanation.en || "(none)", { primaryClass: "explain-text", secondaryClass: "explain-text secondary" });
    html += "</div>";
    html += "</div>";

    html += '<button class="btn-secondary mark-wrong-btn' + (inWrongBook ? " active" : "") + '" id="btn-toggle-wrong">' +
      (inWrongBook ? "&#10003; 已加入错题本" : "&#9888; 标记为错题") +
      "</button>";

    html += '<div class="nav-row">' +
      '<button class="btn-secondary" id="btn-prev" ' + (index === 0 ? "disabled" : "") + '>&#8592; 上一题</button>' +
      '<button class="btn-primary" id="btn-next" ' + (index === ids.length - 1 ? "disabled" : "") + '>下一题 &#8594;</button>' +
      "</div>";

    html += '<button class="btn-secondary" id="btn-restart-study">重新设置背题范围</button>';

    elApp.innerHTML = html;

    var prevBtn = elApp.querySelector("#btn-prev");
    var nextBtn = elApp.querySelector("#btn-next");
    if (prevBtn) prevBtn.addEventListener("click", function () {
      if (index > 0) replaceView("study", { ids: ids, index: index - 1 });
    });
    if (nextBtn) nextBtn.addEventListener("click", function () {
      if (index < ids.length - 1) replaceView("study", { ids: ids, index: index + 1 });
    });

    var restartBtn = elApp.querySelector("#btn-restart-study");
    if (restartBtn) restartBtn.addEventListener("click", function () {
      navigate("study-setup");
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

    var toggleWrongBtn = elApp.querySelector("#btn-toggle-wrong");
    if (toggleWrongBtn) toggleWrongBtn.addEventListener("click", function () {
      var added = toggleWrongBook(q.id);
      toast(added ? "已加入错题本" : "已从错题本移除");
      replaceView("study", { ids: ids, index: index });
    });
  }

  // ---- Quiz setup ----
  function renderQuizSetup() {
    var minId = examMinId();
    var maxId = examMaxId();
    var resumeId = clampSeqCursor(currentExamState().quizSeqCursor, minId, maxId);
    // "顺序起始题号" is display-number-facing, same reasoning as study setup.
    var sortedByNumSetup = QUESTIONS.slice().sort(function (a, b) { return displayQNum(a) - displayQNum(b); });
    var minNum = displayQNum(sortedByNumSetup[0]);
    var maxNum = displayQNum(sortedByNumSetup[sortedByNumSetup.length - 1]);
    var resumeQForSeq = questionById(resumeId);
    var resumeNum = resumeQForSeq ? displayQNum(resumeQForSeq) : minNum;
    var html = "";
    html += '<div class="section-title">测试设置</div>';
    html += '<div class="setup-group">' +
      setupRow("题目范围", "", chipGroup("quiz-scope", [["all", "全部题库"], ["custom", "自定义数量"]], "all")) +
      setupRow("题目数量", "范围: 5-" + TOTAL, '<input type="number" id="quiz-count" class="num-input" min="5" max="' + TOTAL + '" value="20" />') +
      setupRow("题目顺序", "", chipGroup("quiz-order", [["random", "随机"], ["seq", "顺序"]], "random")) +
      '<div class="setup-row" id="quiz-seq-start-row"><div><div class="lbl">顺序起始题号</div>' +
      '<div class="sub">顺序模式将从此题号接续开始</div></div>' +
      '<input type="number" id="quiz-seq-start" class="num-input" min="' + minNum + '" max="' + maxNum + '" value="' + resumeNum + '" /></div>' +
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

    var seqStartInput = elApp.querySelector("#quiz-seq-start");
    var seqStartRow = elApp.querySelector("#quiz-seq-start-row");
    var orderGroup = elApp.querySelector('[data-chip-group="quiz-order"]');
    function syncSeqStartVisibility() {
      var order = getChipValue(elApp, "quiz-order");
      seqStartRow.style.display = order === "seq" ? "" : "none";
    }
    orderGroup.addEventListener("click", syncSeqStartVisibility);
    syncSeqStartVisibility();

    elApp.querySelector("#btn-start-quiz").addEventListener("click", function () {
      var scope = getChipValue(elApp, "quiz-scope");
      var order = getChipValue(elApp, "quiz-order");
      var ids = QUESTIONS.map(function (q) { return q.id; });
      var isSeq = order === "seq";
      if (isSeq) {
        var startNumVal = parseInt(seqStartInput.value, 10) || minNum;
        startNumVal = Math.min(Math.max(startNumVal, minNum), maxNum);
        // Resolve the typed display number to the closest question at or
        // after it, in case the exact number was skipped in the source.
        var startQSetup = sortedByNumSetup.find(function (q) { return displayQNum(q) >= startNumVal; }) || sortedByNumSetup[0];
        var startId = startQSetup.id;
        currentExamState().quizSeqCursor = startId;
        saveState();
        // Resume sequential order (by display number) from the chosen question.
        ids = sortedByNumSetup.map(function (q) { return q.id; });
        ids = ids.filter(function (id) { return id >= startId; }).concat(ids.filter(function (id) { return id < startId; }));
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

  function clampSeqCursor(id, minId, maxId) {
    if (minId === undefined) minId = examMinId();
    if (maxId === undefined) maxId = examMaxId();
    if (!id || id < minId || id > maxId) return minId;
    return id;
  }
  function advanceSeqCursor(id) {
    var minId = examMinId();
    var maxId = examMaxId();
    var next = id + 1;
    if (next > maxId) next = minId;
    currentExamState().quizSeqCursor = next;
    saveState();
  }

  // Whether the user has provided a complete answer, ready to submit.
  function isAnswerComplete(q, userAnswer) {
    if (isMatchingType(q)) {
      return !!userAnswer && userAnswer.length === q.pairs.length &&
        userAnswer.every(function (v) { return !!v; });
    }
    if (isOrderingType(q)) {
      return !!userAnswer && userAnswer.length === q.items.length;
    }
    return !!userAnswer && userAnswer.length > 0;
  }

  // ---- Quiz mode ----
  function renderQuiz(opts) {
    var ids = opts.ids;
    var index = opts.index;
    var answers = opts.answers; // id -> answer (format depends on question type)
    var submitted = opts.submitted; // id -> true/false
    var isSeq = !!opts.seq;

    var q = questionById(ids[index]);
    var userAnswer = answers[q.id];
    var isSubmitted = !!submitted[q.id];

    var html = "";
    html += '<div class="q-progress"><span>第 ' + (index + 1) + " / " + ids.length + " 题</span>" +
      '<span>原题号 #' + displayQNum(q) + "</span></div>";

    html += '<div class="q-card">';
    html += '<span class="q-num-badge">Q' + displayQNum(q) + "</span>";
    html += questionTypeBadge(q);
    html += bilingualBlock(q.stem.zh, q.stem.en, { primaryClass: "q-stem", secondaryClass: "q-stem secondary" });

    if (isMatchingType(q)) {
      html += renderMatchingAnswerArea(q, userAnswer, isSubmitted);
    } else if (isOrderingType(q)) {
      html += renderOrderingAnswerArea(q, userAnswer, isSubmitted);
    } else {
      html += renderChoiceAnswerArea(q, userAnswer, isSubmitted);
    }

    if (!isSubmitted) {
      html += '<button class="btn-primary" id="btn-submit-answer"' + (!isAnswerComplete(q, userAnswer) ? " disabled" : "") + ">提交答案</button>";
    } else {
      var userCorrect = isAnswerCorrect(q, userAnswer);
      html += '<div class="result-banner ' + (userCorrect ? "correct" : "incorrect") + '">' +
        (userCorrect ? "&#10003; 回答正确" : "&#10007; 回答错误") +
        "</div>";
      html += '<div class="explain-box"><div class="explain-title">解析</div>';
      html += bilingualBlock(q.explanation.zh || "（无）", q.explanation.en || "(none)", { primaryClass: "explain-text", secondaryClass: "explain-text secondary" });
      html += "</div>";
    }
    html += "</div>";

    if (isSubmitted) {
      var inWrongBookQuiz = isInWrongBook(q.id);
      html += '<button class="btn-secondary mark-wrong-btn' + (inWrongBookQuiz ? " active" : "") + '" id="btn-toggle-wrong">' +
        (inWrongBookQuiz ? "&#10003; 已加入错题本" : "&#9888; 标记为错题") +
        "</button>";
    }

    html += '<div class="nav-row">';
    html += '<button class="btn-secondary" id="btn-prev" ' + (index === 0 ? "disabled" : "") + '>&#8592; 上一题</button>';
    if (index === ids.length - 1) {
      html += '<button class="btn-primary" id="btn-finish"' + (!allSubmitted(ids, submitted) ? " disabled" : "") + ">完成测试</button>";
    } else {
      html += '<button class="btn-primary" id="btn-next"' + (!isSubmitted ? " disabled" : "") + ">下一题 &#8594;</button>";
    }
    html += "</div>";

    elApp.innerHTML = html;

    function rerender() {
      replaceView("quiz", { ids: ids, index: index, answers: answers, submitted: submitted, seq: isSeq });
    }

    if (!isSubmitted) {
      if (isMatchingType(q)) {
        bindMatchingEvents(q, answers, rerender);
      } else if (isOrderingType(q)) {
        bindOrderingEvents(q, answers, rerender);
      } else {
        bindChoiceEvents(q, answers, rerender);
      }

      var submitBtn = elApp.querySelector("#btn-submit-answer");
      if (submitBtn) submitBtn.addEventListener("click", function () {
        submitted[q.id] = true;
        var isRight = isAnswerCorrect(q, answers[q.id]);
        if (isRight) markCorrect(q.id); else markWrong(q.id);
        if (isSeq) advanceSeqCursor(q.id);
        rerender();
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
    var toggleWrongBtn = elApp.querySelector("#btn-toggle-wrong");
    if (toggleWrongBtn) toggleWrongBtn.addEventListener("click", function () {
      var added = toggleWrongBook(q.id);
      toast(added ? "已加入错题本" : "已从错题本移除");
      replaceView("quiz", { ids: ids, index: index, answers: answers, submitted: submitted, seq: isSeq });
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
      var isRight = isAnswerCorrect(q, answers[id]);
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
    var ids = currentExamState().wrongIds.slice();
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
      '<span>原题号 #' + displayQNum(q) + "</span></div>";

    html += '<div class="q-card">';
    html += '<span class="q-num-badge">Q' + displayQNum(q) + "</span>";
    html += questionTypeBadge(q);
    html += bilingualBlock(q.stem.zh, q.stem.en, { primaryClass: "q-stem", secondaryClass: "q-stem secondary" });

    html += renderAnswerReveal(q);

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
  refreshExamQuestions();
  applyFontScale();
  updateExamLabel();
  viewStack = [{ view: "home", opts: {} }];
  render();
})();

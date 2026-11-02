(() => {
  "use strict";

  const CONFIG = {
    durationSeconds: 80,
    targetScore: 10,
    maxLives: 5,
    holeColumns: [31.8, 50, 68.2],
    holeRows: [48.3, 62.5, 76.7],
    phases: [
      { maxScore: 3, label: "暖身階段", minActive: 1, maxActive: 2, visibleMs: 2200, gapMs: 520, factors: [1, 5] },
      { maxScore: 6, label: "加速階段", minActive: 2, maxActive: 3, visibleMs: 1600, gapMs: 380, factors: [2, 8] },
      { maxScore: 9, label: "衝刺階段", minActive: 3, maxActive: 5, visibleMs: 1180, gapMs: 250, factors: [3, 9] },
    ],
  };

  const tutorialPages = [
    "歡迎來到乘法學園！準備好挑戰九九乘法了嗎？",
    "先看上方的算式，再找出舉著正確答案的卡皮巴拉。",
    "用滑鼠或手指敲下去！答錯會失去一顆橘子，總共有五顆。",
    "在 80 秒內答對 10 題就過關。越接近終點，卡皮巴拉會出現得越快喔！",
  ];

  const els = {
    mapScreen: document.querySelector("#map-screen"),
    gameScreen: document.querySelector("#game-screen"),
    portal: document.querySelector("#level-portal"),
    dialog: document.querySelector("#dialog"),
    dialogText: document.querySelector("#dialog-text"),
    dialogProgress: document.querySelector("#dialog-progress"),
    dialogNext: document.querySelector("#dialog-next"),
    dialogSkip: document.querySelector("#dialog-skip"),
    timer: document.querySelector("#timer"),
    question: document.querySelector("#question"),
    score: document.querySelector("#score"),
    lives: document.querySelector("#lives"),
    holes: document.querySelector("#holes"),
    stageLabel: document.querySelector("#stage-label"),
    feedback: document.querySelector("#feedback"),
    soundToggle: document.querySelector("#sound-toggle"),
    exitLevel: document.querySelector("#exit-level"),
    mallet: document.querySelector("#mallet-cursor"),
    countdown: document.querySelector("#countdown"),
    result: document.querySelector("#result"),
    resultIcon: document.querySelector("#result-icon"),
    resultTitle: document.querySelector("#result-title"),
    resultMessage: document.querySelector("#result-message"),
    retry: document.querySelector("#retry-button"),
    mapButton: document.querySelector("#map-button"),
  };

  const state = {
    tutorialIndex: 0,
    score: 0,
    lives: CONFIG.maxLives,
    question: null,
    previousQuestionKey: "",
    running: false,
    acceptingHits: false,
    muted: false,
    dialogMessageMode: false,
    deadline: 0,
    hiddenAt: 0,
    animationFrame: 0,
    waveTimer: 0,
    nextWaveTimer: 0,
    autoMapTimer: 0,
    audioContext: null,
    holes: [],
  };

  function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function shuffled(values) {
    const copy = [...values];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = randomInt(0, i);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function currentPhase() {
    return CONFIG.phases.find((phase) => state.score <= phase.maxScore) || CONFIG.phases.at(-1);
  }

  function buildHoles() {
    const fragment = document.createDocumentFragment();
    let index = 0;

    for (const y of CONFIG.holeRows) {
      for (const x of CONFIG.holeColumns) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "hole";
        button.style.setProperty("--hole-x", x);
        button.style.setProperty("--hole-y", y);
        button.dataset.index = String(index);
        button.setAttribute("aria-label", `第 ${index + 1} 個洞口`);

        const capy = document.createElement("img");
        capy.className = "hole__capy";
        capy.src = "assets/capy-normal.png";
        capy.alt = "";
        capy.draggable = false;

        const answer = document.createElement("span");
        answer.className = "answer-card";

        button.append(capy, answer);
        button.addEventListener("pointerdown", handleHoleHit);
        fragment.append(button);

        state.holes.push({ button, capy, answer, value: null, correct: false, active: false });
        index += 1;
      }
    }

    els.holes.append(fragment);
  }

  function renderTutorial() {
    els.dialogText.textContent = tutorialPages[state.tutorialIndex];
    els.dialogNext.textContent = state.tutorialIndex === tutorialPages.length - 1 ? "開始挑戰" : "下一步";
    els.dialogProgress.replaceChildren(
      ...tutorialPages.map((_, index) => {
        const dot = document.createElement("i");
        if (index === state.tutorialIndex) dot.className = "is-current";
        return dot;
      }),
    );
    els.dialog.classList.remove("is-hidden");
  }

  function advanceTutorial() {
    playTone("tap");
    if (state.tutorialIndex < tutorialPages.length - 1) {
      state.tutorialIndex += 1;
      renderTutorial();
      return;
    }
    beginGame();
  }

  function handleDialogNext() {
    if (state.dialogMessageMode) {
      openTutorial();
      return;
    }
    advanceTutorial();
  }

  function openTutorial() {
    state.dialogMessageMode = false;
    state.tutorialIndex = 0;
    renderTutorial();
  }

  function showMap(message = "") {
    clearTimeout(state.autoMapTimer);
    stopGame();
    els.result.hidden = true;
    els.gameScreen.classList.remove("is-active");
    els.gameScreen.setAttribute("aria-hidden", "true");
    els.mapScreen.classList.add("is-active");
    els.mapScreen.removeAttribute("aria-hidden");

    if (message) {
      state.dialogMessageMode = true;
      state.tutorialIndex = 0;
      els.dialogText.textContent = message;
      els.dialogNext.textContent = "再聽一次玩法";
      els.dialogProgress.replaceChildren();
      els.dialog.classList.remove("is-hidden");
    } else {
      openTutorial();
    }
  }

  async function beginGame() {
    clearTimeout(state.autoMapTimer);
    await ensureAudio();
    els.dialog.classList.add("is-hidden");
    els.mapScreen.classList.remove("is-active");
    els.mapScreen.setAttribute("aria-hidden", "true");
    els.gameScreen.classList.add("is-active");
    els.gameScreen.removeAttribute("aria-hidden");
    els.result.hidden = true;

    state.score = 0;
    state.lives = CONFIG.maxLives;
    state.question = null;
    state.previousQuestionKey = "";
    state.running = false;
    state.acceptingHits = false;
    renderHud();
    hideAllHoles();

    await runCountdown();
    state.running = true;
    state.deadline = performance.now() + CONFIG.durationSeconds * 1000;
    newQuestion();
    tickTimer();
    scheduleWave(80);
  }

  function runCountdown() {
    return new Promise((resolve) => {
      const values = ["3", "2", "1", "GO!"];
      let index = 0;
      els.countdown.classList.add("is-active");
      els.countdown.removeAttribute("aria-hidden");

      const showNext = () => {
        els.countdown.textContent = values[index];
        els.countdown.classList.remove("is-popping");
        void els.countdown.offsetWidth;
        els.countdown.classList.add("is-popping");
        playTone(index === values.length - 1 ? "correct" : "tap");
        index += 1;

        if (index < values.length) {
          setTimeout(showNext, 650);
        } else {
          setTimeout(() => {
            els.countdown.classList.remove("is-active", "is-popping");
            els.countdown.setAttribute("aria-hidden", "true");
            resolve();
          }, 620);
        }
      };

      showNext();
    });
  }

  function makeQuestion() {
    const phase = currentPhase();
    let a;
    let b;
    let key;

    do {
      a = randomInt(phase.factors[0], phase.factors[1]);
      b = randomInt(1, 9);
      key = `${a}x${b}`;
    } while (key === state.previousQuestionKey);

    state.previousQuestionKey = key;
    return { a, b, answer: a * b };
  }

  function newQuestion() {
    state.question = makeQuestion();
    els.question.textContent = `${state.question.a} × ${state.question.b} = ?`;
    els.stageLabel.textContent = currentPhase().label;
  }

  function makeDistractors(correct, count) {
    const { a, b } = state.question;
    const candidates = [
      correct + a,
      correct - a,
      correct + b,
      correct - b,
      (a + 1) * b,
      Math.max(1, (a - 1) * b),
      a * Math.min(9, b + 1),
      a * Math.max(1, b - 1),
      correct + randomInt(-9, 9),
    ];

    const unique = [];
    for (const value of shuffled(candidates)) {
      if (value >= 1 && value <= 81 && value !== correct && !unique.includes(value)) unique.push(value);
      if (unique.length === count) return unique;
    }

    while (unique.length < count) {
      const value = randomInt(1, 81);
      if (value !== correct && !unique.includes(value)) unique.push(value);
    }
    return unique;
  }

  function showWave() {
    if (!state.running) return;
    hideAllHoles();

    const phase = currentPhase();
    const activeCount = randomInt(phase.minActive, phase.maxActive);
    const activeIndexes = shuffled(state.holes.map((_, index) => index)).slice(0, activeCount);
    const correctIndex = activeIndexes[randomInt(0, activeIndexes.length - 1)];
    const distractors = makeDistractors(state.question.answer, activeCount - 1);
    let distractorIndex = 0;

    for (const index of activeIndexes) {
      const hole = state.holes[index];
      hole.correct = index === correctIndex;
      hole.value = hole.correct ? state.question.answer : distractors[distractorIndex++];
      hole.active = true;
      hole.capy.src = "assets/capy-normal.png";
      hole.answer.textContent = String(hole.value);
      hole.button.setAttribute("aria-label", `答案 ${hole.value}`);
      hole.button.classList.add("is-active");
    }

    state.acceptingHits = true;
    clearTimeout(state.waveTimer);
    state.waveTimer = setTimeout(() => {
      state.acceptingHits = false;
      hideAllHoles();
      scheduleWave(phase.gapMs);
    }, phase.visibleMs);
  }

  function scheduleWave(delay) {
    clearTimeout(state.nextWaveTimer);
    state.nextWaveTimer = setTimeout(showWave, delay);
  }

  function hideAllHoles() {
    for (const hole of state.holes) {
      hole.active = false;
      hole.correct = false;
      hole.value = null;
      hole.button.classList.remove("is-active", "is-hit");
      hole.button.setAttribute("aria-label", `第 ${Number(hole.button.dataset.index) + 1} 個洞口`);
      hole.capy.src = "assets/capy-normal.png";
      hole.answer.textContent = "";
    }
  }

  function handleHoleHit(event) {
    event.preventDefault();
    if (!state.running || !state.acceptingHits) return;

    const index = Number(event.currentTarget.dataset.index);
    const hole = state.holes[index];
    if (!hole?.active) return;

    state.acceptingHits = false;
    clearTimeout(state.waveTimer);
    swingMallet(event.clientX, event.clientY);
    hole.capy.src = "assets/capy-hit.png";
    hole.button.classList.add("is-hit");

    if (hole.correct) {
      state.score += 1;
      playTone("correct");
      showFeedback("答對了！", false);
      renderHud();

      if (state.score >= CONFIG.targetScore) {
        setTimeout(() => finishGame(true), 520);
        return;
      }

      setTimeout(() => {
        hideAllHoles();
        newQuestion();
        renderHud();
        scheduleWave(180);
      }, 500);
    } else {
      state.lives -= 1;
      playTone("wrong");
      showFeedback(`再想想！答案是 ${state.question.answer}`, true);
      renderHud();

      if (state.lives <= 0) {
        setTimeout(() => finishGame(false, "lives"), 650);
        return;
      }

      setTimeout(() => {
        hideAllHoles();
        scheduleWave(250);
      }, 620);
    }
  }

  function showFeedback(text, wrong) {
    els.feedback.textContent = text;
    els.feedback.classList.remove("is-showing", "is-wrong");
    void els.feedback.offsetWidth;
    if (wrong) els.feedback.classList.add("is-wrong");
    els.feedback.classList.add("is-showing");
  }

  function renderHud() {
    els.score.textContent = String(state.score);
    els.stageLabel.textContent = currentPhase().label;
    els.lives.replaceChildren(
      ...Array.from({ length: CONFIG.maxLives }, (_, index) => {
        const life = document.createElement("i");
        life.className = `life${index >= state.lives ? " is-lost" : ""}`;
        return life;
      }),
    );
    els.lives.setAttribute("aria-label", `剩餘 ${state.lives} 顆橘子`);
  }

  function tickTimer() {
    if (!state.running) return;
    const remainingMs = Math.max(0, state.deadline - performance.now());
    const remainingSeconds = Math.ceil(remainingMs / 1000);
    els.timer.textContent = String(remainingSeconds);

    if (remainingMs <= 0) {
      finishGame(false, "time");
      return;
    }
    state.animationFrame = requestAnimationFrame(tickTimer);
  }

  function finishGame(success, reason = "") {
    if (!state.running) return;
    stopGame();
    hideAllHoles();
    playTone(success ? "win" : "wrong");

    els.resultIcon.textContent = success ? "★" : "🍊";
    els.resultTitle.textContent = success ? "挑戰成功！" : "這次差一點！";
    els.resultMessage.textContent = success
      ? `你在時間內答對了 ${CONFIG.targetScore} 題，獲得九九乘法星星！`
      : reason === "time"
        ? `時間到了，這次答對 ${state.score} 題。卡皮老師在主地圖等你再來挑戰！`
        : `橘子用完了，這次答對 ${state.score} 題。慢慢算準再敲會更厲害！`;
    els.result.hidden = false;

    if (!success) {
      state.autoMapTimer = setTimeout(() => {
        showMap(`你已回到乘法學園。剛才答對 ${state.score} 題，再複習一下就能成功！`);
      }, 4200);
    }
  }

  function stopGame() {
    state.running = false;
    state.acceptingHits = false;
    clearTimeout(state.waveTimer);
    clearTimeout(state.nextWaveTimer);
    cancelAnimationFrame(state.animationFrame);
  }

  function swingMallet(clientX, clientY) {
    const bounds = els.gameScreen.getBoundingClientRect();
    els.mallet.style.left = `${clientX - bounds.left}px`;
    els.mallet.style.top = `${clientY - bounds.top}px`;
    els.mallet.classList.remove("is-swinging");
    void els.mallet.offsetWidth;
    els.mallet.classList.add("is-swinging");
  }

  function moveMallet(event) {
    const bounds = els.gameScreen.getBoundingClientRect();
    els.mallet.style.left = `${event.clientX - bounds.left}px`;
    els.mallet.style.top = `${event.clientY - bounds.top}px`;
  }

  async function ensureAudio() {
    if (state.audioContext || state.muted) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    state.audioContext = new AudioContext();
    if (state.audioContext.state === "suspended") await state.audioContext.resume();
  }

  function playTone(kind) {
    if (state.muted) return;
    ensureAudio().then(() => {
      const context = state.audioContext;
      if (!context) return;
      const recipes = {
        tap: [440],
        correct: [660, 880],
        wrong: [220, 165],
        win: [523, 659, 784, 1047],
      };
      const notes = recipes[kind] || recipes.tap;
      notes.forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const start = context.currentTime + index * 0.08;
        oscillator.type = kind === "wrong" ? "triangle" : "sine";
        oscillator.frequency.setValueAtTime(frequency, start);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.11, start + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.13);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(start);
        oscillator.stop(start + 0.15);
      });
    });
  }

  function toggleSound() {
    state.muted = !state.muted;
    els.soundToggle.setAttribute("aria-pressed", String(state.muted));
    els.soundToggle.setAttribute("aria-label", state.muted ? "開啟音效" : "關閉音效");
    els.soundToggle.querySelector("span").textContent = state.muted ? "×" : "♪";
    if (!state.muted) playTone("tap");
  }

  function attachEvents() {
    els.dialogNext.addEventListener("click", handleDialogNext);
    els.dialogSkip.addEventListener("click", beginGame);
    els.portal.addEventListener("click", openTutorial);
    els.retry.addEventListener("click", beginGame);
    els.mapButton.addEventListener("click", () => showMap());
    els.exitLevel.addEventListener("click", () => showMap("先休息一下吧！想再挑戰時，點擊發光入口就可以回來。"));
    els.soundToggle.addEventListener("click", toggleSound);
    els.gameScreen.addEventListener("pointermove", moveMallet);
    els.gameScreen.addEventListener("pointerdown", (event) => {
      if (event.target.closest(".hole")) return;
      swingMallet(event.clientX, event.clientY);
    });
    document.addEventListener("visibilitychange", () => {
      if (!state.running) return;
      if (document.hidden) {
        state.hiddenAt = performance.now();
      } else if (state.hiddenAt) {
        state.deadline += performance.now() - state.hiddenAt;
        state.hiddenAt = 0;
      }
    });
  }

  function init() {
    buildHoles();
    attachEvents();
    renderHud();
    renderTutorial();
  }

  init();
})();

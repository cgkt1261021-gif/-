// ===== 設定(ここを変えると遊び方が変わる) =====
const TIME_LIMIT_SEC = 90;      // 制限時間(秒)
const POINT_PER_PROMPT = 100;   // お題を1問クリアするごとの得点
const POINT_PER_SEC_LEFT = 10;  // 残り時間1秒ごとのボーナス(全問クリアしたときだけ残りが出る)
const PENALTY_PER_MISS = 20;    // ミス1回ごとの減点
const RANKING_SIZE = 10;        // ランキングに残す人数

// ===== お題 (text: 表示する文章 / kana: ひらがなの読み) =====
const PROMPTS = [
    { text: "今日はいい天気ですね", kana: "きょうはいいてんきですね" },
    { text: "猿も木から落ちる", kana: "さるもきからおちる" },
    { text: "七転び八起き", kana: "ななころびやおき" },
    { text: "花より団子", kana: "はなよりだんご" },
    { text: "継続は力なり", kana: "けいぞくはちからなり" },
    { text: "明日は明日の風が吹く", kana: "あしたはあしたのかぜがふく" },
    { text: "朝ごはんにパンとコーヒー", kana: "あさごはんにぱんとこーひー" },
    { text: "焦らず少しずつ進もう", kana: "あせらずすこしずつすすもう" },
    { text: "青空の下で深呼吸", kana: "あおぞらのしたでしんこきゅう" },
    { text: "雨降って地固まる", kana: "あめふってじかたまる" },
];

// ===== ローマ字入力の判定 =====
// ひらがな1文字ごとに「打てるローマ字の候補」を持たせる。
// 先頭の候補が画面に表示される入力例。
const ROMAJI = {
    あ: ["a"], い: ["i"], う: ["u", "wu"], え: ["e"], お: ["o"],
    か: ["ka"], き: ["ki"], く: ["ku"], け: ["ke"], こ: ["ko"],
    さ: ["sa"], し: ["shi", "si"], す: ["su"], せ: ["se"], そ: ["so"],
    た: ["ta"], ち: ["chi", "ti"], つ: ["tsu", "tu"], て: ["te"], と: ["to"],
    な: ["na"], に: ["ni"], ぬ: ["nu"], ね: ["ne"], の: ["no"],
    は: ["ha"], ひ: ["hi"], ふ: ["fu", "hu"], へ: ["he"], ほ: ["ho"],
    ま: ["ma"], み: ["mi"], む: ["mu"], め: ["me"], も: ["mo"],
    や: ["ya"], ゆ: ["yu"], よ: ["yo"],
    ら: ["ra"], り: ["ri"], る: ["ru"], れ: ["re"], ろ: ["ro"],
    わ: ["wa"], を: ["wo"],
    が: ["ga"], ぎ: ["gi"], ぐ: ["gu"], げ: ["ge"], ご: ["go"],
    ざ: ["za"], じ: ["ji", "zi"], ず: ["zu"], ぜ: ["ze"], ぞ: ["zo"],
    だ: ["da"], ぢ: ["di"], づ: ["du"], で: ["de"], ど: ["do"],
    ば: ["ba"], び: ["bi"], ぶ: ["bu"], べ: ["be"], ぼ: ["bo"],
    ぱ: ["pa"], ぴ: ["pi"], ぷ: ["pu"], ぺ: ["pe"], ぽ: ["po"],
    ぁ: ["xa", "la"], ぃ: ["xi", "li"], ぅ: ["xu", "lu"], ぇ: ["xe", "le"], ぉ: ["xo", "lo"],
    ゃ: ["xya", "lya"], ゅ: ["xyu", "lyu"], ょ: ["xyo", "lyo"],
    ー: ["-"], ゔ: ["vu"],
};

const YOUON_HEAD = "きしちにひみりぎじぢびぴ";       // 「きゃ」「しゅ」などの1文字目
const YOUON_TAIL = { ゃ: "a", ゅ: "u", ょ: "o" };     // 小さい「ゃゅょ」

// 「きゃ」「しゃ」などの候補を作る (ki + ゃ → kya)
function makeYouon(head, vowel) {
    const result = [];
    for (const p of ROMAJI[head]) {
        const stem = p.slice(0, -1); // 末尾の i を除く (shi → sh, ki → k)
        if (stem.endsWith("h") || stem === "j") result.push(stem + vowel);   // sha, cha, ja
        if (!stem.endsWith("h")) result.push(stem + "y" + vowel);            // kya, sya, jya
    }
    return [...new Set(result)];
}

// ひらがなの文字列を「1文字(または拗音)ごとのかたまり」に分ける
function tokenize(kana) {
    const tokens = [];
    for (let i = 0; i < kana.length; i++) {
        const c = kana[i];
        const next = kana[i + 1];
        if (YOUON_HEAD.includes(c) && YOUON_TAIL[next]) {
            tokens.push({ patterns: makeYouon(c, YOUON_TAIL[next]) });
            i++;
        } else if (c === "っ") {
            tokens.push({ type: "sokuon" });
        } else if (c === "ん") {
            tokens.push({ type: "n" });
        } else {
            tokens.push({ patterns: ROMAJI[c] ? ROMAJI[c].slice() : [c] });
        }
    }
    return tokens;
}

// 「ん」の次が 母音・や行・「ん」・文末 なら "nn" が必須になる
// (「な行」の前は n 1回でもOK: みんな = minna)
function needsDoubleN(nextToken) {
    if (!nextToken) return true;
    if (nextToken.type === "sokuon") return false;
    if (nextToken.type === "n") return true;
    return nextToken.patterns.some((p) => /^[aiueoy]/.test(p));
}

// 「かたまり」ごとに、打てるローマ字の候補リスト(unit)を作る
function buildUnits(kana) {
    const tokens = tokenize(kana);
    const units = [];
    for (let i = 0; i < tokens.length; i++) {
        const tok = tokens[i];

        if (tok.type === "sokuon") {
            const next = tokens[i + 1];
            if (next && next.patterns) {
                // 「っか」→ kka / xtuka / ltuka のように次の文字とまとめる
                const patterns = [];
                for (const p of next.patterns) {
                    if (/^[bcdfghjklmpqrstvwxyz]/.test(p)) {
                        patterns.push(p[0] + p);
                        if (p.startsWith("ch")) patterns.push("t" + p); // tchi
                    }
                }
                for (const p of next.patterns) patterns.push("xtu" + p, "ltu" + p);
                units.push({ patterns });
                i++;
            } else {
                units.push({ patterns: ["xtu", "ltu"] });
            }
        } else if (tok.type === "n") {
            if (needsDoubleN(tokens[i + 1])) {
                units.push({ patterns: ["nn", "xn"] });
            } else {
                // n 1回でも nn でもOK (先頭の "n" が表示される)
                units.push({ patterns: ["n", "nn", "xn"] });
            }
        } else {
            units.push({ patterns: tok.patterns });
        }
    }
    return units;
}

// 1つのお題の入力状況を管理するオブジェクト
// 「n」のように、打ち方によって次の解釈が変わる場合があるので、
// 「今ありえる状態」を複数同時に持って、キーが来るたびに絞り込んでいく。
// state = { u: 今のかたまりの番号, buf: そのかたまりの中で打った文字 }
function createMatcher(kana) {
    const units = buildUnits(kana);
    let states = [{ u: 0, buf: "" }];
    let typed = ""; // お題全体で打った文字(表示用)

    // 1つの状態にキーを渡したときの、次の状態の一覧
    function step(state, key) {
        const unit = units[state.u];
        if (!unit) return [];
        const candidate = state.buf + key;
        const next = [];
        // まだ続きがある (nn の1つ目の n など)
        if (unit.patterns.some((p) => p.length > candidate.length && p.startsWith(candidate))) {
            next.push({ u: state.u, buf: candidate });
        }
        // このかたまりを打ち終えた
        if (unit.patterns.includes(candidate)) {
            next.push({ u: state.u + 1, buf: "" });
        }
        return next;
    }

    return {
        // キーを1つ渡す。正しければ true、ミスなら false
        press(key) {
            const seen = new Set();
            const nextStates = [];
            for (const s of states) {
                for (const n of step(s, key)) {
                    const id = n.u + ":" + n.buf;
                    if (!seen.has(id)) {
                        seen.add(id);
                        nextStates.push(n);
                    }
                }
            }
            if (nextStates.length === 0) return false;
            states = nextStates;
            typed += key;
            return true;
        },
        isDone() {
            return states.some((s) => s.u >= units.length);
        },
        typed() {
            return typed;
        },
        // まだ打っていない部分の表示用ローマ字 (いちばん進んでいる状態を基準にする)
        rest() {
            let best = states[0];
            for (const s of states) {
                const further = s.u > best.u || (s.u === best.u && s.buf.length > best.buf.length);
                if (further) best = s;
            }
            const unit = units[best.u];
            if (!unit) return "";
            const current = unit.patterns.find((p) => p.startsWith(best.buf)) || unit.patterns[0];
            let text = current.slice(best.buf.length);
            for (let i = best.u + 1; i < units.length; i++) text += units[i].patterns[0];
            return text;
        },
    };
}

// ---- 得点 ----
// 得点 = クリア数 × POINT_PER_PROMPT + 残り秒数 × POINT_PER_SEC_LEFT − ミス数 × PENALTY_PER_MISS
// (残り時間が出るのは、制限時間内に全問クリアしたときだけ。0点未満にはならない)
function calcScore(clearedCount, remainingSec, missCount) {
    const clearPt = clearedCount * POINT_PER_PROMPT;
    const timePt = Math.floor(remainingSec * POINT_PER_SEC_LEFT);
    const missPt = missCount * PENALTY_PER_MISS;
    return { clearPt, timePt, missPt, total: Math.max(0, clearPt + timePt - missPt) };
}

// ---- ランキング (このブラウザの localStorage に保存) ----
const RANKING_KEY = "typingPracticeRanking";
const NAME_KEY = "typingPracticeLastName";

function loadRanking() {
    try {
        const data = JSON.parse(localStorage.getItem(RANKING_KEY));
        if (!Array.isArray(data)) return [];
        return data.filter((e) => e && Number.isFinite(Number(e.score)));
    } catch (e) {
        return [];
    }
}

function saveRanking(list) {
    try {
        localStorage.setItem(RANKING_KEY, JSON.stringify(list));
    } catch (e) {
        // 保存できない環境でもゲーム自体は続ける
    }
}

// この得点がランキング入りするか
function qualifiesForRanking(score) {
    if (score <= 0) return false;
    const list = loadRanking();
    return list.length < RANKING_SIZE || score > Number(list[list.length - 1].score);
}

// ランキングに追加して保存する。何位に入ったかを返す (圏外なら 0)
function addToRanking(entry) {
    const list = loadRanking();
    list.push(entry);
    list.sort((a, b) => b.score - a.score || a.id - b.id);
    const kept = list.slice(0, RANKING_SIZE);
    saveRanking(kept);
    return kept.findIndex((e) => e.id === entry.id) + 1;
}

// ---- 画面の処理 ----
const $ = (id) => document.getElementById(id);

const containerEl = $("container");
const startPanel = $("start-panel");
const gamePanel = $("game-panel");
const resultPanel = $("result-panel");
const rulesEl = $("rules");
const timerEl = $("timer");
const timeEl = $("time");
const timebarFill = $("timebar-fill");
const progressEl = $("progress");
const textEl = $("text");
const kanaEl = $("kana");
const typedEl = $("typed");
const restEl = $("rest");
const missEl = $("miss");
const resultTitleEl = $("result-title");
const resultScoreEl = $("result-score");
const resultMessageEl = $("result-message");
const entryEl = $("entry");
const nameInput = $("name");
const entryOk = $("entry-ok");
const entrySkip = $("entry-skip");
const rankingBody = $("ranking-body");
const rankingReset = $("ranking-reset");

let state = "idle";        // "idle"(スタート前) / "playing"(プレイ中) / "finished"(結果表示)
let order = [];            // 今回のお題の順番
let current = 0;           // 今何問目か
let matcher = null;
let totalMiss = 0;
let cleared = 0;           // クリアした問題数
let endTime = 0;           // 時間切れになる時刻
let timerId = null;
let lastResult = null;     // 直前のプレイ結果 (ランキング登録用)
let entryPending = false;  // 名前の入力待ちか

// ミス音(音声ファイルなしで、ブラウザで直接ブザー音を作る)
let audioCtx = null;
function playMissSound() {
    try {
        audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === "suspended") audioCtx.resume();
        const t = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = "square";
        osc.frequency.setValueAtTime(220, t);
        osc.frequency.exponentialRampToValueAtTime(110, t + 0.15);
        gain.gain.setValueAtTime(0.15, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(t);
        osc.stop(t + 0.16);
    } catch (e) {
        // 音が出せない環境でもゲーム自体は続ける
    }
}

// 画面を1回揺らす
function shake() {
    containerEl.classList.remove("shake");
    void containerEl.offsetWidth; // 連続でミスしてもアニメーションをやり直すため
    containerEl.classList.add("shake");
}
containerEl.addEventListener("animationend", () => {
    containerEl.classList.remove("shake");
});

function shuffle(array) {
    const a = [...array];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function showPanel(name) {
    startPanel.hidden = name !== "start";
    gamePanel.hidden = name !== "game";
    resultPanel.hidden = name !== "result";
}

function render() {
    typedEl.textContent = matcher.typed();
    restEl.textContent = matcher.rest();
}

function loadPrompt() {
    const prompt = order[current];
    matcher = createMatcher(prompt.kana);
    progressEl.textContent = `${current + 1} / ${order.length}`;
    textEl.textContent = prompt.text;
    kanaEl.textContent = prompt.kana;
    render();
}

// 残り時間の表示を更新する。0になったら時間切れ
function updateTimer() {
    const remainingMs = Math.max(0, endTime - performance.now());
    timeEl.textContent = (remainingMs / 1000).toFixed(1);
    timebarFill.style.width = (remainingMs / (TIME_LIMIT_SEC * 1000)) * 100 + "%";
    timerEl.classList.toggle("danger", remainingMs <= 10000);
    if (remainingMs <= 0) endGame(false);
}

function startGame() {
    order = shuffle(PROMPTS);
    current = 0;
    cleared = 0;
    totalMiss = 0;
    missEl.textContent = totalMiss;
    state = "playing";
    showPanel("game");
    loadPrompt();
    endTime = performance.now() + TIME_LIMIT_SEC * 1000;
    updateTimer();
    timerId = setInterval(updateTimer, 100);
}

// ゲーム終了。allClear: 制限時間内に全問クリアしたか
function endGame(allClear) {
    if (state !== "playing") return;
    state = "finished";
    clearInterval(timerId);

    const remainingSec = allClear ? Math.max(0, endTime - performance.now()) / 1000 : 0;
    const score = calcScore(cleared, remainingSec, totalMiss);
    lastResult = {
        score: score.total,
        cleared: cleared,
        miss: totalMiss,
        allClear: allClear,
        time: allClear ? TIME_LIMIT_SEC - remainingSec : null,
    };

    resultTitleEl.textContent = allClear ? "全問クリア!" : "タイムアップ!";
    resultScoreEl.textContent = `${score.total} 点`;
    $("bd-clear").textContent = `${cleared}問 × ${POINT_PER_PROMPT}`;
    $("bd-clear-pt").textContent = `+${score.clearPt}`;
    $("bd-time").textContent = allClear ? `${remainingSec.toFixed(1)}秒 × ${POINT_PER_SEC_LEFT}` : "時間切れ";
    $("bd-time-pt").textContent = `+${score.timePt}`;
    $("bd-miss").textContent = `${totalMiss}回 × ${PENALTY_PER_MISS}`;
    $("bd-miss-pt").textContent = `−${score.missPt}`;

    entryPending = qualifiesForRanking(score.total);
    entryEl.hidden = !entryPending;
    if (entryPending) {
        try { nameInput.value = localStorage.getItem(NAME_KEY) || ""; } catch (e) { nameInput.value = ""; }
        resultMessageEl.textContent = "";
        // 打ち終わった直後のキー連打が名前欄に入らないよう、少し待ってから入力欄を選ぶ
        setTimeout(() => {
            if (state === "finished" && entryPending) nameInput.focus();
        }, 800);
    } else {
        resultMessageEl.textContent = "Enterキーでもう一度";
    }
    showPanel("result");
}

// 名前を入れてランキングに登録する
function submitEntry() {
    if (!entryPending || !lastResult) return;
    const name = nameInput.value.trim() || "名無し";
    try { localStorage.setItem(NAME_KEY, name); } catch (e) { /* 保存できなくても続ける */ }

    const entry = Object.assign({ id: Date.now(), name: name }, lastResult);
    const rank = addToRanking(entry);
    renderRanking(entry.id);

    entryPending = false;
    entryEl.hidden = true;
    resultMessageEl.textContent = (rank > 0 ? `第${rank}位に登録しました! ` : "") + "Enterキーでもう一度";
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
}

function skipEntry() {
    entryPending = false;
    entryEl.hidden = true;
    resultMessageEl.textContent = "Enterキーでもう一度";
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
}

// ランキング表を描き直す (highlightId: 目立たせる行)
function renderRanking(highlightId) {
    const list = loadRanking();
    rankingBody.textContent = "";
    if (list.length === 0) {
        const tr = document.createElement("tr");
        const td = document.createElement("td");
        td.colSpan = 6;
        td.className = "empty";
        td.textContent = "まだ記録がありません";
        tr.appendChild(td);
        rankingBody.appendChild(tr);
        return;
    }
    list.forEach((e, i) => {
        const tr = document.createElement("tr");
        if (highlightId !== undefined && e.id === highlightId) tr.className = "me";
        const cells = [
            i + 1,
            e.name,
            e.score,
            `${e.cleared}/${PROMPTS.length}`,
            e.miss,
            e.allClear ? `${Number(e.time).toFixed(1)}秒` : "時間切れ",
        ];
        for (const value of cells) {
            const td = document.createElement("td");
            td.textContent = String(value); // 名前は textContent で入れるので、HTMLとしては解釈されない
            tr.appendChild(td);
        }
        rankingBody.appendChild(tr);
    });
}

document.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    // 名前の入力中は、ゲームのキー操作をしない
    const tag = event.target && event.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;

    // スタート前、または結果表示のあと: Enterでスタート
    if (state === "idle" || (state === "finished" && !entryPending)) {
        if (event.key === "Enter") {
            event.preventDefault();
            startGame();
        }
        return;
    }
    if (state !== "playing") return;
    if (event.key.length !== 1) return; // Shift や Enter などは無視

    event.preventDefault();
    if (matcher.press(event.key.toLowerCase())) {
        // 打ち終わったら、すぐ次の問題へ
        if (matcher.isDone()) {
            cleared++;
            current++;
            if (current >= order.length) {
                endGame(true);
            } else {
                loadPrompt();
            }
        } else {
            render();
        }
    } else {
        totalMiss++;
        missEl.textContent = totalMiss;
        playMissSound();
        shake();
    }
});

nameInput.addEventListener("keydown", (event) => {
    // 日本語入力の変換を確定するEnterでは登録しない
    if (event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        submitEntry();
    }
});
entryOk.addEventListener("click", submitEntry);
entrySkip.addEventListener("click", skipEntry);

rankingReset.addEventListener("click", () => {
    if (window.confirm("ランキングの記録をすべて消します。よろしいですか?")) {
        saveRanking([]);
        renderRanking();
    }
    rankingReset.blur(); // このあとのEnterでボタンが押されないように
});

// ---- 最初の表示 ----
rulesEl.textContent =
    `制限時間 ${TIME_LIMIT_SEC}秒 / お題 ${PROMPTS.length}問\n` +
    `得点 = クリア数×${POINT_PER_PROMPT} + 残り秒数×${POINT_PER_SEC_LEFT} − ミス×${PENALTY_PER_MISS}`;
showPanel("start");
renderRanking();
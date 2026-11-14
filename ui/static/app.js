/* Minimal, Calm Wizard UI Over OpenCode (`opencode serve`)
 * Suppresses OpenCode's verbose streaming logs/tool dumps and presents ONLY:
 *   1. Clean Inputs Card
 *   2. One-at-a-time Discovery & Design Questions (from OpenCode's `question` tool)
 *   3. Clean Deliverables & Fitness Score + 1-line feedback bar
 */

const state = {
  view: "inputs", // "inputs" | "interview" | "results"
  sessionId: null,
  busy: false,
  inputs: [],
  outputs: [],
  baselineBundleNames: new Set(),
  activeBundle: null,
  activeDocKind: "cv", // "cv" | "cover" | "report"
  activeFormat: ".md",
  activeContent: "",

  // OpenCode question batch state (stepped 1 question at a time)
  activeQuestionReq: null, // { id, questions: [...] }
  qIndex: 0,
  qSelections: [], // Array<Set<string>>
  qCustomText: [], // Array<string>
  totalAnswered: 0,

  baselineScore: null,
  afterScore: null,
  linkedinPasteMode: false,
  jobPasteMode: false,
  lastPrompt: null,
  sse: null,
};

const FRIENDLY_TOOL_STATUS = {
  parse_inputs: "Reading your CV and LinkedIn profile...",
  github_profile: "Checking your GitHub repositories & READMEs...",
  job_posting: "Reading the target job posting...",
  webfetch: "Fetching the job page...",
  websearch: "Researching company context...",
  write: "Writing your tailored CV & cover letter...",
  edit: "Polishing your documents...",
  ats_check: "Running final ATS compliance check...",
  task: "Cross-referencing your experience...",
};

function $(id) {
  return document.getElementById(id);
}

function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("hidden"), 2500);
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderMarkdown(md) {
  if (!md) return "";
  const blocks = [];
  let text = String(md).replace(/```([\w-]*)\n([\s\S]*?)```/g, (_, _lang, code) => {
    blocks.push(`<pre><code>${escapeHtml(code.trimEnd())}</code></pre>`);
    return `@@BLOCK_${blocks.length - 1}@@`;
  });

  const fmt = (s) =>
    escapeHtml(s)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  const out = [];
  let inList = false;
  let inTable = false;

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (/^@@BLOCK_\d+@@$/.test(line)) {
      if (inList) { out.push("</ul>"); inList = false; }
      if (inTable) { out.push("</tbody></table>"); inTable = false; }
      out.push(line);
      continue;
    }
    if (line.startsWith("|") && line.endsWith("|")) {
      if (inList) { out.push("</ul>"); inList = false; }
      const cells = line.slice(1, -1).split("|").map((c) => c.trim());
      if (cells.every((c) => /^[-:]+$/.test(c))) continue;
      if (!inTable) {
        out.push("<table><thead><tr>" + cells.map((c) => `<th>${fmt(c)}</th>`).join("") + "</tr></thead><tbody>");
        inTable = true;
      } else {
        out.push("<tr>" + cells.map((c) => `<td>${fmt(c)}</td>`).join("") + "</tr>");
      }
      continue;
    } else if (inTable) {
      out.push("</tbody></table>");
      inTable = false;
    }
    if (!line) {
      if (inList) { out.push("</ul>"); inList = false; }
      continue;
    }
    const h = line.match(/^(#{1,3})\s+(.+)$/);
    if (h) {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push(`<h${h[1].length}>${fmt(h[2])}</h${h[1].length}>`);
      continue;
    }
    const li = line.match(/^[-*•]\s+(.+)$/) || line.match(/^\d+\.\s+(.+)$/);
    if (li) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${fmt(li[1])}</li>`);
      continue;
    } else if (inList) {
      out.push("</ul>");
      inList = false;
    }
    out.push(`<p>${fmt(line)}</p>`);
  }
  if (inList) out.push("</ul>");
  if (inTable) out.push("</tbody></table>");

  let html = out.join("\n");
  blocks.forEach((b, i) => {
    html = html.replace(`@@BLOCK_${i}@@`, b);
  });
  return html;
}

async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`);
  return data;
}

// ---------- NAVIGATION ----------
function switchView(view) {
  state.view = view;
  $("viewInputs").classList.toggle("hidden", view !== "inputs");
  $("viewInterview").classList.toggle("hidden", view !== "interview");
  $("viewResults").classList.toggle("hidden", view !== "results");

  $("navInputs").classList.toggle("active", view === "inputs");
  $("navInterview").classList.toggle("active", view === "interview");
  $("navResults").classList.toggle("active", view === "results");

  if (view === "interview") $("navInterview").disabled = false;
  if (view === "results") $("navResults").disabled = false;
}

// ---------- WORKSPACE & INPUTS ----------
async function syncWorkspace() {
  try {
    const ws = await api("/api/workspace");
    const dot = $("engineDot");
    dot.className = "logo-dot " + (!ws.engine?.healthy ? "offline" : state.busy ? "busy" : "online");

    state.inputs = ws.inputs || [];
    state.outputs = ws.outputs || [];

    if (!$("githubInput").dataset.dirty && ws.profile?.github) {
      $("githubInput").value = ws.profile.github;
    }
    if (!$("formatPrefSelect").dataset.dirty && ws.profile?.preferred_typeset_format) {
      $("formatPrefSelect").value = ws.profile.preferred_typeset_format;
    }

    renderInputIndicators();

    // Check if a new output bundle was created in this session
    if (state.outputs.length > 0) {
      $("navResults").disabled = false;
      const newest = state.outputs[0];
      if (newest.fitness) {
        if (newest.fitness.baseline !== null) state.baselineScore = newest.fitness.baseline;
        if (newest.fitness.after !== null) state.afterScore = newest.fitness.after;
        updateScoreDisplays();
      }
      const isNewBundle = state.sessionId && !state.baselineBundleNames.has(newest.name);
      if (isNewBundle && !state.busy && !state.activeQuestionReq && state.view === "interview") {
        await openBundleResults(newest);
      } else if (!state.activeBundle) {
        state.activeBundle = newest;
      }
    }
  } catch (_) {
    $("engineDot").className = "logo-dot offline";
  }
}

function renderInputIndicators() {
  const cv = state.inputs.find((f) => f.filename.startsWith("cv."));
  const li = state.inputs.find((f) => f.filename.startsWith("linkedin."));

  $("cvTag").textContent = cv ? "Uploaded" : "Required";
  $("cvTag").className = "status-tag" + (cv ? " done" : "");
  $("cvDropzone").classList.toggle("loaded", !!cv);
  if (cv) $("cvLabel").textContent = `✓ ${cv.filename} (${cv.word_count} words)`;

  $("linkedinDropzone").classList.toggle("loaded", !!li);
  if (li) $("linkedinLabel").textContent = `✓ ${li.filename} (${li.word_count} words)`;
}

async function uploadLocalFile(category, file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const res = await api("/api/upload", {
    method: "POST",
    body: JSON.stringify({ category, filename: file.name, contentBase64: btoa(bin) }),
  });
  state.inputs = res.inputs || [];
  renderInputIndicators();
}

function setupDropzone(boxEl, inputEl, category) {
  inputEl.addEventListener("change", () => {
    if (inputEl.files?.[0]) uploadLocalFile(category, inputEl.files[0]);
  });
  boxEl.addEventListener("dragover", (e) => {
    e.preventDefault();
    boxEl.classList.add("dragover");
  });
  boxEl.addEventListener("dragleave", () => boxEl.classList.remove("dragover"));
  boxEl.addEventListener("drop", (e) => {
    e.preventDefault();
    boxEl.classList.remove("dragover");
    if (e.dataTransfer.files?.[0]) uploadLocalFile(category, e.dataTransfer.files[0]);
  });
}

// ---------- MODEL LIST ----------
async function loadModels() {
  try {
    const data = await api("/api/oc/providers");
    const connected = new Set(data.connected || []);
    const opts = [];
    for (const p of data.all || []) {
      if (!connected.has(p.id) && p.source !== "config" && p.source !== "custom") continue;
      for (const m of Object.values(p.models || {})) {
        const id = m.id || m.name;
        if (id) opts.push({ val: `${p.id}/${id}`, label: `${p.name || p.id} · ${m.name || id}` });
      }
    }
    const pref = [
      "google/gemini-2.5-pro",
      "google/gemini-2.5-flash",
      "litellm/deepseek-v4-flash",
      "litellm/qwen3-coder-next-fp8",
    ];
    opts.sort((a, b) => {
      const ia = pref.indexOf(a.val);
      const ib = pref.indexOf(b.val);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.label.localeCompare(b.label);
    });
    const sel = $("modelSelect");
    if (opts.length) {
      sel.innerHTML = opts.map((o) => `<option value="${escapeHtml(o.val)}">${escapeHtml(o.label)}</option>`).join("");
    }
  } catch (_) {}
}

function currentModelObj() {
  const val = $("modelSelect").value;
  if (!val || !val.includes("/")) return undefined;
  const i = val.indexOf("/");
  return { providerID: val.slice(0, i), modelID: val.slice(i + 1) };
}

// ---------- QUIET OPENCODE EVENT STREAM ----------
function connectEvents() {
  if (state.sse) state.sse.close();
  const es = new EventSource("/api/oc/events");
  state.sse = es;

  es.onmessage = (e) => {
    if (!e.data) return;
    try {
      onOpenCodeEvent(JSON.parse(e.data));
    } catch (_) {}
  };
  es.onerror = () => {
    setTimeout(() => {
      if (state.sse === es) connectEvents();
    }, 3000);
  };
}

function parseScoresQuietly(text) {
  if (!text) return;
  const b = text.match(/(?:baseline|starting|initial|before)[^\n\d]{0,35}?(\d{1,3})\s*\/\s*100/i);
  if (b) state.baselineScore = Math.min(100, parseInt(b[1], 10));
  const a = text.match(/(?:tailored|post-tailoring|final|after)[^\n\d]{0,35}?(\d{1,3})\s*\/\s*100/i);
  if (a) state.afterScore = Math.min(100, parseInt(a[1], 10));
  updateScoreDisplays();
}

function updateScoreDisplays() {
  if (state.baselineScore !== null) {
    $("baselineStrip").classList.remove("hidden");
    $("baselinePillVal").textContent = `${state.baselineScore} / 100`;
    $("resBeforeScore").textContent = `${state.baselineScore}`;
  }
  if (state.afterScore !== null) {
    $("resAfterScore").textContent = `${state.afterScore} / 100`;
  }
}

function setWorkingMessage(title, sub = "OpenCode is working quietly in the background.") {
  $("workingTitle").textContent = title;
  $("workingSub").textContent = sub;
}

function onOpenCodeEvent(raw) {
  const ev = raw.payload || raw;
  const type = ev.type;
  const props = ev.properties || {};

  if (props.sessionID && state.sessionId && props.sessionID !== state.sessionId) return;

  if (type === "session.status") {
    const st = props.status?.type || props.status;
    state.busy = st === "busy" || st === "retry";
    renderInterviewState();
    return;
  }

  if (type === "session.idle") {
    state.busy = false;
    syncWorkspace().then(() => {
      if (state.outputs.length > 0 && !state.activeQuestionReq) {
        const newest = state.outputs[0];
        if (!state.baselineBundleNames.has(newest.name) || state.view === "results") {
          openBundleResults(newest);
        }
      }
      renderInterviewState();
    });
    return;
  }

  if (type === "session.error" || type === "session.next.step.failed") {
    state.busy = false;
    const err = props.error || {};
    showError(err.data?.message || err.message || JSON.stringify(err));
    renderInterviewState();
    return;
  }

  // Quietly translate tool execution into a calm 1-line human status (NO verbose logs!)
  if (type === "message.part.updated" && props.part) {
    const p = props.part;
    if (p.type === "tool" && FRIENDLY_TOOL_STATUS[p.tool]) {
      setWorkingMessage(FRIENDLY_TOOL_STATUS[p.tool]);
    }
    if (p.type === "text" && p.text) {
      parseScoresQuietly(p.text);
    }
    return;
  }

  if (type === "message.part.delta" && props.delta) {
    parseScoresQuietly(props.delta);
    return;
  }

  if (type === "session.next.text.delta" && props.delta) {
    parseScoresQuietly(props.delta);
    return;
  }

  // OpenCode native interactive `question` tool!
  if (type === "question.asked") {
    loadQuestionBatch(props);
    return;
  }

  if (type === "question.replied" || type === "question.rejected") {
    if (state.activeQuestionReq?.id === props.requestID) {
      state.activeQuestionReq = null;
      renderInterviewState();
    }
    return;
  }

  if (type === "permission.asked") {
    const strip = $("permStrip");
    strip.classList.remove("hidden");
    strip.innerHTML = `
      <span>Allow OpenCode to run <code>${escapeHtml(props.permission)}</code>?</span>
      <div>
        <button class="btn btn-primary btn-sm" id="allowPermBtn" type="button">Allow</button>
      </div>
    `;
    $("allowPermBtn").onclick = async () => {
      await api(`/api/oc/permission/${encodeURIComponent(props.id)}/reply`, {
        method: "POST",
        body: JSON.stringify({ reply: "once" }),
      });
      strip.classList.add("hidden");
    };
  }
}

// ---------- ONE-AT-A-TIME QUESTION STEPPER ----------
function loadQuestionBatch(req) {
  const qs = req.questions || [];
  if (!qs.length) return;
  state.activeQuestionReq = req;
  state.qIndex = 0;
  state.qSelections = qs.map(() => new Set());
  state.qCustomText = qs.map(() => "");
  if (state.view !== "interview") switchView("interview");
  renderInterviewState();
}

function renderInterviewState() {
  const hasQ = !!state.activeQuestionReq;
  $("workingState").classList.toggle("hidden", hasQ);
  $("questionStage").classList.toggle("hidden", !hasQ);

  if (!hasQ) return;

  const qs = state.activeQuestionReq.questions;
  const idx = state.qIndex;
  const q = qs[idx];
  const globalNum = state.totalAnswered + idx + 1;
  const isLastInBatch = idx === qs.length - 1;

  $("qCounterLabel").textContent = `Question ${globalNum}`;
  $("qHeaderLabel").textContent = q.header ? `${q.header}${q.multiple ? " · Select any that apply" : ""}` : "";
  $("qPromptText").textContent = q.question || "";

  const list = $("qChoicesList");
  list.innerHTML = "";
  (q.options || []).forEach((opt) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "choice-btn" + (state.qSelections[idx].has(opt.label) ? " selected" : "");
    btn.innerHTML = `
      <div class="choice-title">${escapeHtml(opt.label)}</div>
      ${opt.description ? `<div class="choice-desc">${escapeHtml(opt.description)}</div>` : ""}
    `;
    btn.onclick = () => {
      if (!q.multiple) {
        state.qSelections[idx].clear();
        Array.from(list.children).forEach((c) => c.classList.remove("selected"));
      }
      if (state.qSelections[idx].has(opt.label)) {
        state.qSelections[idx].delete(opt.label);
        btn.classList.remove("selected");
      } else {
        state.qSelections[idx].add(opt.label);
        btn.classList.add("selected");
      }
    };
    list.appendChild(btn);
  });

  const allowCustom = q.custom !== false;
  $("qCustomWrap").classList.toggle("hidden", !allowCustom);
  $("qCustomInput").value = state.qCustomText[idx] || "";
  $("qCustomInput").oninput = (e) => {
    state.qCustomText[idx] = e.target.value;
  };

  $("qPrevBtn").style.visibility = idx > 0 ? "visible" : "hidden";
  $("qNextBtn").textContent = isLastInBatch ? "Continue →" : "Next →";
  $("qNextBtn").disabled = false;
}

async function advanceQuestion() {
  if (!state.activeQuestionReq) return;
  const qs = state.activeQuestionReq.questions;
  const idx = state.qIndex;
  const chosen = Array.from(state.qSelections[idx]);
  const custom = (state.qCustomText[idx] || "").trim();
  if (!chosen.length && !custom) {
    toast("Pick an option or type a short answer to continue");
    return;
  }

  if (idx < qs.length - 1) {
    state.qIndex += 1;
    renderInterviewState();
    return;
  }

  // Last question in this OpenCode batch -> submit all answers to OpenCode!
  const reqId = state.activeQuestionReq.id;
  const answers = qs.map((_, i) => {
    const arr = Array.from(state.qSelections[i]);
    const txt = (state.qCustomText[i] || "").trim();
    if (txt) arr.push(txt);
    return arr;
  });

  $("qNextBtn").disabled = true;
  $("qNextBtn").textContent = "Saving...";
  try {
    await api(`/api/oc/question/${encodeURIComponent(reqId)}/reply`, {
      method: "POST",
      body: JSON.stringify({ answers }),
    });
    state.totalAnswered += qs.length;
    state.activeQuestionReq = null;
    setWorkingMessage(
      state.totalAnswered >= 5
        ? "Crafting your ATS-friendly CV, cover letter & fitness score..."
        : "Preparing next follow-up questions..."
    );
    state.busy = true;
    renderInterviewState();
  } catch (err) {
    showError(err.message);
    $("qNextBtn").disabled = false;
    $("qNextBtn").textContent = "Continue →";
  }
}

// ---------- LAUNCH & RESULTS ----------
async function startTailoringFlow() {
  $("errorBanner").classList.add("hidden");

  // Save pasted text inputs if used
  if (state.linkedinPasteMode && $("linkedinTextInput").value.trim()) {
    await api("/api/upload", {
      method: "POST",
      body: JSON.stringify({
        category: "linkedin",
        filename: "linkedin.txt",
        text: $("linkedinTextInput").value.trim(),
      }),
    });
  }
  if (state.jobPasteMode && $("jobTextInput").value.trim()) {
    await api("/api/upload", {
      method: "POST",
      body: JSON.stringify({
        category: "job",
        filename: "job.txt",
        text: $("jobTextInput").value.trim(),
      }),
    });
  }

  const github = $("githubInput").value.trim();
  const preferred_typeset_format = $("formatPrefSelect").value;
  await api("/api/profile", {
    method: "POST",
    body: JSON.stringify({ github, preferred_typeset_format }),
  });

  await syncWorkspace();
  state.baselineBundleNames = new Set(state.outputs.map((o) => o.name));

  const jobUrl = $("jobUrlInput").value.trim();
  const fmtDesc =
    preferred_typeset_format === "latex"
      ? "Markdown (.md) + LaTeX (.tex)"
      : preferred_typeset_format === "typst"
      ? "Markdown (.md) + Typst (.typ)"
      : "Markdown (.md) + BOTH LaTeX (.tex) and Typst (.typ)";

  const prompt = [
    "Run `/tailor` quietly and concisely:",
    "- Parse `inputs/` via `parse_inputs`.",
    github ? `- GitHub: ${github} (call \`github_profile\`).` : "- Ask for GitHub via `question` if missing.",
    jobUrl && !state.jobPasteMode
      ? `- Target Job Link: ${jobUrl} (call \`job_posting\`).`
      : "- Read target job from `inputs/job.*` or ask via `question` if missing.",
    `- Generate source formats: ${fmtDesc}.`,
    "- Compute Baseline Score (X/100), ask AT LEAST 5 tailored questions via the `question` tool before writing outputs, then write the tailored CV, cover letter, and `fitness_report.md` in `outputs/` and run `ats_check`. Do NOT call `question` after writing the files unless clarification is strictly needed — let the user inspect the generated files directly.",
  ].join("\n");

  state.lastPrompt = prompt;
  switchView("interview");
  setWorkingMessage("Reading your CV, GitHub & job posting...");
  state.busy = true;
  renderInterviewState();

  try {
    if (!state.sessionId) {
      const created = await api("/api/oc/session", {
        method: "POST",
        body: JSON.stringify({ title: "CV Tailor", agent: "career-architect" }),
      });
      state.sessionId = created.id;
    }
    await api(`/api/oc/session/${encodeURIComponent(state.sessionId)}/prompt`, {
      method: "POST",
      body: JSON.stringify({
        agent: "career-architect",
        model: currentModelObj(),
        text: prompt,
      }),
    });
  } catch (err) {
    showError(err.message);
  }
}

async function openBundleResults(bundle) {
  state.activeBundle = bundle;
  $("downloadAllZipBtn").href = `/api/outputs/zip?bundle=${encodeURIComponent(bundle.name)}`;
  if (bundle.fitness) {
    if (bundle.fitness.baseline !== null) state.baselineScore = bundle.fitness.baseline;
    if (bundle.fitness.after !== null) state.afterScore = bundle.fitness.after;
    updateScoreDisplays();
  }
  switchView("results");
  await loadDeliverableTab(state.activeDocKind);
}

function matchingFilesForKind(bundle, kind) {
  const files = bundle?.files || [];
  if (kind === "cv") return files.filter((f) => f.toLowerCase().includes("cv"));
  if (kind === "cover") return files.filter((f) => f.toLowerCase().includes("cover"));
  return files.filter((f) => f.toLowerCase().includes("fitness") || f.toLowerCase().includes("report"));
}

async function loadDeliverableTab(kind) {
  state.activeDocKind = kind;
  document.querySelectorAll(".doc-tab").forEach((b) => {
    b.classList.toggle("active", b.dataset.doc === kind);
  });

  const candidates = matchingFilesForKind(state.activeBundle, kind);
  const fmtSel = $("docFormatSelect");
  const labelMap = { ".md": "Markdown (.md)", ".tex": "LaTeX (.tex)", ".typ": "Typst (.typ)" };

  fmtSel.innerHTML = candidates
    .map((fname) => {
      const ext = fname.slice(fname.lastIndexOf("."));
      return `<option value="${escapeHtml(fname)}">${escapeHtml(labelMap[ext] || fname)}</option>`;
    })
    .join("");
  fmtSel.classList.toggle("hidden", candidates.length <= 1);

  if (!candidates.length) {
    $("docReader").innerHTML = `<p style="color:#64748b">File not generated yet.</p>`;
    state.activeContent = "";
    return;
  }

  const chosenFile = candidates.find((f) => f.endsWith(".md")) || candidates[0];
  fmtSel.value = chosenFile;
  await fetchAndShowBundleFile(chosenFile);
}

async function fetchAndShowBundleFile(filename) {
  if (!state.activeBundle || !filename) return;
  const res = await api(
    `/api/outputs/file?bundle=${encodeURIComponent(state.activeBundle.name)}&file=${encodeURIComponent(filename)}`
  );
  state.activeFormat = filename;
  state.activeContent = res.content || "";

  if (filename.endsWith(".md")) {
    $("docReader").innerHTML = renderMarkdown(state.activeContent);
  } else {
    $("docReader").innerHTML = `<pre><code>${escapeHtml(state.activeContent)}</code></pre>`;
  }
}

function showError(msg) {
  $("errorBannerText").textContent = msg;
  $("errorRepairBtn").classList.toggle("hidden", !/google provider options/i.test(msg));
  $("errorBanner").classList.remove("hidden");
}

// ---------- WIRE UP ----------
function init() {
  setupDropzone($("cvDropzone"), $("cvFileInput"), "cv");
  setupDropzone($("linkedinDropzone"), $("linkedinFileInput"), "linkedin");

  $("toggleLinkedinMode").onclick = () => {
    state.linkedinPasteMode = !state.linkedinPasteMode;
    $("linkedinDropzone").classList.toggle("hidden", state.linkedinPasteMode);
    $("linkedinTextInput").classList.toggle("hidden", !state.linkedinPasteMode);
    $("toggleLinkedinMode").textContent = state.linkedinPasteMode ? "Upload PDF instead" : "Paste text instead";
  };

  $("toggleJobMode").onclick = () => {
    state.jobPasteMode = !state.jobPasteMode;
    $("jobUrlInput").classList.toggle("hidden", state.jobPasteMode);
    $("jobTextInput").classList.toggle("hidden", !state.jobPasteMode);
    $("toggleJobMode").textContent = state.jobPasteMode ? "Use job URL instead" : "Paste description instead";
  };

  $("githubInput").oninput = () => { $("githubInput").dataset.dirty = "1"; };
  $("formatPrefSelect").onchange = () => { $("formatPrefSelect").dataset.dirty = "1"; };

  $("startBtn").onclick = startTailoringFlow;

  $("qPrevBtn").onclick = () => {
    if (state.qIndex > 0) {
      state.qIndex -= 1;
      renderInterviewState();
    }
  };
  $("qNextBtn").onclick = advanceQuestion;
  $("qCustomInput").onkeydown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      advanceQuestion();
    }
  };

  $("cancelRunBtn").onclick = async () => {
    if (state.sessionId) {
      await api(`/api/oc/session/${encodeURIComponent(state.sessionId)}/abort`, { method: "POST", body: "{}" });
    }
    state.busy = false;
    switchView("inputs");
  };

  // Top step navigation
  document.querySelectorAll(".step-pill").forEach((btn) => {
    btn.onclick = () => {
      if (!btn.disabled) switchView(btn.dataset.goto);
    };
  });

  $("resetBtn").onclick = () => {
    state.sessionId = null;
    state.activeQuestionReq = null;
    state.totalAnswered = 0;
    state.baselineScore = null;
    state.afterScore = null;
    $("baselineStrip").classList.add("hidden");
    $("navInterview").disabled = true;
    switchView("inputs");
  };

  // Results tabs & actions
  document.querySelectorAll(".doc-tab").forEach((btn) => {
    btn.onclick = () => loadDeliverableTab(btn.dataset.doc);
  });
  $("docFormatSelect").onchange = (e) => fetchAndShowBundleFile(e.target.value);

  $("copyBtn").onclick = async () => {
    await navigator.clipboard.writeText(state.activeContent || "");
    toast("Copied to clipboard");
  };

  $("downloadBtn").onclick = () => {
    const blob = new Blob([state.activeContent || ""], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = state.activeFormat || "document.md";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // Simple 1-line revision feedback back to OpenCode
  $("feedbackForm").onsubmit = async (e) => {
    e.preventDefault();
    const text = $("feedbackInput").value.trim();
    if (!text) return;
    $("feedbackInput").value = "";

    switchView("interview");
    setWorkingMessage("Updating your documents based on your feedback...");
    state.busy = true;
    renderInterviewState();

    try {
      if (!state.sessionId) {
        const created = await api("/api/oc/session", {
          method: "POST",
          body: JSON.stringify({ title: "CV Tailor Revision", agent: "career-architect" }),
        });
        state.sessionId = created.id;
      }
      await api(`/api/oc/session/${encodeURIComponent(state.sessionId)}/prompt`, {
        method: "POST",
        body: JSON.stringify({
          agent: "career-architect",
          model: currentModelObj(),
          text: `Update the files in outputs/${state.activeBundle?.name || ""} per this feedback (keep output quiet and re-run ats_check): ${text}`,
        }),
      });
    } catch (err) {
      showError(err.message);
    }
  };

  const repairCache = async () => {
    toast("Refreshing OpenCode Google SDK cache...");
    try {
      await api("/api/reset-opencode-cache", { method: "POST", body: "{}" });
      $("errorBanner").classList.add("hidden");
      await loadModels();
      connectEvents();
      toast("Ready!");
      if (state.lastPrompt && state.view === "interview") {
        startTailoringFlow();
      }
    } catch (err) {
      showError(err.message);
    }
  };
  $("repairCacheBtn").onclick = repairCache;
  $("errorRepairBtn").onclick = repairCache;
  $("dismissErrorBtn").onclick = () => $("errorBanner").classList.add("hidden");

  // Boot
  syncWorkspace();
  loadModels();
  connectEvents();
  api("/api/oc/questions")
    .then((qs) => {
      if (Array.isArray(qs) && qs.length > 0) loadQuestionBatch(qs[0]);
    })
    .catch(() => {});
  setInterval(syncWorkspace, 5000);
}

document.addEventListener("DOMContentLoaded", init);

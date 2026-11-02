// The on-box self-test wizard (issue #105), opened from Settings › About.
//
// It walks the steps in SELF_TEST_STEPS: the box plays a short clip it made itself, the TV shows what
// the box reported at that moment (mode, picture, sound path), and the household answers one yes/no
// question. After the clips, it asks for every button on the remote in turn and lists any that never
// arrived — which is the only way to find a key the CEC keymap got wrong, since a missing key looks
// exactly like a key nobody pressed.
//
// The run is sent to the Hub at the end, so it can be read on the phone and in /api/diagnostics. It
// is deliberately not auto-fixed and not auto-retried: the point is to record what happened.

import { createSignal, For, onCleanup, Show } from "solid-js";
import { type SelfTestAnswer, type SelfTestKey, type SelfTestObservation, type SelfTestPlayed, type SelfTestReport, type SelfTestResult, type SelfTestStep, SELF_TEST_KEY_LABELS, SELF_TEST_KEYS, SELF_TEST_STEPS, selfTestSummary } from "@ultimatetv/shared";
import { agent, agentHas } from "../agent";
import { hub } from "../api";
import { Icon } from "../components/Icon";
import { Row } from "../components/SettingRow";
import { errorToast, toast } from "../store";
import { addOverlayKeys } from "../keys";

type Phase = "idle" | "preparing" | "playing" | "asking" | "keys" | "done";

/** The keys the wizard asks for, in an order that is easy to follow on a remote. */
const KEY_ORDER: SelfTestKey[] = [...SELF_TEST_KEYS];

export function SelfTestSection() {
  const canRun = () => agentHas("selfTest");
  const [phase, setPhase] = createSignal<Phase>("idle");
  const [stepIndex, setStepIndex] = createSignal(0);
  const [results, setResults] = createSignal<SelfTestResult[]>([]);
  const [observed, setObserved] = createSignal<SelfTestObservation | null>(null);
  const [missing, setMissing] = createSignal<SelfTestKey[]>([]);
  const [waiting, setWaiting] = createSignal<SelfTestKey | null>(null);
  const [note, setNote] = createSignal("");
  const [problem, setProblem] = createSignal("");
  const [last, setLast] = createSignal<SelfTestReport | null>(null);

  void hub.selfTest().then((r) => setLast(r.report), () => undefined);

  const steps = () => SELF_TEST_STEPS;
  const step = (): SelfTestStep | null => steps()[stepIndex()] ?? null;

  /** Turns a SelfTestPlayed into the observation recorded with the answer. */
  const observe = (p: SelfTestPlayed): SelfTestObservation => ({
    ...(p.display ? { display: p.display } : {}),
    ...(p.width ? { width: p.width } : {}),
    ...(p.height ? { height: p.height } : {}),
    ...(p.refreshHz ? { refreshHz: p.refreshHz } : {}),
    ...(p.hdr === undefined ? {} : { hdr: p.hdr }),
    ...(p.codec ? { codec: p.codec } : {}),
    ...(p.hwdec ? { hwdec: p.hwdec } : {}),
  });

  const begin = async () => {
    if (!canRun()) return setProblem("This box's software is too old for the self-test. Update the box, then try again.");
    setProblem("");
    setResults([]);
    setMissing([]);
    setStepIndex(0);
    setPhase("preparing");
    try {
      const r = await agent.selfTest!({ action: "prepare" });
      if ("missing" in r && r.missing.length) {
        const names = SELF_TEST_STEPS.filter((s) => (r.missing as string[]).includes(s.id)).map((s) => s.label);
        toast(`The box couldn't make the ${names.join(", ")} clip${names.length === 1 ? "" : "s"}. Those steps will be skipped.`, "bad");
      }
      await playCurrent();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err));
      setPhase("idle");
    }
  };

  const playCurrent = async () => {
    const s = step();
    if (!s) return finish();
    if (!agentHas("selfTest")) return setProblem("This box's software is too old for the self-test.");
    setPhase("playing");
    setObserved(null);
    setNote("");
    try {
      const played = (await agent.selfTest!({ action: "play", id: s.id })) as SelfTestPlayed;
      setObserved(observe(played));
    } catch (err) {
      // A step with no clip (ffmpeg missing) is recorded as skipped rather than failing the run.
      const message = err instanceof Error ? err.message : String(err);
      if (message.toLowerCase().includes("hasn't been made") || message.toLowerCase().includes("couldn't make")) {
        answer("skipped", message);
        return;
      }
      setProblem(message);
    }
    setPhase("asking");
  };

  const answer = (a: SelfTestAnswer, why?: string) => {
    const s = step();
    if (s) {
      const o = observed() ?? {};
      setResults((all) => [
        ...all,
        {
          id: s.id,
          label: s.label,
          answer: a,
          observed: o,
          ...(why ?? note() ? { note: (why ?? note()).slice(0, 400) } : {}),
        },
      ]);
    }
    void agent.selfTest?.({ action: "stop" }).catch(() => undefined);
    const next = stepIndex() + 1;
    setStepIndex(next);
    if (next >= steps().length) void startKeys();
    else void playCurrent();
  };

  /** The remote key test: each key is watched for a few seconds; any that passes is ticked off. */
  const startKeys = async () => {
    setPhase("keys");
    setMissing([]);
    setWaiting(KEY_ORDER[0] ?? null);
    await new Promise((r) => setTimeout(r, 300));
  };

  const [seen, setSeen] = createSignal<Set<string>>(new Set());
  const tick = (key: string) => {
    if (phase() !== "keys") return;
    const next = new Set(seen());
    next.add(key);
    setSeen(next);
    const outstanding = KEY_ORDER.find((k) => !next.has(k));
    if (outstanding) {
      setWaiting(outstanding);
      return;
    }
    setWaiting(null);
    setMissing([]);
    void finishReport(next);
  };

  // One listener for the whole run, in front of every screen: during the key test it records the
  // button, and Back leaves at any other point. It only claims keys while a run is going.
  onCleanup(
    addOverlayKeys((a) => {
      if (phase() === "keys") {
        tick(a);
        return true;
      }
      if (a === "back" && phase() !== "idle" && phase() !== "done") {
        void cancel();
        return true;
      }
      return false;
    }),
  );

  const skipKey = () => {
    const w = waiting();
    if (!w) return;
    const next = new Set(seen());
    const outstanding = KEY_ORDER.find((k) => k !== w && !next.has(k));
    // Record the one being skipped as missing, then move on.
    setMissing((m) => (m.includes(w) ? m : [...m, w]));
    setSeen(next);
    if (outstanding) setWaiting(outstanding);
    else void finishReport(next, [w]);
  };

  const skipAllKeys = () => {
    const left = KEY_ORDER.filter((k) => !seen().has(k) && k !== waiting());
    const w = waiting();
    const all = w ? [...left, w] : left;
    setMissing(all);
    setWaiting(null);
    void finishReport(seen(), all);
  };

  const finishReport = async (had: Set<string>, extra: SelfTestKey[] = []) => {
    const missingNow = [...new Set([...extra, ...missing()])].filter((k) => !had.has(k));
    setMissing(missingNow);
    const report: SelfTestReport = {
      at: new Date().toISOString(),
      ...(results().length ? {} : {}),
      results: results(),
      missingKeys: missingNow,
    };
    try {
      const withInfo = await agent.info().catch(() => null);
      if (withInfo?.hostname) report.hostname = withInfo.hostname;
      if (withInfo?.version) report.appVersion = withInfo.version;
    } catch {
      // The report is still worth keeping without it.
    }
    setLast(report);
    setPhase("done");
    try {
      await hub.saveSelfTest(report);
    } catch (err) {
      errorToast(err);
    }
  };

  const finish = () => {
    setPhase("done");
    void finishReport(seen());
  };

  const cancel = async () => {
    await agent.selfTest?.({ action: "stop" }).catch(() => undefined);
    setPhase("idle");
    setWaiting(null);
  };

  const rerun = () => {
    setSeen(new Set<string>());
    setResults([]);
    setMissing([]);
    setPhase("idle");
    void begin();
  };

  const forget = async () => {
    await hub.clearSelfTest().catch(errorToast);
    setLast(null);
    toast("The last self-test has been forgotten");
  };

  /** "3840×2160 · 23.976 Hz · HDR · yuv420p10le · vaapi" */
  const seenLine = (o: SelfTestObservation): string =>
    [o.display, o.width && o.height ? `${o.width}×${o.height}` : null, o.refreshHz ? `${o.refreshHz} Hz` : null, o.hdr === undefined ? null : o.hdr ? "HDR" : "SDR", o.codec, o.hwdec]
      .filter(Boolean)
      .join(" · ");

  return (
    <div class="selftest">
      <Show when={phase() === "idle"}>
        <h2>Self-test</h2>
        <p class="hint">
          Plays short clips the box makes itself and asks a question about each, then asks you to press every button on the remote. Nothing changes: it records what the box and
          the TV did, so a picture or sound problem after an update can be looked into without a laptop.
        </p>
        <Show when={!canRun()}>
          <p class="hint warn">This box's software is too old for the self-test. Update the box (Settings › About), then come back.</p>
        </Show>
        <Show when={problem()}>
          <p class="hint warn">{problem()}</p>
        </Show>
        <For each={steps()}>{(s) => <Row label={`${s.label}${s.clip ? "" : " (no clip)"}`} hint={s.detail} />}</For>
        <Row label="Press every button" hint={`${SELF_TEST_KEYS.length} keys, about a minute`} />
        <div class="actions">
          <button class="btn btn-primary" data-focus data-autofocus disabled={!canRun()} onClick={() => void begin()}>
            <Icon name="play" /> Start the self-test
          </button>
          <Show when={last()}>
            {(r) => (
              <button class="btn" data-focus onClick={() => void forget()}>
                <Icon name="trash" /> Forget the last run
              </button>
            )}
          </Show>
        </div>
        <Show when={last()}>
          {(r) => (
            <div class="selftest-last">
              <h3>Last run</h3>
              <p class="hint">
                {new Date(r().at).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · {selfTestSummary(r())}
              </p>
              <For each={r().results}>
                {(item) => (
                  <Row
                    label={`${item.answer === "yes" ? "Yes" : item.answer === "no" ? "No" : "Skipped"} · ${item.label}`}
                    hint={[seenLine(item.observed), item.note].filter(Boolean).join(" — ")}
                  />
                )}
              </For>
              <Show when={r().missingKeys.length}>
                <Row label="Buttons that never arrived" hint={r().missingKeys.map((k) => SELF_TEST_KEY_LABELS[k]).join(", ")} value={`${r().missingKeys.length}`} />
              </Show>
            </div>
          )}
        </Show>
      </Show>

      <Show when={phase() === "preparing"}>
        <h2>Self-test</h2>
        <p class="hint">The box is making the test clips. This takes a few seconds the first time.</p>
      </Show>

      <Show when={phase() === "playing" || (phase() === "asking" && step())}>
        <Show when={step()}>
          {(s) => (
            <div class="selftest-step">
              <p class="hint">
                Step {stepIndex() + 1} of {steps().length}
              </p>
              <h2>{s().label}</h2>
              <p class="hint">{s().detail}</p>
              <Show when={observed()}>{(o) => <Row label="The box reported" value={seenLine(o()) || "nothing yet"} />}</Show>
              <Show when={phase() === "asking"}>
                <p class="selftest-ask">{s().ask}</p>
                <div class="actions">
                  <button class="btn btn-primary btn-large" data-focus data-autofocus onClick={() => answer("yes")}>
                    <Icon name="check" /> Yes
                  </button>
                  <button class="btn btn-large" data-focus onClick={() => answer("no")}>
                    <Icon name="close" /> No
                  </button>
                  <button class="btn" data-focus onClick={() => answer("skipped")}>
                    Skip
                  </button>
                </div>
              </Show>
              <Show when={phase() === "playing"}>
                <p class="hint">Playing…</p>
              </Show>
            </div>
          )}
        </Show>
      </Show>

      <Show when={phase() === "keys"}>
        <h2>Press every button</h2>
        <p class="hint">
          Press each button on the remote when it is shown. Anything that never arrives is listed at the end, which is how a mis-mapped key or a remote that isn't reaching the box
          gets found.
        </p>
        <div class="selftest-key">
          <Show when={waiting()} fallback={<p class="selftest-ask">All the buttons arrived.</p>}>
            {(k) => (
              <>
                <div class="selftest-key-name">{SELF_TEST_KEY_LABELS[k()]}</div>
                <p class="hint">
                  {seen().size} of {KEY_ORDER.length} so far
                </p>
              </>
            )}
          </Show>
        </div>
        <div class="actions">
          <button class="btn" data-focus onClick={() => skipKey()}>
            Skip this one
          </button>
          <button class="btn" data-focus onClick={() => skipAllKeys()}>
            Skip the rest
          </button>
          <button class="btn" data-focus onClick={() => void finishReport(seen())}>
            Finish
          </button>
        </div>
      </Show>

      <Show when={phase() === "done"}>
        <h2>Self-test finished</h2>
        <Show when={last()}>
          {(r) => (
            <>
              <p class="hint">{selfTestSummary(r())}</p>
              <For each={r().results}>
                {(item) => (
                  <Row
                    label={`${item.answer === "yes" ? "Yes" : item.answer === "no" ? "No" : "Skipped"} · ${item.label}`}
                    hint={[seenLine(item.observed), item.note].filter(Boolean).join(" — ")}
                  />
                )}
              </For>
              <Show when={r().missingKeys.length}>
                <Row label="Buttons that never arrived" hint={r().missingKeys.map((k) => SELF_TEST_KEY_LABELS[k]).join(", ")} value={`${r().missingKeys.length}`} />
              </Show>
              <p class="hint">The report is on the phone's Stats page and in the Hub's diagnostics.</p>
            </>
          )}
        </Show>
        <div class="actions">
          <button class="btn btn-primary" data-focus data-autofocus onClick={() => setPhase("idle")}>
            Done
          </button>
          <button class="btn" data-focus onClick={() => rerun()}>
            <Icon name="restart" /> Run it again
          </button>
        </div>
      </Show>
    </div>
  );
}

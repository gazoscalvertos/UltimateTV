// Measuring how the TV app feels (issue #108), opened from Settings › About › Measure the UI.
//
// The app has been timing itself since it started (ui/src/perf.ts). This screen puts those numbers
// in front of someone with a remote: what the issue asks for, what this box actually did, and a
// button that sends the lot to the Hub so it shows up on the phone's Stats page and in
// /api/diagnostics. It fixes nothing on purpose — a number you can look at beats a guess you can't.

import { createSignal, For, Show } from "solid-js";
import { type PerfReport, PERF_TARGETS, perfMisses, perfSummary, perfVerdict } from "@ultimatetv/shared";
import { hub } from "../api";
import { Icon } from "../components/Icon";
import { Row } from "../components/SettingRow";
import { finishPass } from "../perf";
import { errorToast, toast } from "../store";

const TARGET_ROWS: { label: string; detail: string; ms: number }[] = [
  { label: "Boot to \"Who's watching?\"", detail: "The app starting on the box", ms: PERF_TARGETS.boot },
  { label: "Home ready for the remote", detail: "From picking a profile to a key press landing", ms: PERF_TARGETS.home },
  { label: "A guide step", detail: "A press in the guide to the frame that shows it (50 fps is 20 ms)", ms: PERF_TARGETS.guide },
  { label: "A frame while a film plays", detail: "With the player and overlays going (60 Hz is 17 ms)", ms: PERF_TARGETS.playback },
];

const ms = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`);

export function MeasureSection() {
  const [report, setReport] = createSignal<PerfReport | null>(null);
  const [busy, setBusy] = createSignal(false);
  void hub.perf().then((r) => setReport(r.report), () => undefined);

  /** Times what the app has seen so far and sends it to the Hub. */
  const measure = async () => {
    setBusy(true);
    try {
      const r = finishPass();
      if (!r.samples.length) {
        toast("Nothing to measure yet. Open the guide and play something, then try again.", "bad");
        return;
      }
      const saved = await hub.savePerf(r);
      setReport(saved.report);
      const missed = perfMisses(saved.report);
      toast(missed.length ? `${missed.length} of ${saved.report.samples.length} are slower than their target` : "Everything is inside its target", missed.length ? "bad" : "good");
    } catch (err) {
      errorToast(err);
    } finally {
      setBusy(false);
    }
  };

  const forget = async () => {
    try {
      await hub.clearPerf();
      setReport(null);
      toast("Forgotten");
    } catch (err) {
      errorToast(err);
    }
  };

  return (
    <>
      <h2>Measure the UI</h2>
      <p class="hint">
        The TV app times itself as you use it — the picker appearing, Home taking a key press, a step in the guide, and the gap between
        frames while a film plays — and this sends the numbers to the Hub. They show on the phone's Stats page and in the Hub's
        diagnostics, so "the menus feel slow on the new TV" can be looked at with numbers.
      </p>
      <For each={TARGET_ROWS}>{(t) => <Row label={t.label} hint={t.detail} value={`target ${ms(t.ms)}`} />}</For>
      <div class="actions">
        <button class="btn btn-primary" data-focus data-autofocus disabled={busy()} onClick={() => void measure()}>
          <Icon name="restart" /> Measure now
        </button>
        <Show when={report()}>
          <button class="btn" data-focus onClick={() => void forget()}>
            <Icon name="trash" /> Forget the last run
          </button>
        </Show>
      </div>
      <p class="hint">
        Guide and playback figures only exist once you've opened the guide and played something since the app started. A run made just
        after the TV was turned on will only have boot and Home in it.
      </p>
      <Show when={report()} fallback={<p class="hint">No timing run yet.</p>}>
        {(r) => (
          <div class="perf-last">
            <h3>Last run</h3>
            <p class="hint">
              {new Date(r().at).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              {r().width && r().height ? ` · ${r().width}×${r().height}${r().refreshHz ? ` at ${r().refreshHz} Hz` : ""}` : ""}
              {r().appVersion ? ` · app ${r().appVersion}` : ""}
            </p>
            <p class="hint">{perfVerdict(r())}</p>
            <For each={perfSummary(r())}>{(line) => <Row label={line} />}</For>
            <Show when={perfMisses(r()).length}>
              <p class="hint warn">
                Slower than the target: {perfMisses(r()).map((s) => s.label).join(", ")}. Tell whoever looks after the app, with the run
                on the phone's Stats page as the evidence.
              </p>
            </Show>
            <For each={r().notes ?? []}>{(n) => <Row label={n} />}</For>
          </div>
        )}
      </Show>
    </>
  );
}

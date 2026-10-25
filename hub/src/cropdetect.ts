// Finds black bars baked into a video (a 4:3 video pillarboxed into a 16:9 upload, a film-style
// letterbox), so the box can crop them away and the music video fills the screen.

import { spawn } from "node:child_process";

/** Returns mpv's video-crop ("WxH+X+Y"), or "" when there's nothing worth cropping. */
export type CropDetect = (file: string) => Promise<string>;

/** Bars thinner than this share of the picture are left alone. */
const MIN_BAR = 0.02;

/**
 * ffmpeg's cropdetect over the keyframes only (cheap even for 4K AV1 on the N150), keeping the
 * largest picture area seen in any of them, so a dark scene never crops away real picture.
 */
export const ffmpegCropDetect: CropDetect = (file) =>
  new Promise((resolve) => {
    const ff = spawn(
      "ffmpeg",
      ["-hide_banner", "-nostats", "-threads", "2", "-skip_frame", "nokey", "-i", file, "-an", "-sn", "-vf", "cropdetect=limit=24:round=2:reset=0", "-f", "null", "-"],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let err = "";
    ff.stderr.setEncoding("utf8").on("data", (c: string) => (err = (err + c).slice(-8000)));
    const timer = setTimeout(() => ff.kill("SIGKILL"), 10 * 60_000);
    ff.on("error", () => resolve(""));
    ff.on("close", () => {
      clearTimeout(timer);
      resolve(cropFromLog(err));
    });
  });

/** Reads the last cropdetect line and the stream's size from ffmpeg's log. */
export function cropFromLog(log: string): string {
  const crops = [...log.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)];
  const last = crops[crops.length - 1];
  const size = /Stream #\S+: Video: .*?(\d{3,5})x(\d{3,5})/.exec(log);
  if (!last || !size) return "";
  const [w, h, x, y] = last.slice(1, 5).map(Number) as [number, number, number, number];
  const W = Number(size[1]);
  const H = Number(size[2]);
  if (w <= 0 || h <= 0 || w > W || h > H) return "";
  if (W - w < W * MIN_BAR && H - h < H * MIN_BAR) return "";
  return `${w}x${h}+${x}+${y}`;
}

// Emby: Jellyfin's ancestor, so the API is nearly the same and this client only overrides what
// differs. Items, resume, next up, progress, played flags, direct-play streams and library refresh
// are the calls JellyfinClient already makes; what changes is the sign-in header, the lack of Quick
// Connect, the subtitle URL, and where skip markers live (Emby keeps them as chapter markers, not
// as Jellyfin's /MediaSegments).
//
// Written from Emby's API documentation and not yet tried against a real Emby server (#216).

import type { JfItem, MediaSegment } from "./media.js";
import { JellyfinClient, type JellyfinAuth } from "./jellyfin.js";

export type EmbyAuth = JellyfinAuth;

interface EmbyChapter {
  StartPositionTicks: number;
  Name?: string;
  MarkerType?: string;
}

export class EmbyClient extends JellyfinClient {
  override readonly kind = "emby" as const;
  override readonly name = "Emby";

  protected override headers(): Record<string, string> {
    const token = this.auth.token ? `, Token="${this.auth.token}"` : "";
    const header = `MediaBrowser Client="UltimateTV", Device="UltimateTV Hub", DeviceId="${this.deviceId}", Version="1.0.0"${token}`;
    return {
      "X-Emby-Authorization": header,
      Authorization: header,
      ...(this.auth.token ? { "X-Emby-Token": this.auth.token } : {}),
      "Content-Type": "application/json",
    };
  }

  /** Emby has no Quick Connect for other apps: sign in with a name and password. */
  override quickConnectInitiate(): Promise<{ code: string; secret: string }> {
    return Promise.reject(new Error("Emby has no Quick Connect: sign in with a user name and password"));
  }

  override subtitleUrl(itemId: string, mediaSourceId: string, index: number, codec = "srt"): string {
    const ext = codec === "ass" || codec === "ssa" ? codec : "srt";
    return `${this.base}/Videos/${itemId}/${mediaSourceId}/Subtitles/${index}/Stream.${ext}?api_key=${encodeURIComponent(this.auth.token ?? "")}`;
  }

  /**
   * Skip markers from Emby's chapter markers: IntroStart/IntroEnd (Emby's intro detection, or the
   * ones a user set) and CreditsStart, which runs to the end of the film.
   */
  override async segments(itemId: string): Promise<MediaSegment[]> {
    try {
      const item = await this.get<JfItem & { Chapters?: EmbyChapter[] }>(`/Users/${this.userId}/Items/${itemId}?Fields=Chapters`);
      const marks = item.Chapters ?? [];
      const out: MediaSegment[] = [];
      const introStart = marks.find((c) => c.MarkerType === "IntroStart");
      const introEnd = marks.find((c) => c.MarkerType === "IntroEnd");
      if (introStart && introEnd && introEnd.StartPositionTicks > introStart.StartPositionTicks) {
        out.push({ Type: "Intro", StartTicks: introStart.StartPositionTicks, EndTicks: introEnd.StartPositionTicks });
      }
      const credits = marks.find((c) => c.MarkerType === "CreditsStart");
      if (credits && item.RunTimeTicks && item.RunTimeTicks > credits.StartPositionTicks) {
        out.push({ Type: "Outro", StartTicks: credits.StartPositionTicks, EndTicks: item.RunTimeTicks });
      }
      return out;
    } catch {
      return [];
    }
  }
}

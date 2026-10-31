// Runs in the UI page before it loads and gives it `window.ultimatetv`, the BoxAgent the UI plays
// through. Everything is a message to the main process; nothing else of Electron or Node leaks in.

import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

const call =
  (method: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke("agent", method, ...args);

function subscribe(channel: string, listener: (value: unknown) => void): () => void {
  const handler = (_e: IpcRendererEvent, value: unknown) => listener(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld("ultimatetv", {
  // main.ts passes --utv-desktop in desktop mode (mode.ts).
  desktop: process.argv.includes("--utv-desktop"),
  info: call("info"),
  play: call("play"),
  stop: call("stop"),
  pause: call("pause"),
  seek: call("seek"),
  goLive: call("goLive"),
  setAudioTrack: call("setAudioTrack"),
  setSubtitleTrack: call("setSubtitleTrack"),
  setNightMode: call("setNightMode"),
  setLayout: call("setLayout"),
  stats: call("stats"),
  wakeTv: call("wakeTv"),
  reload: call("reload"),
  software: call("software"),
  update: call("update"),
  rollback: call("rollback"),
  spotify: call("spotify"),
  spotifyLibrary: call("spotifyLibrary"),
  spotifyTracks: call("spotifyTracks"),
  spotifyPlay: call("spotifyPlay"),
  spotifyControl: call("spotifyControl"),
  spotifySetup: call("spotifySetup"),
  openWebApp: call("openWebApp"),
  closeWebApp: call("closeWebApp"),
  webAppKey: call("webAppKey"),
  webAppText: call("webAppText"),
  webAppControl: call("webAppControl"),
  webApp: call("webApp"),
  webAppLogin: call("webAppLogin"),
  downloads: call("downloads"),
  download: call("download"),
  removeDownload: call("removeDownload"),
  retryDownload: call("retryDownload"),
  downloadSettings: call("downloadSettings"),
  localCopy: call("localCopy"),
  downloadPosition: call("downloadPosition"),
  cast: call("cast"),
  castSettings: call("castSettings"),
  launchApp: call("launchApp"),
  stopApp: call("stopApp"),
  tvStandby: call("tvStandby"),
  tvApps: call("tvApps"),
  addSubtitle: call("addSubtitle"),
  setSubtitleStyle: call("setSubtitleStyle"),
  setVolume: call("setVolume"),
  offlineProfile: call("offlineProfile"),
  // Only the box's own Hub-down screen (box/offline) uses these.
  hubStatus: call("hubStatus"),
  retryHub: call("retryHub"),
  onCast: (listener: (s: unknown) => void) => subscribe("agent:cast", listener),
  onDownloads: (listener: (d: unknown) => void) => subscribe("agent:downloads", listener),
  onSpotify: (listener: (s: unknown) => void) => subscribe("agent:spotify", listener),
  onWebApp: (listener: (s: unknown) => void) => subscribe("agent:webapp", listener),
  onState: (listener: (s: unknown) => void) => subscribe("agent:state", listener),
  onPower: (listener: (active: unknown) => void) => subscribe("agent:power", listener),
});

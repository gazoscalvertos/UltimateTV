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
  onState: (listener: (s: unknown) => void) => subscribe("agent:state", listener),
  onPower: (listener: (active: unknown) => void) => subscribe("agent:power", listener),
});

// The part that only runs on the console: a window, a pad, and a video player.
//
// Everything here is deliberately thin — it draws the View the portable app hands it and it
// turns controller presses into KeyPresses. The logic that decides what to draw lives in
// ui.cpp, which the build machine can test.
#ifndef UTV_PLATFORM_HPP
#define UTV_PLATFORM_HPP

#include <memory>
#include <string>
#include <vector>

namespace utv {

class App;
class Video;

/** A window, an ImGui context and a renderer, hidden so this header stays free of SDL. */
class Window {
 public:
  virtual ~Window() = default;
  /** Draws one frame of `app`. */
  virtual void draw(App& app) = 0;
  /**
   * Waits up to `timeoutMs` for something to happen and answers the key presses that arrived
   * (empty on a timeout). `closed` is set when the user pressed the pad's PS button twice or
   * the window went away.
   */
  virtual std::vector<int> pump(int timeoutMs, bool& closed) = 0;
  /** The size of the drawable area, which the layout uses. */
  virtual void size(int& width, int& height) = 0;
  /** The player to draw under the on-screen controls while a film is on. */
  virtual void setVideo(Video* video) = 0;
};

/**
 * Whether to ask the console for its biggest picture (4K) or for 1080p.
 *
 * On by default. 1080p uses less of the console, so `--1080p` on the command line is the way to
 * tell whether a 4K picture is the thing the console can't keep up with.
 */
void setWant4k(bool on);

/** Opens the window. Answers nullptr with a reason in `problem` when it can't. */
std::unique_ptr<Window> openWindow(std::string& problem);

/** The video player backed by the console's own decoder (see video.cpp). */
std::unique_ptr<Video> makeVideo(std::string& problem);

/**
 * Draws the current frame of `video` into `renderer` (an SDL_Renderer, passed as void* so this
 * header stays free of SDL). Answers false when there is no frame to draw yet.
 */
bool drawVideoFrame(Video& video, void* renderer, int width, int height);

}  // namespace utv

#endif  // UTV_PLATFORM_HPP

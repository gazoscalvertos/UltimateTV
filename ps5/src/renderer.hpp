// Which way of drawing to ask the console for, and in what order.
//
// SDL answers a failed SDL_CreateRenderer(window, -1, flags) with one sentence, "Couldn't find
// matching render driver", which throws away the reason each driver gave. On the console that was
// the whole log: the window opened and then nothing could draw into it, with no hint why. So the
// app no longer lets SDL choose. It lists the drivers SDL was built with and tries them one at a
// time, by index and with no flags, writing each one's own error to the log, then falls back to
// drawing straight into the window's surface, then to a smaller window.
//
// This has no SDL in it, so `make -C ps5 test` proves the order on a build machine.
#ifndef UTV_RENDERER_HPP
#define UTV_RENDERER_HPP

#include <string>
#include <vector>

#include "display.hpp"

namespace utv {

/** One render driver SDL was built with, as SDL_GetRenderDriverInfo describes it. */
struct RenderDriver {
  /** SDL's own name: "software", "opengl", "opengles2", ... */
  std::string name;
  /** Its position in SDL's list, which is what SDL_CreateRenderer takes. */
  int index = -1;
};

/** One thing to try. */
struct RenderAttempt {
  enum class Kind {
    /** SDL_CreateRenderer(window, index, 0): one driver, named, with no flags to mismatch. */
    Driver,
    /** SDL_GetWindowSurface + SDL_CreateSoftwareRenderer: no render driver involved at all. */
    WindowSurface,
  };
  Kind kind = Kind::Driver;
  int index = -1;
  std::string name;
};

/**
 * The order to try the drivers in.
 *
 * `preferred` (from `--renderer=NAME` or /data/ultimatetv/renderer.txt) goes first when SDL has
 * it. Then "software", because it is the one the console's SDL can always back with its own
 * framebuffer, and because trying OpenGL first is not free there: a GL driver that gets as far as
 * loading Mesa hands the display to the GPU, after which the software path is refused. Then every
 * other driver in SDL's order, and last the window's surface drawn into directly.
 */
std::vector<RenderAttempt> renderAttempts(const std::vector<RenderDriver>& drivers,
                                          const std::string& preferred);

/**
 * The window sizes to try, biggest first: the size picked from the display's modes, then
 * 1920x1080, then 1280x720, each only once and never bigger than the first.
 */
std::vector<PixelSize> windowSizesToTry(const PixelSize& first);

/** "opengles2" from " OpenGLES2\n": a name read from a file or the command line, tidied. */
std::string cleanRendererName(const std::string& raw);

/** A reason for the log that is never blank: the console doesn't always give one. */
std::string reasonOrUnknown(const char* why);

}  // namespace utv

#endif  // UTV_RENDERER_HPP

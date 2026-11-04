#include "display.hpp"

#include <algorithm>

namespace utv {

namespace {

/** The biggest picture the app will ever ask for, whatever the console offers. */
const int MAX_WIDTH = 3840;
const int MAX_HEIGHT = 2160;
/** The layout's own height: every size in the app is written as if the screen were this tall. */
const int LAYOUT_HEIGHT = 1080;

}  // namespace

PixelSize pickOutputSize(const std::vector<ModeSize>& offered, bool want4k) {
  PixelSize best;
  bool found = false;
  for (const ModeSize& mode : offered) {
    if (mode.width <= 0 || mode.height <= 0) continue;
    // A mode wider or taller than 4K is no use: the console would have to shrink it, and a
    // television that reports 8K still shows 4K films best at 3840x2160.
    if (mode.width > MAX_WIDTH || mode.height > MAX_HEIGHT) continue;
    if (!want4k && mode.height > LAYOUT_HEIGHT) continue;
    if (!found || static_cast<long long>(mode.width) * mode.height >
                      static_cast<long long>(best.width) * best.height) {
      best.width = mode.width;
      best.height = mode.height;
      found = true;
    }
  }
  if (found) return best;
  // The console couldn't be asked — some SDL drivers don't report their modes at all. A picture
  // still has to appear, and a console that can't answer is the one to ask for 4K and let it
  // answer with what it can actually do; that is exactly what a 4K television needs to happen.
  PixelSize fallback;
  if (want4k) {
    fallback.width = MAX_WIDTH;
    fallback.height = MAX_HEIGHT;
  }
  return fallback;
}

float uiScaleFor(int height) {
  if (height <= 0) return 1.0f;
  return static_cast<float>(height) / static_cast<float>(LAYOUT_HEIGHT);
}

PixelSize videoSizeFor(const PixelSize& surface) {
  if (!isUsableSize(surface)) return PixelSize();
  PixelSize size;
  size.width = std::min(surface.width, MAX_WIDTH);
  size.height = std::min(surface.height, MAX_HEIGHT);
  return size;
}

bool isUsableSize(const PixelSize& size) { return size.width > 0 && size.height > 0; }

}  // namespace utv

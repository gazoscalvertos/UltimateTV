// What size the console draws at, and how big everything in the picture should be.
//
// A television app has to look the same on a 1080p set and a 4K one: the text has to be the
// same physical size, and a 4K film has to reach the screen without being put through 1080p on
// the way. So the size comes from what the console actually gives us, and every other number
// (the font, the bar heights, the largest picture the decoder should make) is worked out from
// its height. This file has no SDL in it so `make -C ps5 test` can prove the arithmetic.
#ifndef UTV_DISPLAY_HPP
#define UTV_DISPLAY_HPP

#include <vector>

namespace utv {

/** A width and a height in pixels. */
struct PixelSize {
  int width = 1920;
  int height = 1080;
};

/** One mode the console offers, as SDL reports them. */
struct ModeSize {
  int width = 0;
  int height = 0;
};

/**
 * The size to ask the console for.
 *
 * `offered` is every mode the display reports; the biggest one no larger than 4K is taken,
 * because a 4K film can only be shown at 4K if the surface is 4K. `want4k` false keeps it to
 * 1080p, which is the way to test whether the console can keep up with a 4K picture.
 * When nothing usable is offered, 1920x1080 is answered — a picture has to appear.
 */
PixelSize pickOutputSize(const std::vector<ModeSize>& offered, bool want4k);

/**
 * How much bigger everything in the picture must be drawn at this height, where 1.0 is the
 * 1080p the app's layout was designed at. The font scale is the layout's own 1.9 multiplied
 * by this.
 */
float uiScaleFor(int height);

/** The largest picture the decoder should be asked for: the surface, though never above 4K. */
PixelSize videoSizeFor(const PixelSize& surface);

/** True when the size can actually be shown (a mode of 0x0 arrives from SDL on a bad day). */
bool isUsableSize(const PixelSize& size);

}  // namespace utv

#endif  // UTV_DISPLAY_HPP

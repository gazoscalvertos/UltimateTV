// What resolution the app asks the console for, and what it does with what it gets.
//
// The console's SDL driver offers two modes: 1920x1080 and 3840x2160. It used to be asked for
// 1080p and to draw a 1080p canvas into it, which meant a 4K film was decoded, shrunk to 1080p,
// and then stretched back up by the console — two resamplings of every frame for nothing. Now
// the surface, the layout and the decoder all follow the height the console actually gives.
#include "display.hpp"

#include "test.hpp"

#include <string>

namespace {

using utv::ModeSize;
using utv::PixelSize;
using utv::isUsableSize;
using utv::pickOutputSize;
using utv::uiScaleFor;
using utv::videoSizeFor;

TEST(picksTheBestModeTheConsoleOffers) {
  std::vector<ModeSize> offered{{1920, 1080}, {1280, 720}, {3840, 2160}};
  const PixelSize size = pickOutputSize(offered, true);
  CHECK_EQ(size.width, 3840);
  CHECK_EQ(size.height, 2160);
  CHECK_EQ(uiScaleFor(size.height), 2.0f);
}

TEST(asksFor1080pWhen4kIsNotWanted) {
  // This is the switch for a house where the console can't keep up with a 4K picture.
  std::vector<ModeSize> offered{{1920, 1080}, {3840, 2160}};
  const PixelSize size = pickOutputSize(offered, false);
  CHECK_EQ(size.width, 1920);
  CHECK_EQ(size.height, 1080);
  CHECK_EQ(uiScaleFor(size.height), 1.0f);
}

TEST(fallsBackTo1080pWhenTheConsoleOnlyOffersThat) {
  const PixelSize size = pickOutputSize({{1920, 1080}, {1280, 720}}, true);
  CHECK_EQ(size.width, 1920);
  CHECK_EQ(size.height, 1080);
}

TEST(neverAsksForMoreThan4k) {
  // An 8K mode would make the console shrink the picture and cost more for no gain.
  const PixelSize size = pickOutputSize({{3840, 2160}, {7680, 4320}}, true);
  CHECK_EQ(size.width, 3840);
  CHECK_EQ(size.height, 2160);
}

TEST(asksFor4kWhenTheConsoleCannotSayWhatItOffers) {
  // A driver that doesn't report its modes must not quietly drop everything to 1080p: that is
  // the one thing a 4K television can't have. Asking for 4K lets the console answer with what
  // it can actually do.
  const PixelSize size = pickOutputSize({}, true);
  CHECK_EQ(size.width, 3840);
  CHECK_EQ(size.height, 2160);
  CHECK(isUsableSize(size));
  // With 4K asked against, the fallback is the size the app was drawn for.
  const PixelSize small = pickOutputSize({}, false);
  CHECK_EQ(small.width, 1920);
  CHECK_EQ(small.height, 1080);
}

TEST(ignoresRubbishModes) {
  // SDL answers 0x0 for a display it couldn't ask; that must not win by looking the largest.
  const PixelSize size = pickOutputSize({{0, 0}, {-1, -1}, {1920, 1080}}, true);
  CHECK_EQ(size.width, 1920);
}

TEST(theCanvasIsTwiceAsBigAt4kSoTheTextStaysTheSameSize) {
  // The layout is written for 1080p. At 2160 the font has to be doubled or the text would be
  // half the size on the wall, which is the whole reason to scale by the height.
  CHECK_NEAR(uiScaleFor(2160), 2.0f, 0.001f);
  CHECK_NEAR(uiScaleFor(1440), 1.3333f, 0.001f);
  CHECK_EQ(uiScaleFor(0), 1.0f);
}

TEST(theDecoderIsAskedForTheSurfaceThoughNeverAbove4k) {
  CHECK_EQ(videoSizeFor({3840, 2160}).width, 3840);
  CHECK_EQ(videoSizeFor({7680, 4320}).width, 3840);
  CHECK_EQ(videoSizeFor({1920, 1080}).height, 1080);
  // A surface of nothing means the caller is confused; the app's own size is the answer.
  CHECK_EQ(videoSizeFor({0, 0}).width, 1920);
}

}  // namespace

int main() { return utvtest::run(); }

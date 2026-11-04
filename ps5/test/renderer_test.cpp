// The order the app asks the console for a way to draw.
//
// On the console the window opened and then SDL answered "Couldn't find matching render driver",
// which is SDL's summary of every driver failing and says nothing about why any of them did. The
// app now tries each driver itself, in an order chosen for the console, so the log shows every
// reason. The order is a decision, so it is tested here rather than discovered on a television.
#include "renderer.hpp"

#include "test.hpp"

namespace {

using utv::PixelSize;
using utv::RenderAttempt;
using utv::RenderDriver;
using utv::renderAttempts;
using utv::windowSizesToTry;

/** The drivers the console's SDL is built with, in SDL's own order. */
std::vector<RenderDriver> consoleDrivers() {
  return {RenderDriver{"opengl", 0}, RenderDriver{"opengles2", 1}, RenderDriver{"opengles", 2},
          RenderDriver{"software", 3}};
}

std::string nameAt(const std::vector<RenderAttempt>& attempts, size_t i) {
  return i < attempts.size() ? attempts[i].name : std::string("<nothing here>");
}

TEST(triesSoftwareFirstThenEveryOtherDriverThenTheSurface) {
  const auto attempts = renderAttempts(consoleDrivers(), "");
  CHECK_EQ(attempts.size(), size_t(5));
  CHECK_EQ(nameAt(attempts, 0), std::string("software"));
  CHECK_EQ(attempts[0].index, 3);
  CHECK_EQ(nameAt(attempts, 1), std::string("opengl"));
  CHECK_EQ(nameAt(attempts, 2), std::string("opengles2"));
  CHECK_EQ(nameAt(attempts, 3), std::string("opengles"));
  CHECK(attempts.back().kind == RenderAttempt::Kind::WindowSurface);
}

TEST(aPreferredDriverGoesFirstAndIsNotTriedTwice) {
  const auto attempts = renderAttempts(consoleDrivers(), " OpenGLES2\n");
  CHECK_EQ(attempts.size(), size_t(5));
  CHECK_EQ(nameAt(attempts, 0), std::string("opengles2"));
  CHECK_EQ(attempts[0].index, 1);
  CHECK_EQ(nameAt(attempts, 1), std::string("software"));
  CHECK_EQ(nameAt(attempts, 2), std::string("opengl"));
  CHECK_EQ(nameAt(attempts, 3), std::string("opengles"));
}

TEST(anUnknownPreferredDriverIsIgnored) {
  const auto attempts = renderAttempts(consoleDrivers(), "metal");
  CHECK_EQ(attempts.size(), size_t(5));
  CHECK_EQ(nameAt(attempts, 0), std::string("software"));
}

TEST(withNoDriversAtAllTheSurfaceIsStillTried) {
  // An SDL built with its renderers disabled lists none; the window's surface still works there.
  const auto attempts = renderAttempts({}, "");
  CHECK_EQ(attempts.size(), size_t(1));
  CHECK(attempts[0].kind == RenderAttempt::Kind::WindowSurface);
}

TEST(windowSizesStepDownFrom4k) {
  const auto sizes = windowSizesToTry(PixelSize{3840, 2160});
  CHECK_EQ(sizes.size(), size_t(3));
  CHECK_EQ(sizes[0].height, 2160);
  CHECK_EQ(sizes[1].height, 1080);
  CHECK_EQ(sizes[2].height, 720);
}

TEST(windowSizesFrom1080pDoNotRepeatIt) {
  const auto sizes = windowSizesToTry(PixelSize{1920, 1080});
  CHECK_EQ(sizes.size(), size_t(2));
  CHECK_EQ(sizes[0].height, 1080);
  CHECK_EQ(sizes[1].height, 720);
}

TEST(windowSizesNeverGrowPastTheFirst) {
  const auto sizes = windowSizesToTry(PixelSize{1280, 720});
  CHECK_EQ(sizes.size(), size_t(1));
  CHECK_EQ(sizes[0].width, 1280);
}

TEST(aBlankReasonIsSaidAsOne) {
  CHECK_EQ(utv::reasonOrUnknown(""), std::string("the console did not say why"));
  CHECK_EQ(utv::reasonOrUnknown(nullptr), std::string("the console did not say why"));
  CHECK_EQ(utv::reasonOrUnknown("sceVideoOutOpen: busy"), std::string("sceVideoOutOpen: busy"));
}

}  // namespace

int main() { return utvtest::run(); }

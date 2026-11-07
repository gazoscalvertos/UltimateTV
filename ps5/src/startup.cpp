#include "startup.hpp"

namespace utv {
namespace {

/** The driver's reason, or a sentence when it didn't give one. */
std::string reasonFor(const Subsystem& part) {
  return part.why.empty() ? std::string("the console did not say why") : part.why;
}

}  // namespace

Startup decideStartup(const Subsystem& video, const Subsystem& pad, const Subsystem& audio) {
  Startup startup;

  // The window is the whole app: with no picture there is nowhere to put a picture of a film,
  // and the console shows a black screen, so the reason it failed is the only thing worth
  // reporting and nothing else is started.
  if (!video.ok) {
    startup.fatal = reasonFor(video);
    return startup;
  }
  startup.canDraw = true;

  // The pad can arrive after the window: the loop already opens one that is plugged in later.
  if (!pad.ok) startup.notes.push_back(reasonFor(pad));

  // Sound is the part that fails on a current console and that must not stop the picture.
  startup.hasSound = audio.ok;
  if (!audio.ok) startup.notes.push_back(reasonFor(audio));

  return startup;
}

}  // namespace utv

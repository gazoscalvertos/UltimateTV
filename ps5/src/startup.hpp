// What the app does when the console refuses one of the three things it starts.
//
// SDL starts video, sound and the pad together and answers one word for all three. That was
// fine until a console's audio driver began refusing to initialise: the audio driver fails
// without explaining itself, the whole call answers "no", and the error it leaves behind is a
// stale one from the cursor code — so the app reported a window problem that was not one and
// drew nothing at all. Asking for the three separately makes the one that failed nameable, and
// this decides which of them the app can live without.
//
// This has no SDL in it, so `make -C ps5 test` proves the decision on a build machine.
#ifndef UTV_STARTUP_HPP
#define UTV_STARTUP_HPP

#include <string>
#include <vector>

namespace utv {

/** One thing the app asked the console for, and what came back. */
struct Subsystem {
  /** Whether it started. */
  bool ok = false;
  /** Why it didn't, in the driver's own words. Empty when the driver said nothing. */
  std::string why;
};

/** What to do about the answers. */
struct Startup {
  /** Whether there is a window to draw into. Without one there is no app. */
  bool canDraw = false;
  /** Whether sound came up. A film without sound is still worth watching. */
  bool hasSound = false;
  /** Why the app cannot run at all. Empty when it can. */
  std::string fatal;
  /** The things that failed but that the app carries on without, in the order they were asked. */
  std::vector<std::string> notes;
};


/**
 * Decides what the three answers mean.
 *
 * A window is the only thing the app cannot do without: it says `fatal` and nothing else
 * matters. The pad and the sound are both optional — the window keeps listening for a pad that
 * arrives later, and a film with no sound still has a picture — so their failures are only
 * noted, to be written to the log and (for sound) said on screen.
 */
Startup decideStartup(const Subsystem& video, const Subsystem& pad, const Subsystem& audio);

}  // namespace utv

#endif  // UTV_STARTUP_HPP

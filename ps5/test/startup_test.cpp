// What the app does when the console refuses one of the three things it starts.
//
// The console's SDL will not start video, the pad and sound in one call any more: on a current
// console the audio driver refuses to initialise and takes the whole call down with it, so the
// app never draws anything and shows a black screen. The parts are asked for one at a time and
// this decides what the answers mean — which is a decision, so it is tested here rather than
// discovered on a television.
#include "startup.hpp"

#include "test.hpp"

namespace {

using utv::Subsystem;
using utv::Startup;
using utv::decideStartup;

Subsystem started() { return Subsystem{true, ""}; }

Subsystem refused(const char* why) { return Subsystem{false, why}; }

/**
 * The note at `index`, or a stand-in when there isn't one.
 *
 * Indexing a vector past its end is undefined and takes the whole run down with a segfault,
 * which hides every test after it. A missing note is an ordinary test failure, so it is reported
 * as one: the stand-in never equals what a test asks for.
 */
const std::string& noteAt(const Startup& startup, size_t index) {
  static const std::string kMissing = "<there was no note here>";
  return index < startup.notes.size() ? startup.notes[index] : kMissing;
}

TEST(drawsThePictureWhenEverythingStarted) {
  const Startup startup = decideStartup(started(), started(), started());
  CHECK(startup.canDraw);
  CHECK(startup.hasSound);
  CHECK_EQ(startup.fatal, std::string());
  CHECK_EQ(startup.notes.size(), size_t(0));
}

TEST(refusesToRunWhenThereIsNoPicture) {
  // Without a window there is nothing to look at, so nothing else is worth starting.
  const Startup startup =
      decideStartup(refused("sceVideoOutOpen: 0x8000000a"), started(), started());
  CHECK(!startup.canDraw);
  CHECK_EQ(startup.fatal, std::string("sceVideoOutOpen: 0x8000000a"));
}

TEST(stillRunsWithNoSound) {
  // This is the console that failed to launch: its audio driver refuses, and the app used to
  // die with it. A film with no sound is worth watching; a black screen is not worth anything.
  const Startup startup = decideStartup(started(), started(), refused("no audio device"));
  CHECK(startup.canDraw);
  CHECK(!startup.hasSound);
  CHECK_EQ(startup.fatal, std::string());
  CHECK_EQ(startup.notes.size(), size_t(1));
  CHECK_EQ(noteAt(startup, 0), std::string("no audio device"));
}

TEST(stillRunsWithNoPad) {
  // A pad that isn't answered yet is not a broken app: it can be turned on after the picture
  // appears, and the window already listens for one arriving.
  const Startup startup = decideStartup(started(), refused("scePadInit: 0x802b000a"), started());
  CHECK(startup.canDraw);
  CHECK(startup.hasSound);
  CHECK_EQ(startup.fatal, std::string());
  CHECK_EQ(startup.notes.size(), size_t(1));
  CHECK_EQ(noteAt(startup, 0), std::string("scePadInit: 0x802b000a"));
}

TEST(keepsEveryReasonInTheOrderItHappened) {
  const Startup startup =
      decideStartup(started(), refused("no pad"), refused("no sound"));
  CHECK(startup.canDraw);
  CHECK_EQ(startup.notes.size(), size_t(2));
  CHECK_EQ(noteAt(startup, 0), std::string("no pad"));
  CHECK_EQ(noteAt(startup, 1), std::string("no sound"));
}

TEST(saysSoWhenTheConsoleGivesNoReason) {
  // A driver that fails without setting an error leaves an empty string behind, and a log line
  // that ends in a colon and nothing else is worse than useless.
  const Startup startup = decideStartup(started(), started(), refused(""));
  CHECK(startup.canDraw);
  CHECK(!startup.hasSound);
  CHECK_EQ(startup.notes.size(), size_t(1));
  CHECK_EQ(noteAt(startup, 0), std::string("the console did not say why"));
}

TEST(saysSoWhenThereIsNoPictureAndTheConsoleGaveNoReason) {
  // The fatal reason gets the same treatment: a blank reason is not a reason.
  const Startup startup = decideStartup(refused(""), started(), started());
  CHECK(!startup.canDraw);
  CHECK_EQ(startup.fatal, std::string("the console did not say why"));
}

}  // namespace

int main() { return utvtest::run(); }

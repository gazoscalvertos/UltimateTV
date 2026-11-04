// The console app's entry point: a window, a pad, and a loop.
//
// Everything that decides what happens lives in ui.cpp; this file only wires it together and
// keeps the picture moving. That split is why `make -C ps5 test` can test the whole app on a
// build machine without a PlayStation.
#include <cstdarg>
#include <cstdio>
#include <ctime>
#include <memory>
#include <string>

#include "hub.hpp"
#include "http.hpp"
#include "platform.hpp"
#include "ui.hpp"

namespace {

/**
 * How long the loop waits for a key press before it draws again.
 *
 * A film needs a new frame about every 16 ms; with no picture to decode, 30 ms is plenty and
 * costs the console almost nothing, so the app isn't busy while it sits on the guides.
 */
const int FRAME_MS = 30;

/** Where the Hub's address is remembered between runs. */
const char* const SESSION_PATH = "/data/ultimatetv/session.txt";

/**
 * Where the app writes down what it did on the way to a picture.
 *
 * A console that fails to start shows a black screen and nothing else: there is no terminal and
 * the payload loader's output does not reach the living room. This file is the only way to find
 * out afterwards whether the window failed, the decoder failed, or the Hub was never reached.
 * It is rewritten on every start, so it always describes the last attempt.
 */
const char* const LOG_PATH = "/data/ultimatetv/last-run.log";

std::FILE* gLog = nullptr;

/** Writes one line to the log and to stderr. Safe to call before the log is open. */
void say(const char* format, ...) {
  char line[512];
  va_list args;
  va_start(args, format);
  std::vsnprintf(line, sizeof(line), format, args);
  va_end(args);
  std::fprintf(stderr, "UltimateTV: %s\n", line);
  if (!gLog) return;
  const std::time_t now = std::time(nullptr);
  std::tm local{};
#if defined(_WIN32)
  localtime_s(&local, &now);
#else
  localtime_r(&now, &local);
#endif
  std::fprintf(gLog, "%02d:%02d:%02d  %s\n", local.tm_hour, local.tm_min, local.tm_sec, line);
  std::fflush(gLog);
}

}  // namespace

int main(int argc, char** argv) {
  using namespace utv;

  gLog = std::fopen(LOG_PATH, "wb");
  say("UltimateTV starting");

  std::string problem;

  // The command line is read first, because what it says changes how the window is made:
  //   `ultimatetv.elf http://192.168.0.19:8095` points a fresh console at the house Hub, which
  //   is how the installer finishes a new one;
  //   `--1080p` asks for a 1080p picture instead of the console's biggest, which is the way to
  //   find out whether 4K is the thing the console can't keep up with.
  std::string hubAddress;
  for (int i = 1; i < argc; ++i) {
    const std::string arg = argv[i] ? argv[i] : "";
    if (arg == "--1080p" || arg == "--1080") {
      setWant4k(false);
    } else if (!arg.empty() && arg[0] != '-') {
      hubAddress = arg;
    }
  }

  // The video player first: it owns the console's decoder, so a failure here is worth saying
  // before a window is on screen.
  std::unique_ptr<Video> video = makeVideo(problem);
  if (!video) {
    say("the video player wouldn't start: %s", problem.c_str());
    say("nothing was drawn; this log is the whole story");
    return 1;
  }
  say("the video player is up");

  // Before the window: if this fails there is nothing to look at, and a console shows a black
  // screen rather than an error. That is exactly why the log exists.
  std::unique_ptr<Window> window = openWindow(problem);
  if (!window) {
    say("the window wouldn't open: %s", problem.c_str());
    say("nothing was drawn; this log is the whole story");
    return 1;
  }
  int width = 0;
  int height = 0;
  window->size(width, height);
  // The height is what tells the two PS5 builds apart in a log after the fact.
  say("the window is up at %dx%d%s", width, height, height >= 2000 ? " (4K)" : "");

  SocketTransport transport;
  Hub hub(transport);
  ThreadJobs jobs;
  window->setVideo(video.get());
  App app(hub, jobs, *video);
  app.setSessionPath(SESSION_PATH);
  if (!hubAddress.empty()) {
    hub.setBaseUrl(hubAddress);
    say("the Hub was given on the command line: %s", hub.baseUrl().c_str());
  } else {
    say("looking for the Hub at %s", hub.baseUrl().c_str());
  }

  app.start();
  say("the app is running");

  bool closed = false;
  while (!closed) {
    const std::vector<int> keys = window->pump(FRAME_MS, closed);
    if (closed) break;
    for (int k : keys) app.key(KeyPress(static_cast<Key>(k)));
    app.drain();
    app.tick();
    window->draw(app);
  }

  say("the console asked the app to close");
  window.reset();
  video.reset();
  if (gLog) std::fclose(gLog);
  return 0;
}

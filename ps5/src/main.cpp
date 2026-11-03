// The console app's entry point: a window, a pad, and a loop.
//
// Everything that decides what happens lives in ui.cpp; this file only wires it together and
// keeps the picture moving. That split is why `make -C ps5 test` can test the whole app on a
// build machine without a PlayStation.
#include <cstdio>
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

}  // namespace

int main(int argc, char** argv) {
  using namespace utv;

  std::string problem;

  // The video player first: it owns the console's decoder, so a failure here is worth saying
  // before a window is on screen.
  std::unique_ptr<Video> video = makeVideo(problem);
  if (!video) {
    std::fprintf(stderr, "UltimateTV: %s\n", problem.c_str());
    return 1;
  }

  std::unique_ptr<Window> window = openWindow(problem);
  if (!window) {
    std::fprintf(stderr, "UltimateTV: %s\n", problem.c_str());
    return 1;
  }

  SocketTransport transport;
  Hub hub(transport);
  ThreadJobs jobs;
  window->setVideo(video.get());
  App app(hub, jobs, *video);
  app.setSessionPath(SESSION_PATH);
  // `ultimatetv.elf http://192.168.0.19:8095` sets the Hub from the command line, which is how
  // the installer points a fresh console at the house Hub.
  if (argc > 1 && argv[1] && argv[1][0] != '\0') hub.setBaseUrl(argv[1]);

  app.start();

  bool closed = false;
  while (!closed) {
    const std::vector<int> keys = window->pump(FRAME_MS, closed);
    if (closed) break;
    for (int k : keys) app.key(KeyPress(static_cast<Key>(k)));
    app.drain();
    app.tick();
    window->draw(app);
  }

  window.reset();
  video.reset();
  return 0;
}

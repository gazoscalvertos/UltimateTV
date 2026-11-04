// Tests for the screens and the keys, with no drawing and no network.
//
// Every test drives the app exactly the way a controller does: a key press in, then `drain`
// to let the Hub's answer through. The Hub is faked, so a test can say what it would answer
// and then check what the household sees.
#include "ui.hpp"

#include <cstdio>
#include <string>
#include <vector>

#include "json.hpp"
#include "test.hpp"

using utv::App;
using utv::HttpRequest;
using utv::HttpResponse;
using utv::HttpTransport;
using utv::Hub;
using utv::InlineJobs;
using utv::Json;
using utv::Key;
using utv::KeyPress;
using utv::PlaybackInfo;
using utv::Screen;
using utv::Video;

namespace {

/** A Hub that answers each path with whatever the test set up for it. */
class FakeHub : public HttpTransport {
 public:
  std::string health = R"({"ok":true,"version":"0.2.0","status":"ok"})";
  std::string profiles =
      R"({"profiles":[{"id":"family","name":"Family","kind":"adult","hasPin":false},)"
      R"({"id":"kids","name":"Kids","kind":"kids","hasPin":false},)"
      R"({"id":"protected","name":"Grown-ups","kind":"adult","hasPin":true}],)"
      R"("locked":false,"admin":true})";
  std::string home = R"({"hero":{"id":"demo:movie:copper-sky","name":"Copper Sky","year":2024,)"
                     R"("progress":0.375,"action":"resume","overview":"A film."},)"
                     R"("rails":[{"id":"continue","title":"Continue watching","kind":"titles",)"
                     R"("items":[{"id":"demo:movie:paper-moons","name":"Paper Moons","year":2019}]}]})";
  std::string guide = R"({"from":0,"to":1,"channels":[{"id":"bbc1","number":101,"name":"BBC One"}],)"
                      R"("programmes":{"bbc1":[{"id":"p1","channelId":"bbc1","start":1,)"
                      R"("end":2,"title":"Yesterday's News","categories":[]},)"
                      R"({"id":"p2","channelId":"bbc1","start":9000000000000,)"
                      R"("end":9000003600000,"title":"Later On","categories":[]}]}})";
  std::string play = R"({"url":"http://hub/clip.ts","title":"Copper Sky","live":false,)"
                     R"("startMs":2880000,"durationMs":7680000,"progressKey":"title:x",)"
                     R"("externalSubtitles":[],"skip":[]})";
  std::string unlockOk = R"({"token":"ptoken_1","profile":{"id":"protected"}})";
  std::string unlockBad = R"({"error":"That PIN isn't right"})";
  int unlockStatus = 200;

  std::vector<HttpRequest> seen;

  HttpResponse send(const HttpRequest& request) override {
    seen.push_back(request);
    const std::string& url = request.url;
    HttpResponse response;
    response.status = 200;
    if (url.find("/api/health") != std::string::npos) {
      response.body = health;
    } else if (url.find("/api/pair/screen") != std::string::npos) {
      response.body = R"({"token":"utv_device","device":{"id":"screen-1","kind":"tv"}})";
    } else if (url.find("/unlock") != std::string::npos) {
      response.status = unlockStatus;
      response.body = unlockStatus == 200 ? unlockOk : unlockBad;
    } else if (url.find("/api/profiles") != std::string::npos) {
      response.body = profiles;
    } else if (url.find("/api/home") != std::string::npos) {
      response.body = home;
    } else if (url.find("/api/guide") != std::string::npos) {
      response.body = guide;
    } else if (url.find("/api/play") != std::string::npos) {
      response.body = play;
    } else {
      response.body = R"({"ok":true})";
    }
    return response;
  }

  /** The last request whose URL contains `part`, or null. */
  const HttpRequest* last(const std::string& part) const {
    for (auto it = seen.rbegin(); it != seen.rend(); ++it) {
      if (it->url.find(part) != std::string::npos) return &*it;
    }
    return nullptr;
  }

  std::string headerOn(const HttpRequest& request, const std::string& name) const {
    for (const auto& h : request.headers) {
      if (h.first == name) return h.second;
    }
    return "";
  }
};

/** A video player that just remembers what it was told. */
class FakeVideo : public Video {
 public:
  bool opened = false;
  bool failOpen = false;
  std::string problem = "no decoder";
  bool isPaused = false;
  long position = 0;
  long duration = 0;
  long seekTo = -1;
  int opens = 0;
  int closes = 0;

  bool open(const PlaybackInfo&, long startMs, std::string& why) override {
    ++opens;
    if (failOpen) {
      why = problem;
      return false;
    }
    opened = true;
    position = startMs;
    return true;
  }
  void close() override {
    ++closes;
    opened = false;
  }
  void setPaused(bool p) override { isPaused = p; }
  bool paused() const override { return isPaused; }
  long positionMs() const override { return position; }
  long durationMs() const override { return duration; }
  void seek(long ms) override { seekTo = ms; position = ms; }
};

/** Everything one test needs, wired together. */
struct Fixture {
  FakeHub hub;
  Hub client{hub};
  FakeVideo video;
  InlineJobs jobs;
  App app{client, jobs, video};

  /**
   * Each test gets its own session file: a saved profile from one test would otherwise leak
   * into the next one and hide exactly the bug a test is looking for.
   */
  Fixture() {
    static int next = 0;
    sessionPath = ".hosttest/session-ui-" + std::to_string(++next) + ".txt";
    std::remove(sessionPath.c_str());
    app.setSessionPath(sessionPath);
    client.setBaseUrl("http://hub:8095");
  }

  ~Fixture() { std::remove(sessionPath.c_str()); }

  std::string sessionPath;

  /** Starts the app and lets the connect → profiles round trip settle. */
  void begin() {
    app.start();
    app.drain();
    app.drain();
  }

  /** Presses a key and lets the answer settle. */
  void press(Key key) {
    app.key(KeyPress(key));
    app.drain();
  }

  void pressDigit(int digit) {
    app.key(KeyPress(Key::Digit, digit));
    app.drain();
  }

  /** Picks a profile by moving right `times` then OK. */
  void pick(int times) {
    for (int i = 0; i < times; ++i) press(Key::Right);
    press(Key::Ok);
  }

  const utv::View& view() const { return app.view(); }

  /** The labels on the row the focus is on. */
  std::vector<std::string> focusedLabels() const {
    for (const auto& row : app.view().rows) {
      if (row.focus >= 0 && row.focus < static_cast<int>(row.labels.size())) {
        return row.labels;
      }
    }
    return {};
  }
};

}  // namespace

TEST(the_first_screen_that_asks_is_let_in_without_a_code) {
  Fixture f;
  f.begin();
  CHECK_EQ(f.view().screen, Screen::Profiles);
  CHECK_EQ(f.view().profiles.profiles.size(), static_cast<size_t>(3));
  CHECK(f.client.deviceToken() == "utv_device");
  // The very first thing it does is ask the Hub how it is, with no token at all.
  const HttpRequest* health = f.hub.last("/api/health");
  CHECK(health != nullptr);
  CHECK_EQ(f.hub.headerOn(*health, "X-Device-Token"), std::string(""));
}

TEST(choosing_an_open_profile_opens_home) {
  Fixture f;
  f.begin();
  f.press(Key::Ok);  // Family is first
  CHECK_EQ(f.view().screen, Screen::Home);
  CHECK_EQ(f.client.profileId(), std::string("family"));
  CHECK(f.view().home.hasHero);
  CHECK_EQ(f.view().heroTitle, std::string("Copper Sky"));
  CHECK_EQ(f.view().heroAction, std::string("Resume"));
  // A resume must not report the profile's PIN token, because it has none.
  const HttpRequest* home = f.hub.last("/api/home");
  CHECK(home != nullptr);
  CHECK_EQ(f.hub.headerOn(*home, "X-Profile"), std::string("family"));
  CHECK_EQ(f.hub.headerOn(*home, "X-Profile-Token"), std::string(""));
}

TEST(a_protected_profile_asks_for_the_pin_and_does_not_enter_without_it) {
  Fixture f;
  f.begin();
  f.pick(2);  // Grown-ups
  CHECK_EQ(f.view().screen, Screen::Pin);
  CHECK_EQ(f.view().pinName, std::string("Grown-ups"));
  CHECK_EQ(f.client.profileId(), std::string(""));
  // A wrong PIN leaves the grid up and says why.
  f.hub.unlockStatus = 403;
  f.pressDigit(1);
  f.pressDigit(2);
  f.pressDigit(3);
  f.pressDigit(4);
  // From digit 0 a single Left reaches OK, which is focus 11.
  f.press(Key::Left);
  f.press(Key::Ok);
  CHECK_EQ(f.view().screen, Screen::Pin);
  CHECK_EQ(f.view().detail, std::string("That PIN isn't right"));
  CHECK_EQ(f.client.profileId(), std::string(""));
}

TEST(a_right_pin_keeps_the_token_so_the_hub_believes_the_profile) {
  Fixture f;
  f.begin();
  f.pick(2);
  f.pressDigit(9);
  f.pressDigit(9);
  f.pressDigit(9);
  f.pressDigit(9);
  // From digit 0 a single Left reaches OK.
  f.press(Key::Left);
  f.press(Key::Ok);
  CHECK_EQ(f.view().screen, Screen::Home);
  CHECK_EQ(f.client.profileId(), std::string("protected"));
  CHECK_EQ(f.client.profileToken(), std::string("ptoken_1"));
  // Every later request has to carry it, or the Hub answers as the wrong profile.
  const HttpRequest* home = f.hub.last("/api/home");
  CHECK(home != nullptr);
  CHECK_EQ(f.hub.headerOn(*home, "X-Profile-Token"), std::string("ptoken_1"));
}

TEST(typing_digits_on_the_pin_grid_types_the_pin) {
  Fixture f;
  f.begin();
  f.pick(2);
  f.pressDigit(4);
  f.pressDigit(2);
  CHECK_EQ(f.view().pin, std::string("42"));
  // Backspace removes one, and a further Back leaves the screen.
  f.press(Key::Back);
  CHECK_EQ(f.view().pin, std::string("4"));
  f.press(Key::Back);
  CHECK_EQ(f.view().pin, std::string(""));
  f.press(Key::Back);
  CHECK_EQ(f.view().screen, Screen::Profiles);
}

TEST(home_moves_between_rails_and_plays_the_hero) {
  Fixture f;
  f.begin();
  f.press(Key::Ok);  // Family → Home
  CHECK_EQ(f.view().screen, Screen::Home);
  // Row 0 is the hero, so OK on it plays the film.
  f.press(Key::Ok);
  CHECK_EQ(f.view().screen, Screen::Player);
  CHECK_EQ(f.view().playing.title, std::string("Copper Sky"));
  CHECK_EQ(f.video.opens, 1);
  // The film starts where the progress left off: 48 minutes.
  CHECK_EQ(f.video.position, 2880000L);
  CHECK_EQ(f.view().positionMs, 2880000L);
}

TEST(a_second_rail_item_is_played_by_its_own_title) {
  Fixture f;
  f.begin();
  f.press(Key::Ok);
  f.press(Key::Down);  // the continue rail
  CHECK_EQ(f.view().railFocus, 1);
  f.press(Key::Ok);
  const HttpRequest* play = f.hub.last("/api/play");
  CHECK(play != nullptr);
  CHECK(play->body.find("demo:movie:paper-moons") != std::string::npos);
}

TEST(back_from_the_player_reports_where_it_stopped_and_returns_home) {
  Fixture f;
  f.begin();
  f.press(Key::Ok);
  f.press(Key::Ok);  // play
  f.video.position = 3000000;
  f.press(Key::Back);
  CHECK_EQ(f.view().screen, Screen::Home);
  CHECK_EQ(f.video.closes, 1);
  const HttpRequest* progress = f.hub.last("/api/progress");
  CHECK(progress != nullptr);
  CHECK(progress->body.find("\"positionMs\":3000000") != std::string::npos);
  CHECK(progress->body.find("\"event\":\"stop\"") != std::string::npos);
}

TEST(the_player_pauses_and_seeks_with_the_controller) {
  Fixture f;
  f.begin();
  f.press(Key::Ok);
  f.press(Key::Ok);
  f.video.position = 600000;
  f.video.duration = 7680000;
  f.press(Key::PlayPause);
  CHECK(f.video.isPaused);
  f.press(Key::Left);   // 10 s back
  CHECK_EQ(f.video.seekTo, 590000L);
  f.press(Key::Right);  // 30 s forward
  CHECK_EQ(f.video.seekTo, 620000L);
  // Never past the end.
  f.video.position = 7670000;
  f.press(Key::Right);
  CHECK_EQ(f.video.seekTo, 7680000L);
}

TEST(a_failed_play_keeps_the_household_in_the_app_with_a_reason) {
  Fixture f;
  f.video.failOpen = true;
  f.video.problem = "The film's file has gone.";
  f.begin();
  f.press(Key::Ok);
  f.press(Key::Ok);
  CHECK_EQ(f.view().screen, Screen::Message);
  CHECK_EQ(f.view().notice, std::string("That didn't play"));
  CHECK_EQ(f.view().detail, std::string("The film's file has gone."));
  // OK tries Home again rather than leaving a dead screen up.
  f.press(Key::Ok);
  CHECK_EQ(f.view().screen, Screen::Home);
}

TEST(the_guide_opens_on_the_channel_that_is_on_now) {
  Fixture f;
  f.begin();
  f.press(Key::Ok);
  f.press(Key::Guide);
  CHECK_EQ(f.view().screen, Screen::Guide);
  CHECK_EQ(f.view().guide.rows.size(), static_cast<size_t>(1));
  CHECK_EQ(f.view().guideChannel, std::string("BBC One"));
  // Back leaves the guide without playing anything.
  f.press(Key::Back);
  CHECK_EQ(f.view().screen, Screen::Home);
  CHECK_EQ(f.video.opens, 0);
}

TEST(a_programme_on_now_plays_its_channel_from_the_guide) {
  Fixture f;
  // Make the first programme cover "now" so the guide lands on it as on-now.
  f.hub.guide = R"({"from":0,"to":1,"channels":[{"id":"bbc1","number":101,"name":"BBC One"}],)"
               R"("programmes":{"bbc1":[{"id":"p1","channelId":"bbc1","start":0,)"
               R"("end":99999999999999,"title":"On Now","categories":[]}]}})";
  f.begin();
  f.press(Key::Ok);
  f.press(Key::Guide);
  CHECK(f.view().rows.size() >= 1);
  f.press(Key::Ok);
  CHECK_EQ(f.view().screen, Screen::Player);
  const HttpRequest* play = f.hub.last("/api/play");
  CHECK(play != nullptr);
  CHECK(play->body.find("\"kind\":\"channel\"") != std::string::npos);
  CHECK(play->body.find("\"id\":\"bbc1\"") != std::string::npos);
}

TEST(a_finished_programme_plays_from_catch_up) {
  Fixture f;
  f.hub.guide = R"({"from":0,"to":1,"channels":[{"id":"bbc1","number":101,"name":"BBC One"}],)"
               R"("programmes":{"bbc1":[{"id":"p1","channelId":"bbc1","start":1000,)"
               R"("end":2000,"title":"Long Over","categories":[]}]}})";
  f.begin();
  f.press(Key::Ok);
  f.press(Key::Guide);
  f.press(Key::Ok);
  const HttpRequest* play = f.hub.last("/api/play");
  CHECK(play != nullptr);
  CHECK(play->body.find("\"kind\":\"catchup\"") != std::string::npos);
}

TEST(a_hub_that_cannot_be_reached_says_so_plainly) {
  struct BrokenHub : HttpTransport {
    HttpResponse send(const HttpRequest&) override {
      HttpResponse response;
      response.status = 0;
      response.error = "timed out";
      return response;
    }
  } broken;
  Hub client(broken);
  client.setBaseUrl("http://192.168.0.19:8095");
  FakeVideo video;
  InlineJobs jobs;
  App app(client, jobs, video);
  app.setSessionPath(".hosttest/session-ui-broken.txt");
  app.start();
  app.drain();
  app.drain();
  CHECK_EQ(app.view().screen, Screen::Connect);
  CHECK_EQ(app.view().notice, std::string("Can't reach the Hub"));
  CHECK(app.view().detail.find("didn't answer") != std::string::npos);
}

TEST(a_saved_session_goes_straight_to_the_profiles) {
  const std::string path = ".hosttest/session-ui-saved.txt";
  utv::SavedSession saved;
  saved.baseUrl = "http://hub:8095";
  saved.deviceToken = "utv_saved";
  saved.profileId = "family";
  saved.profileToken = "ptoken_saved";
  CHECK(utv::saveSession(path, saved));

  FakeHub transport;
  Hub client(transport);
  FakeVideo video;
  InlineJobs jobs;
  App app(client, jobs, video);
  app.setSessionPath(path);
  client.setBaseUrl(saved.baseUrl);
  app.start();
  CHECK_EQ(client.baseUrl(), std::string("http://hub:8095"));
  CHECK_EQ(client.deviceToken(), std::string("utv_saved"));
  CHECK_EQ(client.profileId(), std::string("family"));
  CHECK_EQ(client.profileToken(), std::string("ptoken_saved"));
  app.drain();
  app.drain();
  // A saved device token means it does not pair again, it just loads the profiles.
  CHECK_EQ(app.view().screen, Screen::Profiles);
  CHECK(transport.last("/api/pair/screen") == nullptr);
  std::remove(path.c_str());
}

TEST(the_screens_compile_one_set_of_rows_for_the_drawing_code) {
  Fixture f;
  f.begin();
  CHECK_EQ(f.view().rows.size(), static_cast<size_t>(1));
  CHECK_EQ(f.view().rows[0].title, std::string("Who's watching?"));
  CHECK_EQ(f.view().rows[0].labels.size(), static_cast<size_t>(3));
  CHECK_EQ(f.view().rows[0].focus, 0);
  f.press(Key::Ok);
  // Home: the hero row, then one row per rail.
  CHECK_EQ(f.view().rows.size(), static_cast<size_t>(2));
  CHECK_EQ(f.view().rows[0].title, std::string("Copper Sky"));
  CHECK_EQ(f.view().rows[1].title, std::string("Continue watching"));
  // The hero's label is the action the button offers.
  CHECK_EQ(f.view().rows[0].labels[0], std::string("Resume"));
}

int main() { return utvtest::run(); }

TEST(the_address_is_changed_with_the_controller) {
  Fixture fixture;
  fixture.client.setBaseUrl("http://192.168.0.19:8095");
  // No Hub answering, so the app stays on the screen that asks where the Hub is.
  fixture.hub.health = "<html>no hub here</html>";
  fixture.begin();
  CHECK_EQ(fixture.app.view().screen, Screen::Connect);
  CHECK_EQ(fixture.app.view().address, "http://192.168.0.19:8095");
  fixture.press(Key::Right);
  fixture.press(Key::Right);
  fixture.press(Key::Right);
  CHECK_EQ(fixture.app.view().addressField, 3);
  fixture.press(Key::Up);
  fixture.press(Key::Up);
  CHECK_EQ(fixture.app.view().address, "http://192.168.0.21:8095");
  // Left and right move between the five fields, and past the port it wraps back to the first.
  fixture.press(Key::Right);
  CHECK_EQ(fixture.app.view().addressField, 4);
  // The port moves in tens, because a wrong port is usually a long way off.
  fixture.press(Key::Up);
  CHECK_EQ(fixture.app.view().address, "http://192.168.0.21:8105");
  fixture.press(Key::Right);
  CHECK_EQ(fixture.app.view().addressField, 0);
}

TEST(trying_a_new_address_asks_the_hub_at_the_new_one) {
  Fixture fixture;
  fixture.client.setBaseUrl("http://192.168.0.19:8095");
  fixture.hub.health = "<html>no hub here</html>";
  fixture.begin();
  fixture.press(Key::Right);
  fixture.press(Key::Right);
  fixture.press(Key::Right);
  fixture.press(Key::Up);
  fixture.hub.seen.clear();
  // Okay means "try this": it goes to the Hub rather than just redrawing the screen.
  fixture.press(Key::Ok);
  const HttpRequest* asked = fixture.hub.last("/api/health");
  // The address the user set, not the one the fixture started with.
  CHECK(asked != nullptr);
  CHECK(asked != nullptr && asked->url.find("192.168.0.20") != std::string::npos);
}

// What the console shows and what a key press does — with no drawing in it.
//
// The screens, the focus, the key handling and the calls to the Hub all live here so they
// can be tested on the build machine (`make -C ps5 test`). The platform layer only draws
// this state and feeds it key presses, and supplies the video player.
#ifndef UTV_UI_HPP
#define UTV_UI_HPP

#include <functional>
#include <memory>
#include <ostream>
#include <mutex>
#include <string>
#include <vector>

#include "address.hpp"
#include "hub.hpp"
#include "model.hpp"

namespace utv {

/** A button on the controller or a key on the remote, in the app's own words. */
enum class Key {
  Up,
  Down,
  Left,
  Right,
  Ok,
  Back,
  PlayPause,
  Stop,
  Rewind,
  Forward,
  Guide,
  Info,
  Digit,
};

struct KeyPress {
  Key key = Key::Ok;
  /** Only meaningful for Key::Digit. */
  int digit = -1;
  KeyPress() = default;
  explicit KeyPress(Key k) : key(k) {}
  KeyPress(Key k, int d) : key(k), digit(d) {}
};

enum class Screen {
  /** Finding the Hub, then pairing this screen with it. */
  Connect,
  /** "Who's watching?" */
  Profiles,
  /** The PIN grid for a protected profile. */
  Pin,
  Home,
  Guide,
  Player,
  /** Something went wrong, with one sentence a person can act on. */
  Message,
};

/** The screen's name, so a test failure or a log line says "Guide", not "4". */
inline std::ostream& operator<<(std::ostream& out, Screen screen) {
  switch (screen) {
    case Screen::Connect:
      return out << "Connect";
    case Screen::Profiles:
      return out << "Profiles";
    case Screen::Pin:
      return out << "Pin";
    case Screen::Home:
      return out << "Home";
    case Screen::Guide:
      return out << "Guide";
    case Screen::Player:
      return out << "Player";
    case Screen::Message:
      return out << "Message";
  }
  return out << "Screen(" << static_cast<int>(screen) << ")";
}

/** Runs Hub calls off the drawing thread so a slow answer doesn't freeze the picture. */
class Jobs {
 public:
  virtual ~Jobs() = default;
  virtual void post(std::function<void()> job) = 0;
};

/** Runs every job at once, on the caller's thread. The tests use this. */
class InlineJobs : public Jobs {
 public:
  void post(std::function<void()> job) override { job(); }
};

/** One background thread, one queue: the console uses this. */
class ThreadJobs : public Jobs {
 public:
  ThreadJobs();
  ~ThreadJobs() override;
  void post(std::function<void()> job) override;

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

/** The film or channel being watched. The platform implements it; tests fake it. */
class Video {
 public:
  virtual ~Video() = default;
  /**
   * Tells the player how big the picture on screen is, so it asks the decoder for that size
   * instead of for 1080p. Called once the window exists; a player that can't do anything with
   * it is free to ignore it.
   */
  virtual void setDisplaySize(int width, int height) {
    (void)width;
    (void)height;
  }
  /** Opens `info`, starting at `startMs`. Answers false with a reason when it can't play. */
  virtual bool open(const PlaybackInfo& info, long startMs, std::string& problem) = 0;
  virtual void close() = 0;
  virtual void setPaused(bool paused) = 0;
  virtual bool paused() const = 0;
  /** Where the picture is, in milliseconds. */
  virtual long positionMs() const = 0;
  /** How long it is; 0 when unknown (live television). */
  virtual long durationMs() const = 0;
  virtual void seek(long ms) = 0;
};

/** Everything a screen needs, in one place. Read by the drawing code; never written by it. */
struct View {
  Screen screen = Screen::Connect;
  /** The line under the spinner while connecting, or the reason on the Message screen. */
  std::string notice;
  std::string detail;
  /** True while the app is waiting for the Hub. */
  bool busy = false;

  // Connect. The address is held as four numbers and a port so the controller can change it:
  // the console has no keyboard to type one with.
  AddressFields addressFields;
  int addressField = 0;   // 0..3 = a number, 4 = the port
  std::string address;
  /** Pairing: the code the TV shows, when this screen isn't the first. */
  std::string pairingCode;
  bool pairingWaiting = false;

  // Profiles
  ProfilesView profiles;
  int profileFocus = 0;

  // PIN
  std::string pin;
  int pinFocus = 0;  // 0..9 = digit, 10 = delete, 11 = ok
  std::string pinName;

  // Home
  HomeScreen home;
  std::string heroTitle;
  std::string heroLine;
  std::string heroAction;
  int railFocus = 0;
  int itemFocus = 0;

  // Guide
  GuideWindow guide;
  long guideAt = 0;
  int guideRow = 0;
  int guideProgramme = 0;
  std::string guideTitle;
  std::string guideTimes;
  std::string guideChannel;

  // Player
  PlaybackInfo playing;
  long positionMs = 0;
  long durationMs = 0;
  bool paused = false;

  // Compiled by app(): the visible rows, so the drawing code has no logic in it.
  struct Row {
    std::string title;
    std::vector<std::string> labels;
    std::vector<std::string> sublabels;
    std::vector<std::string> badges;
    std::vector<double> progress;
    int focus = -1;
  };
  std::vector<Row> rows;
};

/** The whole app: state, keys, and the Hub calls the state needs. */
class App {
 public:
  App(Hub& hub, Jobs& jobs, Video& video);
  ~App();

  /** Reads the saved session and starts connecting. */
  void start();

  /** Feeds one key press in. Answers false when the screen didn't want it. */
  bool key(const KeyPress& press);

  /** Runs the Hub answers that arrived since the last call. Call this every frame. */
  void drain();

  /** Called every frame by the platform, so the player's position is current. */
  void tick();

  /** The state to draw. */
  const View& view() const { return view_; }

  /** Where the saved session lives (`/data/ultimatetv/session.txt` on the console). */
  void setSessionPath(const std::string& path) { sessionPath_ = path; }

  /** Forgets the device token and pairs again — Settings › Pair. */
  void forgetPairing();

  /** Reports the picture's position to the Hub, which is how Continue watching works. */
  void reportProgress(const std::string& event);

 private:
  void rebuild();
  void setMessage(const std::string& notice, const std::string& detail);
  void connect();
  void loadProfiles();
  void pickProfile(size_t index);
  void enterProfile(const Profile& profile, const std::string& token);
  void loadHome();
  void openGuide();
  void play(const PlaybackRequest& request);
  void startPlayback(const PlaybackInfo& info);
  void stopPlayback(const std::string& event);
  void leavePlayer();
  void saveSessionNow();
  /** Runs `work` off the drawing thread and hands its result to `then` on the main one. */
  void background(std::function<void()> work);
  void later(std::function<void()> work);

  Hub& hub_;
  Jobs& jobs_;
  Video& video_;
  View view_;
  std::string sessionPath_;
  Screen backTo_ = Screen::Home;
  PlaybackRequest lastRequest_;
  long lastReportAt_ = 0;
  bool started_ = false;

  std::mutex queueMutex_;
  std::vector<std::function<void()>> queue_;
};

}  // namespace utv

#endif  // UTV_UI_HPP

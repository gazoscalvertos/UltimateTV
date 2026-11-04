#include "ui.hpp"

#include <algorithm>
#include <chrono>
#include <condition_variable>
#include <deque>
#include <thread>

#include "text.hpp"

namespace utv {

namespace {

long nowMs() {
  return static_cast<long>(
      std::chrono::duration_cast<std::chrono::milliseconds>(
          std::chrono::system_clock::now().time_since_epoch())
          .count());
}

/** The guide shows this much either side of now. */
const long GUIDE_BACK_MS = 30 * 60000;
const long GUIDE_FORWARD_MS = 3 * 3600000;
/** How often a film's position goes to the Hub. */
const long REPORT_EVERY_MS = 10000;

}  // namespace

struct ThreadJobs::Impl {
  std::mutex mutex;
  std::condition_variable wake;
  std::deque<std::function<void()>> queue;
  bool stopping = false;
  std::thread worker;

  Impl() {
    worker = std::thread([this] {
      while (true) {
        std::function<void()> job;
        {
          std::unique_lock<std::mutex> lock(mutex);
          wake.wait(lock, [this] { return stopping || !queue.empty(); });
          if (stopping && queue.empty()) return;
          job = std::move(queue.front());
          queue.pop_front();
        }
        job();
      }
    });
  }

  ~Impl() {
    {
      std::lock_guard<std::mutex> lock(mutex);
      stopping = true;
    }
    wake.notify_all();
    if (worker.joinable()) worker.join();
  }
};

ThreadJobs::ThreadJobs() : impl_(new Impl()) {}
ThreadJobs::~ThreadJobs() = default;

void ThreadJobs::post(std::function<void()> job) {
  {
    std::lock_guard<std::mutex> lock(impl_->mutex);
    if (impl_->stopping) return;
    impl_->queue.push_back(std::move(job));
  }
  impl_->wake.notify_one();
}

App::App(Hub& hub, Jobs& jobs, Video& video) : hub_(hub), jobs_(jobs), video_(video) {
  view_.address = hub_.baseUrl();
  parseAddress(view_.address, view_.addressFields);
}

App::~App() = default;

void App::background(std::function<void()> work) {
  // The work runs off the drawing thread; `later` queues its UI side for the next frame.
  // No lock is held while it runs: a Hub call can take seconds, and `later` (on another
  // job) must be able to queue during it.
  jobs_.post([work = std::move(work)]() mutable { work(); });
}

void App::later(std::function<void()> work) {
  std::lock_guard<std::mutex> lock(queueMutex_);
  queue_.push_back(std::move(work));
}

void App::drain() {
  std::vector<std::function<void()>> ready;
  {
    std::lock_guard<std::mutex> lock(queueMutex_);
    ready.swap(queue_);
  }
  for (auto& work : ready) work();
  if (!ready.empty()) rebuild();
}

void App::setMessage(const std::string& notice, const std::string& detail) {
  view_.screen = Screen::Message;
  view_.notice = notice;
  view_.detail = detail;
  view_.busy = false;
  rebuild();
}

void App::start() {
  if (started_) return;
  started_ = true;
  const SavedSession saved = loadSession(sessionPath_);
  if (!saved.baseUrl.empty()) hub_.setBaseUrl(saved.baseUrl);
  if (!saved.deviceToken.empty()) hub_.setDeviceToken(saved.deviceToken);
  if (!saved.profileId.empty()) hub_.setProfileId(saved.profileId);
  if (!saved.profileToken.empty()) hub_.setProfileToken(saved.profileToken);
  view_.address = hub_.baseUrl();
  parseAddress(view_.address, view_.addressFields);
  connect();
}

void App::saveSessionNow() {
  if (sessionPath_.empty()) return;
  SavedSession saved;
  saved.baseUrl = hub_.baseUrl();
  saved.deviceToken = hub_.deviceToken();
  saved.profileId = hub_.profileId();
  saved.profileToken = hub_.profileToken();
  saveSession(sessionPath_, saved);
}

void App::connect() {
  view_.screen = Screen::Connect;
  view_.busy = true;
  view_.notice = "Looking for the Hub at " + hub_.baseUrl();
  view_.detail.clear();
  view_.pairingWaiting = false;
  view_.pairingCode.clear();
  rebuild();
  const std::string wantAddress = hub_.baseUrl();
  background([this, wantAddress] {
    const HubResult health = hub_.health();
    if (!health.ok) {
      later([this, health] {
        view_.busy = false;
        view_.notice = "Can't reach the Hub";
        view_.detail = health.problem + " Check the address, and that the Hub is running.";
        rebuild();
      });
      return;
    }
    // Already paired (a saved token): go straight to the profiles.
    if (!hub_.deviceToken().empty()) {
      const HubResult check = hub_.profiles();
      if (check.ok) {
        later([this] { loadProfiles(); });
        return;
      }
      if (!Hub::unreachable(check)) {
        // The token is no longer good: pair again.
        hub_.setDeviceToken("");
      }
    }
    const HubResult paired = hub_.pairScreen("PlayStation 5");
    if (!paired.ok) {
      later([this, paired] {
        view_.busy = false;
        view_.notice = "The Hub didn't let this screen in";
        view_.detail = paired.problem;
        rebuild();
      });
      return;
    }
    const Json& body = paired.body;
    if (body.find("pending") && !body.str("token").size()) {
      const std::string code = body.find("pending") ? body.find("pending")->str("code") : "";
      const std::string id = body.find("pending") ? body.find("pending")->str("id") : "";
      const std::string secret = body.str("secret");
      later([this, code, id, secret] {
        view_.busy = false;
        view_.notice = "Waiting to be let in";
        view_.detail = "On the TV or the Hub's settings page, let in this screen. Its code is below.";
        view_.pairingCode = code;
        view_.pairingWaiting = true;
        rebuild();
        if (id.empty()) return;
        // Ask again every couple of seconds until someone lets it in.
        background([this, id, secret] {
          for (int attempt = 0; attempt < 300; ++attempt) {
            std::this_thread::sleep_for(std::chrono::milliseconds(2000));
            const HubResult r = hub_.collectScreen(id, secret);
            if (r.ok && !hub_.deviceToken().empty()) {
              later([this] { loadProfiles(); });
              return;
            }
            if (!r.ok && !r.problem.empty() && r.problem.find("waiting") == std::string::npos &&
                r.problem.find("didn't answer") == std::string::npos) {
              return;
            }
          }
        });
      });
      return;
    }
    later([this] {
      saveSessionNow();
      loadProfiles();
    });
  });
}

void App::loadProfiles() {
  view_.screen = Screen::Profiles;
  view_.busy = true;
  view_.notice = "Who's watching?";
  view_.detail.clear();
  view_.pairingWaiting = false;
  rebuild();
  background([this] {
    const HubResult r = hub_.profiles();
    later([this, r] {
      view_.busy = false;
      if (!r.ok) {
        view_.notice = "Can't load the profiles";
        view_.detail = r.problem;
        view_.screen = Screen::Message;
        rebuild();
        return;
      }
      view_.profiles = profilesFromJson(r.body);
      view_.profileFocus = 0;
      view_.screen = Screen::Profiles;
      rebuild();
    });
  });
}

void App::pickProfile(size_t index) {
  if (index >= view_.profiles.profiles.size()) return;
  const Profile profile = view_.profiles.profiles[index];
  if (profile.hasPin) {
    view_.screen = Screen::Pin;
    view_.pin.clear();
    view_.pinFocus = 0;
    view_.pinName = profile.name;
    rebuild();
    return;
  }
  enterProfile(profile, "");
}

void App::enterProfile(const Profile& profile, const std::string& token) {
  hub_.setProfileId(profile.id);
  // A protected profile is only believed by the Hub when this token rides on every request.
  // Without it the Hub quietly answers as the safest profile instead (see `Profiles.resolve`).
  hub_.setProfileToken(token);
  saveSessionNow();
  loadHome();
}

void App::loadHome() {
  view_.screen = Screen::Home;
  view_.busy = true;
  view_.notice = "Loading";
  rebuild();
  background([this] {
    const HubResult r = hub_.home();
    later([this, r] {
      view_.busy = false;
      if (!r.ok) {
        view_.notice = "Can't load Home";
        view_.detail = r.problem;
        view_.screen = Screen::Message;
        rebuild();
        return;
      }
      view_.home = homeFromJson(r.body);
      view_.heroTitle = view_.home.hasHero ? view_.home.hero.name : "";
      view_.heroAction = view_.home.heroAction == "resume" ? "Resume" : "Watch";
      view_.heroLine = view_.home.hasHero ? shorten(view_.home.heroOverview, 220) : "";
      view_.railFocus = 0;
      view_.itemFocus = 0;
      view_.screen = Screen::Home;
      rebuild();
    });
  });
}

void App::openGuide() {
  view_.screen = Screen::Guide;
  view_.busy = true;
  view_.notice = "Loading the guide";
  rebuild();
  const long at = nowMs();
  background([this, at] {
    const HubResult r = hub_.guide(at - GUIDE_BACK_MS, at + GUIDE_FORWARD_MS);
    later([this, r, at] {
      view_.busy = false;
      if (!r.ok) {
        view_.notice = "Can't load the guide";
        view_.detail = r.problem;
        view_.screen = Screen::Message;
        rebuild();
        return;
      }
      view_.guide = guideFromJson(r.body);
      view_.guideAt = at;
      view_.guideRow = view_.guide.rows.empty() ? 0 : static_cast<int>(view_.guide.pickNow(at));
      view_.guideProgramme = 0;
      view_.screen = Screen::Guide;
      rebuild();
    });
  });
}

void App::play(const PlaybackRequest& request) {
  lastRequest_ = request;
  view_.busy = true;
  view_.notice = "Starting";
  rebuild();
  background([this, request] {
    const HubResult r = hub_.play(request);
    later([this, r] {
      view_.busy = false;
      if (!r.ok) {
        view_.notice = "That didn't play";
        view_.detail = r.problem;
        view_.screen = Screen::Message;
        backTo_ = Screen::Home;
        rebuild();
        return;
      }
      startPlayback(playbackFromJson(r.body));
    });
  });
}

void App::startPlayback(const PlaybackInfo& info) {
  std::string problem;
  if (!video_.open(info, info.live ? 0 : info.startMs, problem)) {
    view_.notice = "That didn't play";
    view_.detail = problem.empty() ? "The console couldn't open the video." : problem;
    view_.screen = Screen::Message;
    backTo_ = Screen::Home;
    rebuild();
    return;
  }
  view_.playing = info;
  view_.positionMs = info.startMs;
  view_.durationMs = info.durationMs;
  view_.paused = false;
  view_.screen = Screen::Player;
  view_.notice.clear();
  view_.detail.clear();
  if (!info.progressKey.empty()) {
    background([this, info] {
      hub_.progress(info.progressKey, info.startMs, info.durationMs, info.title, "start", nowMs());
    });
  }
  rebuild();
}

void App::stopPlayback(const std::string& event) {
  const PlaybackInfo info = view_.playing;
  const long at = video_.positionMs();
  video_.close();
  view_.playing = PlaybackInfo();
  if (!info.progressKey.empty()) {
    background([this, info, at, event] {
      hub_.progress(info.progressKey, at, info.durationMs, info.title, event, nowMs());
    });
  }
}

void App::leavePlayer() {
  stopPlayback("stop");
  if (backTo_ == Screen::Guide) {
    view_.screen = Screen::Guide;
    rebuild();
    return;
  }
  view_.screen = Screen::Home;
  rebuild();
}

void App::reportProgress(const std::string& event) {
  if (view_.playing.progressKey.empty()) return;
  const PlaybackInfo info = view_.playing;
  const long at = video_.positionMs();
  background([this, info, at, event] {
    hub_.progress(info.progressKey, at, info.durationMs, info.title, event, nowMs());
  });
}

void App::tick() {
  if (view_.screen == Screen::Player) {
    view_.positionMs = video_.positionMs();
    view_.durationMs = video_.durationMs();
    view_.paused = video_.paused();
    const long now = nowMs();
    if (now - lastReportAt_ > REPORT_EVERY_MS && !view_.playing.live) {
      lastReportAt_ = now;
      reportProgress("progress");
    }
  }
}

void App::forgetPairing() {
  hub_.setDeviceToken("");
  hub_.setProfileId("");
  hub_.setProfileToken("");
  saveSessionNow();
  connect();
}

void App::rebuild() {
  view_.rows.clear();
  switch (view_.screen) {
    case Screen::Profiles: {
      View::Row row;
      row.title = "Who's watching?";
      for (const auto& p : view_.profiles.profiles) {
        row.labels.push_back(p.name);
        row.sublabels.push_back(p.isKids() ? "Kids" : p.kind == "guest" ? "Guest" : "");
        row.badges.push_back(p.hasPin ? "PIN" : "");
        row.progress.push_back(-1);
      }
      row.focus = view_.profileFocus;
      view_.rows.push_back(std::move(row));
      break;
    }
    case Screen::Home: {
      if (view_.home.hasHero) {
        View::Row hero;
        hero.title = view_.heroTitle;
        hero.labels.push_back(view_.heroAction);
        hero.sublabels.push_back(shorten(view_.heroLine, 160));
        hero.badges.push_back("");
        hero.progress.push_back(view_.home.hero.progress);
        hero.focus = 0;
        view_.rows.push_back(std::move(hero));
      }
      for (const auto& rail : view_.home.rails) {
        View::Row row;
        row.title = rail.title;
        if (rail.kind == "channels") {
          for (const auto& c : rail.channels) {
            row.labels.push_back(c.name.empty() ? std::to_string(c.number) : c.name);
            row.sublabels.push_back(c.number > 0 ? std::to_string(c.number) : "");
            row.badges.push_back("");
            row.progress.push_back(-1);
          }
        } else {
          for (const auto& t : rail.titles) {
            row.labels.push_back(t.name);
            row.sublabels.push_back(t.subtitle.empty() ? std::to_string(t.year) : t.subtitle);
            row.badges.push_back("");
            row.progress.push_back(t.progress);
          }
        }
        row.focus = row.labels.empty() ? -1 : 0;
        view_.rows.push_back(std::move(row));
      }
      if (!view_.rows.empty()) {
        const int railRow = std::min<int>(view_.railFocus, static_cast<int>(view_.rows.size()) - 1);
        view_.rows[railRow].focus = std::min<int>(
            view_.itemFocus, static_cast<int>(view_.rows[railRow].labels.size()) - 1);
      }
      break;
    }
    case Screen::Guide: {
      if (view_.guide.rows.empty()) break;
      const int rowIndex =
          std::min<int>(view_.guideRow, static_cast<int>(view_.guide.rows.size()) - 1);
      const auto& row = view_.guide.rows[rowIndex];
      view_.guideChannel =
          row.channel.name.empty() ? std::to_string(row.channel.number) : row.channel.name;
      View::Row shown;
      shown.title = view_.guideChannel;
      for (size_t i = 0; i < row.programmes.size(); ++i) {
        const Programme& p = row.programmes[i];
        shown.labels.push_back(p.title);
        shown.sublabels.push_back(clockTime(p.start));
        shown.badges.push_back(p.start <= view_.guideAt && view_.guideAt < p.end ? "Now" : "");
        shown.progress.push_back(-1);
      }
      const int pick = std::min<int>(view_.guideProgramme, static_cast<int>(shown.labels.size()) - 1);
      shown.focus = shown.labels.empty() ? -1 : pick;
      if (shown.focus >= 0) {
        const Programme& p = row.programmes[static_cast<size_t>(shown.focus)];
        view_.guideTitle = p.title;
        view_.guideTimes =
            clockTime(p.start) + " – " + clockTime(p.end) + " · " + dayLabel(p.start, view_.guideAt);
        view_.detail = p.description;
      }
      view_.rows.push_back(std::move(shown));
      break;
    }
    case Screen::Pin: {
      View::Row row;
      row.title = "PIN for " + view_.pinName;
      for (int i = 0; i <= 9; ++i) {
        row.labels.push_back(std::to_string(i));
        row.sublabels.push_back("");
        row.badges.push_back("");
        row.progress.push_back(-1);
      }
      row.labels.push_back("Delete");
      row.sublabels.push_back("");
      row.badges.push_back("");
      row.progress.push_back(-1);
      row.labels.push_back("OK");
      row.sublabels.push_back("");
      row.badges.push_back("");
      row.progress.push_back(-1);
      row.focus = view_.pinFocus;
      view_.rows.push_back(std::move(row));
      break;
    }
    default:
      break;
  }
}

bool App::key(const KeyPress& press) {
  switch (view_.screen) {
    case Screen::Connect: {
      // The console has no keyboard, so the address is edited a number at a time: up and down
      // change the number under the cursor, left and right move between the five fields, and
      // okay tries it. The port moves in tens because a wrong port is usually a long way off.
      const int step = view_.addressField >= 4 ? 10 : 1;
      switch (press.key) {
        case Key::Left:
          view_.addressField = (view_.addressField + ADDRESS_FIELDS - 1) % ADDRESS_FIELDS;
          rebuild();
          return true;
        case Key::Right:
          view_.addressField = (view_.addressField + 1) % ADDRESS_FIELDS;
          rebuild();
          return true;
        case Key::Up:
          stepAddressField(view_.addressFields, view_.addressField, step);
          view_.address = formatAddress(view_.addressFields);
          rebuild();
          return true;
        case Key::Down:
          stepAddressField(view_.addressFields, view_.addressField, -step);
          view_.address = formatAddress(view_.addressFields);
          rebuild();
          return true;
        case Key::Ok:
          // Whatever is on screen is what it tries, with the last edited numbers and all.
          view_.address = formatAddress(view_.addressFields);
          hub_.setBaseUrl(view_.address);
          saveSessionNow();
          connect();
          return true;
        default:
          return false;
      }
    }
    case Screen::Profiles: {
      const int count = static_cast<int>(view_.profiles.profiles.size());
      if (count == 0) return false;
      if (press.key == Key::Left) {
        view_.profileFocus = (view_.profileFocus + count - 1) % count;
        rebuild();
        return true;
      }
      if (press.key == Key::Right) {
        view_.profileFocus = (view_.profileFocus + 1) % count;
        rebuild();
        return true;
      }
      if (press.key == Key::Ok) {
        pickProfile(static_cast<size_t>(view_.profileFocus));
        return true;
      }
      return false;
    }
    case Screen::Pin: {
      // A remote's number keys type the PIN directly.
      if (press.key == Key::Digit && press.digit >= 0 && press.digit <= 9) {
        if (view_.pin.size() < 8) view_.pin += std::to_string(press.digit);
        rebuild();
        return true;
      }
      if (press.key == Key::Left) {
        view_.pinFocus = (view_.pinFocus + 11) % 12;
        rebuild();
        return true;
      }
      if (press.key == Key::Right) {
        view_.pinFocus = (view_.pinFocus + 1) % 12;
        rebuild();
        return true;
      }
      if (press.key == Key::Back) {
        if (!view_.pin.empty()) {
          view_.pin.pop_back();
          rebuild();
          return true;
        }
        view_.screen = Screen::Profiles;
        rebuild();
        return true;
      }
      if (press.key == Key::Ok) {
        if (view_.pinFocus == 10) {
          if (!view_.pin.empty()) view_.pin.pop_back();
          rebuild();
          return true;
        }
        if (view_.pinFocus == 11) {
          if (view_.pin.empty()) return true;
          // The Hub is the only thing that knows the PIN. A wrong one must leave the grid
          // up, and a right one must hand back the profile token: the Hub quietly answers as
          // the safest profile for a protected profile without that token.
          const std::string pin = view_.pin;
          const size_t index = view_.profileFocus;
          const Profile profile =
              index < view_.profiles.profiles.size() ? view_.profiles.profiles[index] : Profile();
          view_.pin.clear();
          view_.busy = true;
          rebuild();
          background([this, pin, profile] {
            const HubResult r = hub_.unlock(profile.id, pin);
            later([this, r, profile] {
              view_.busy = false;
              if (!r.ok) {
                view_.detail = r.problem;
                view_.pin.clear();
                rebuild();
                return;
              }
              enterProfile(profile, r.body.str("token"));
            });
          });
          return true;
        }
        if (view_.pin.size() < 8) view_.pin += std::to_string(view_.pinFocus);
        rebuild();
        return true;
      }
      return false;
    }
    case Screen::Home: {
      if (press.key == Key::Guide) {
        backTo_ = Screen::Home;
        openGuide();
        return true;
      }
      if (press.key == Key::Back) return false;  // the platform closes the app on Back from Home
      if (view_.rows.empty()) return false;
      const int rail = std::min<int>(view_.railFocus, static_cast<int>(view_.rows.size()) - 1);
      if (press.key == Key::Up) {
        view_.railFocus = std::max(0, rail - 1);
        view_.itemFocus = 0;
        rebuild();
        return true;
      }
      if (press.key == Key::Down) {
        view_.railFocus = std::min<int>(rail + 1, static_cast<int>(view_.rows.size()) - 1);
        view_.itemFocus = 0;
        rebuild();
        return true;
      }
      const int count = static_cast<int>(view_.rows[static_cast<size_t>(rail)].labels.size());
      if (press.key == Key::Left && count > 0) {
        view_.itemFocus = (view_.itemFocus + count - 1) % count;
        rebuild();
        return true;
      }
      if (press.key == Key::Right && count > 0) {
        view_.itemFocus = (view_.itemFocus + 1) % count;
        rebuild();
        return true;
      }
      if (press.key == Key::Ok) {
        // Row 0 is the hero and the rest are rails, in the same order `home.rails` is in.
        if (view_.home.hasHero && rail == 0) {
          PlaybackRequest request;
          request.kind = "title";
          request.id = view_.home.hero.id;
          play(request);
          return true;
        }
        const size_t railIndex = static_cast<size_t>(rail) - (view_.home.hasHero ? 1 : 0);
        if (railIndex >= view_.home.rails.size()) return true;
        const Rail& chosen = view_.home.rails[railIndex];
        if (view_.itemFocus < 0) return true;
        PlaybackRequest request;
        if (chosen.kind == "channels") {
          if (static_cast<size_t>(view_.itemFocus) >= chosen.channels.size()) return true;
          request.kind = "channel";
          request.id = chosen.channels[static_cast<size_t>(view_.itemFocus)].id;
        } else if (chosen.kind == "recordings") {
          request.kind = "recording";
          request.id = chosen.id;
        } else {
          if (static_cast<size_t>(view_.itemFocus) >= chosen.titles.size()) return true;
          request.kind = "title";
          request.id = chosen.titles[static_cast<size_t>(view_.itemFocus)].id;
        }
        backTo_ = Screen::Home;
        play(request);
        return true;
      }
      return false;
    }
    case Screen::Guide: {
      if (press.key == Key::Back) {
        view_.screen = Screen::Home;
        rebuild();
        return true;
      }
      if (view_.guide.rows.empty()) return false;
      if (press.key == Key::Up) {
        view_.guideRow = std::max(0, view_.guideRow - 1);
        view_.guideProgramme = 0;
        rebuild();
        return true;
      }
      if (press.key == Key::Down) {
        view_.guideRow = std::min<int>(view_.guideRow + 1, static_cast<int>(view_.guide.rows.size()) - 1);
        view_.guideProgramme = 0;
        rebuild();
        return true;
      }
      const auto& programmes = view_.guide.rows[static_cast<size_t>(view_.guideRow)].programmes;
      const int count = static_cast<int>(programmes.size());
      if (press.key == Key::Left && count > 0) {
        view_.guideProgramme = (view_.guideProgramme + count - 1) % count;
        rebuild();
        return true;
      }
      if (press.key == Key::Right && count > 0) {
        view_.guideProgramme = (view_.guideProgramme + 1) % count;
        rebuild();
        return true;
      }
      if (press.key == Key::Ok && count > 0) {
        const Programme& p = programmes[static_cast<size_t>(view_.guideProgramme)];
        PlaybackRequest request;
        if (p.start <= view_.guideAt && view_.guideAt < p.end) {
          request.kind = "channel";
          request.id = p.channelId;
        } else if (p.end <= view_.guideAt) {
          // Finished: the Hub can play it back for the channels that keep catch-up.
          request.kind = "catchup";
          request.id = p.channelId;
          request.start = p.start;
        } else {
          return true;  // not on yet: nothing to play
        }
        backTo_ = Screen::Guide;
        play(request);
        return true;
      }
      return false;
    }
    case Screen::Player: {
      if (press.key == Key::Back) {
        leavePlayer();
        return true;
      }
      if (press.key == Key::Ok || press.key == Key::PlayPause) {
        video_.setPaused(!video_.paused());
        view_.paused = video_.paused();
        return true;
      }
      if (press.key == Key::Left || press.key == Key::Rewind) {
        video_.seek(std::max(0L, video_.positionMs() - (press.key == Key::Left ? 10000L : 30000L)));
        return true;
      }
      if (press.key == Key::Right || press.key == Key::Forward) {
        const long by = press.key == Key::Right ? 30000L : 60000L;
        const long length = video_.durationMs();
        long target = video_.positionMs() + by;
        if (length > 0) target = std::min(target, length);
        video_.seek(target);
        return true;
      }
      if (press.key == Key::Guide) {
        return true;
      }
      return false;
    }
    case Screen::Message: {
      if (press.key == Key::Ok || press.key == Key::Back) {
        if (backTo_ == Screen::Guide) {
          openGuide();
        } else {
          loadHome();
        }
        return true;
      }
      return false;
    }
  }
  return false;
}

}  // namespace utv

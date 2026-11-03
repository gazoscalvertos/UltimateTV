// The handful of Hub types the console client needs.
//
// These mirror `shared/src/domain.ts` but only the fields this client draws. Every reader
// is tolerant: a field the Hub stops sending, or sends as another type, becomes the default
// instead of a crash. `ps5/test/model_test.cpp` pins that down against real Hub JSON.
#ifndef UTV_MODEL_HPP
#define UTV_MODEL_HPP

#include <string>
#include <vector>

#include "json.hpp"

namespace utv {

struct Profile {
  std::string id;
  std::string name;
  std::string kind = "adult";  // adult | kids | guest
  std::string colour;
  bool hasPin = false;
  bool isKids() const { return kind == "kids"; }
};

struct ProfilesView {
  std::vector<Profile> profiles;
  /** A PIN is needed before the list is shown (Settings › Profiles). */
  bool locked = false;
};

struct TitleRef {
  std::string id;
  std::string kind;
  std::string name;
  std::string poster;
  std::string backdrop;
  std::string subtitle;
  double progress = -1;  // 0..1, or negative when there is none
  long year = 0;
};

struct Channel {
  std::string id;
  long number = 0;
  std::string name;
  std::string logo;
  std::string category;
};

struct Programme {
  std::string id;
  std::string channelId;
  std::string title;
  std::string subtitle;
  std::string description;
  long start = 0;
  long end = 0;
  bool isFilm = false;
};

struct Rail {
  std::string id;
  std::string title;
  std::string kind;  // titles | channels | recordings
  std::vector<TitleRef> titles;
  std::vector<Channel> channels;
};

struct HomeScreen {
  bool hasHero = false;
  TitleRef hero;
  std::string heroOverview;
  std::string heroAction;  // resume | watch | live
  std::vector<Rail> rails;
};

struct GuideRow {
  Channel channel;
  std::vector<Programme> programmes;
};

struct GuideWindow {
  long from = 0;
  long to = 0;
  std::vector<GuideRow> rows;
  /** The row the guide opens on: the first channel with something on now. */
  size_t pickNow(long now) const;
};

struct PlaybackRequest {
  std::string kind = "channel";  // channel | catchup | recording | title | stream
  std::string id;
  std::string episodeId;
  long start = 0;
};

struct PlaybackInfo {
  std::string url;
  std::string title;
  std::string subtitle;
  bool live = false;
  long startMs = 0;
  long durationMs = 0;
  std::string progressKey;
};

Profile profileFromJson(const Json& j);
ProfilesView profilesFromJson(const Json& j);
TitleRef titleFromJson(const Json& j);
Channel channelFromJson(const Json& j);
Programme programmeFromJson(const Json& j);
HomeScreen homeFromJson(const Json& j);
GuideWindow guideFromJson(const Json& j);
PlaybackInfo playbackFromJson(const Json& j);
/** The body for `POST /api/play`. */
std::string playbackRequestBody(const PlaybackRequest& req);
/** The body for `POST /api/progress`. */
std::string progressRequestBody(const std::string& key, long positionMs, long durationMs,
                                const std::string& title, const std::string& event,
                                long at);

}  // namespace utv

#endif  // UTV_MODEL_HPP

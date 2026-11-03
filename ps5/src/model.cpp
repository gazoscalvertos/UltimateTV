#include "model.hpp"

#include <algorithm>

namespace utv {

Profile profileFromJson(const Json& j) {
  Profile p;
  p.id = j.str("id");
  p.name = j.str("name");
  p.kind = j.str("kind", "adult");
  p.colour = j.str("colour");
  p.hasPin = j.flag("hasPin");
  return p;
}

ProfilesView profilesFromJson(const Json& j) {
  ProfilesView view;
  view.locked = j.flag("locked");
  for (const auto& p : j.list("profiles")) view.profiles.push_back(profileFromJson(p));
  return view;
}

TitleRef titleFromJson(const Json& j) {
  TitleRef t;
  t.id = j.str("id");
  t.kind = j.str("kind");
  t.name = j.str("name");
  t.poster = j.str("poster");
  t.backdrop = j.str("backdrop");
  t.subtitle = j.str("subtitle");
  t.year = j.integer("year", 0);
  const Json* progress = j.find("progress");
  if (progress && progress->isNumber()) {
    t.progress = progress->number;
  }
  return t;
}

Channel channelFromJson(const Json& j) {
  Channel c;
  c.id = j.str("id");
  c.number = j.integer("number", 0);
  c.name = j.str("name");
  c.logo = j.str("logo");
  c.category = j.str("category");
  return c;
}

Programme programmeFromJson(const Json& j) {
  Programme p;
  p.id = j.str("id");
  p.channelId = j.str("channelId");
  p.title = j.str("title");
  p.subtitle = j.str("subtitle");
  p.description = j.str("description");
  p.start = j.integer("start", 0);
  p.end = j.integer("end", 0);
  p.isFilm = j.flag("isFilm");
  return p;
}

HomeScreen homeFromJson(const Json& j) {
  HomeScreen home;
  if (const Json* hero = j.find("hero"); hero && hero->isObject()) {
    home.hasHero = true;
    home.hero = titleFromJson(*hero);
    home.heroOverview = hero->str("overview");
    home.heroAction = hero->str("action", "watch");
  }
  for (const auto& r : j.list("rails")) {
    Rail rail;
    rail.id = r.str("id");
    rail.title = r.str("title");
    rail.kind = r.str("kind", "titles");
    for (const auto& t : r.list("items")) rail.titles.push_back(titleFromJson(t));
    for (const auto& c : r.list("channels")) rail.channels.push_back(channelFromJson(c));
    // A channels rail carries NowNext entries, which have the channel's fields inline.
    if (rail.kind == "channels" && rail.channels.empty()) {
      for (const auto& c : r.list("channels")) rail.channels.push_back(channelFromJson(c));
    }
    home.rails.push_back(std::move(rail));
  }
  return home;
}

GuideWindow guideFromJson(const Json& j) {
  GuideWindow win;
  win.from = j.integer("from", 0);
  win.to = j.integer("to", 0);
  std::vector<Channel> channels;
  for (const auto& c : j.list("channels")) channels.push_back(channelFromJson(c));
  const Json* programmes = j.find("programmes");
  for (auto& channel : channels) {
    GuideRow row;
    row.channel = channel;
    if (programmes && programmes->isObject()) {
      if (const Json* list = programmes->find(channel.id); list && list->isArray()) {
        for (const auto& p : list->items) row.programmes.push_back(programmeFromJson(p));
      }
    }
    win.rows.push_back(std::move(row));
  }
  return win;
}

size_t GuideWindow::pickNow(long now) const {
  for (size_t i = 0; i < rows.size(); ++i) {
    for (const auto& p : rows[i].programmes) {
      if (p.start <= now && now < p.end) return i;
    }
  }
  return 0;
}

PlaybackInfo playbackFromJson(const Json& j) {
  PlaybackInfo info;
  info.url = j.str("url");
  info.title = j.str("title");
  info.subtitle = j.str("subtitle");
  info.live = j.flag("live");
  info.startMs = j.integer("startMs", 0);
  info.durationMs = j.integer("durationMs", 0);
  info.progressKey = j.str("progressKey");
  return info;
}

std::string playbackRequestBody(const PlaybackRequest& req) {
  Json body = Json::object();
  body.set("kind", Json::of(req.kind));
  body.set("id", Json::of(req.id));
  if (!req.episodeId.empty()) body.set("episodeId", Json::of(req.episodeId));
  if (req.start > 0) body.set("start", Json::of(static_cast<double>(req.start)));
  return writeJson(body);
}

std::string progressRequestBody(const std::string& key, long positionMs, long durationMs,
                                const std::string& title, const std::string& event,
                                long at) {
  Json body = Json::object();
  body.set("key", Json::of(key));
  body.set("positionMs", Json::of(static_cast<double>(positionMs)));
  // A report without an event is a plain position: the Hub treats it as one.
  if (!event.empty()) body.set("event", Json::of(event));
  if (durationMs > 0) body.set("durationMs", Json::of(static_cast<double>(durationMs)));
  if (!title.empty()) {
    Json ref = Json::object();
    ref.set("id", Json::of(title));
    ref.set("kind", Json::of("title"));
    ref.set("name", Json::of(title));
    body.set("title", std::move(ref));
  }
  // `at` lets the Hub keep the newest report when two devices report the same title.
  if (at > 0) body.set("at", Json::of(static_cast<double>(at)));
  return writeJson(body);
}

}  // namespace utv

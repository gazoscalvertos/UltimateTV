// The Hub API, as the console uses it.
//
// Every call is a small JSON request. The client keeps the two secrets a screen needs — its
// device token and, once chosen, the profile — and puts them on every request. The transport
// is injected so the host tests can answer with canned Hub JSON instead of needing a server.
#ifndef UTV_HUB_HPP
#define UTV_HUB_HPP

#include <string>
#include <vector>

#include "http.hpp"
#include "json.hpp"
#include "model.hpp"

namespace utv {

struct HubResult {
  bool ok = false;
  /** Plain words for the screen when `ok` is false. */
  std::string problem;
  Json body;
};

class Hub {
 public:
  explicit Hub(HttpTransport& transport);

  /** `http://192.168.0.19:8095` — the address last used or typed in. */
  void setBaseUrl(const std::string& url);
  const std::string& baseUrl() const { return baseUrl_; }

  const std::string& deviceToken() const { return deviceToken_; }
  void setDeviceToken(const std::string& token) { deviceToken_ = token; }

  const std::string& profileId() const { return profileId_; }
  void setProfileId(const std::string& id) { profileId_ = id; }

  /**
   * The token a protected profile gives back when its PIN is entered. It is what lets the
   * Hub believe this screen is really watching as that profile. Without it the Hub falls back
   * to the safest profile, so losing it means the wrong profile's films and rows.
   */
  const std::string& profileToken() const { return profileToken_; }
  void setProfileToken(const std::string& token) { profileToken_ = token; }

  /** `GET /api/health`, which needs no token: is there a Hub at that address at all? */
  HubResult health();

  /**
   * `POST /api/pair/screen`: a screen joins the Hub. The first screen is let in at once;
   * a later one answers `waiting` and must be let in from the TV or the setup page, so the
   * caller polls `collectScreen`.
   */
  HubResult pairScreen(const std::string& name);
  HubResult collectScreen(const std::string& requestId, const std::string& secret);

  /** `GET /api/profiles` — who is watching. */
  HubResult profiles();

  /**
   * `POST /api/profiles/:id/unlock` — the PIN for a protected profile. Answers the profile
   * token in the body's `token`, which `profileToken` then carries on every later request.
   * A wrong PIN is a refusal, so `ok` is false and `problem` is the Hub's own words.
   */
  HubResult unlock(const std::string& profileId, const std::string& pin);
  /** `GET /api/home` for the chosen profile. */
  HubResult home();
  /** `GET /api/guide?from=&to=` for the chosen profile. */
  HubResult guide(long from, long to);
  /** `POST /api/play`. */
  HubResult play(const PlaybackRequest& request);
  /** `POST /api/progress` — a position report, which is how Continue watching works. */
  HubResult progress(const std::string& key, long positionMs, long durationMs,
                     const std::string& title, const std::string& event, long at);
  /** `GET /api/settings`, for the things a screen is allowed to know. */
  HubResult settings();

  /** True when a failure was because the Hub couldn't be reached (worth retrying). */
  static bool unreachable(const HubResult& result);

 private:
  HubResult call(const std::string& method, const std::string& path, const std::string& body,
                 bool withToken);
  HttpTransport& transport_;
  std::string baseUrl_ = "http://127.0.0.1:8095";
  std::string deviceToken_;
  std::string profileId_;
  std::string profileToken_;
};

/** The last address, device token and profile, kept between runs on the console. */
struct SavedSession {
  std::string baseUrl;
  std::string deviceToken;
  std::string profileId;
  /** The PIN token for a protected profile; empty for an open one. */
  std::string profileToken;
};

/** Reads the session file. A missing or damaged file gives an empty session, never an error. */
SavedSession loadSession(const std::string& path);
/** Writes the session. Answers false when the file couldn't be written. */
bool saveSession(const std::string& path, const SavedSession& session);
/** The session file's place on this platform (the console keeps it in /data). */
std::string defaultSessionPath();

}  // namespace utv

#endif  // UTV_HUB_HPP

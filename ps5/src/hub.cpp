#include "hub.hpp"

#include <cstdio>
#include <cstdlib>

namespace utv {

namespace {

std::string joinUrl(const std::string& base, const std::string& path) {
  if (base.empty()) return path;
  if (!path.empty() && path[0] == '/') return base + path;
  return base + "/" + path;
}

/** The Hub's error text, or a plain-words fallback when it sent none. */
std::string problemFrom(const HttpResponse& response, const Json& body) {
  const std::string sent = body.str("error");
  if (!sent.empty()) return sent;
  if (response.timeout()) return "The Hub didn't answer. Is it switched on?";
  if (!response.error.empty()) return response.error;
  if (response.status == 401 || response.status == 403) {
    return "The Hub turned that down. Pair this console again.";
  }
  if (response.status == 404) return "The Hub doesn't have that.";
  if (response.status >= 500) return "The Hub had a problem with that. Try again.";
  return "The Hub answered " + std::to_string(response.status) + ".";
}

}  // namespace

Hub::Hub(HttpTransport& transport) : transport_(transport) {}

void Hub::setBaseUrl(const std::string& url) {
  // Trailing slashes make `//api` in the path, which some proxies dislike.
  std::string trimmed = url;
  while (trimmed.size() > 1 && trimmed.back() == '/') trimmed.pop_back();
  baseUrl_ = trimmed;
}

HubResult Hub::call(const std::string& method, const std::string& path,
                    const std::string& body, bool withToken) {
  HubResult result;
  HttpRequest request;
  request.method = method;
  request.url = joinUrl(baseUrl_, path);
  if (!body.empty()) request.body = body;
  if (withToken && !deviceToken_.empty()) {
    request.headers.emplace_back("X-Device-Token", deviceToken_);
  }
  if (withToken && !profileId_.empty()) {
    request.headers.emplace_back("X-Profile", profileId_);
  }
  // Only a protected profile has one of these; it is what proves the PIN was entered here.
  if (withToken && !profileToken_.empty()) {
    request.headers.emplace_back("X-Profile-Token", profileToken_);
  }
  const HttpResponse response = transport_.send(request);
  if (!response.error.empty() && response.status == 0) {
    result.problem = problemFrom(response, Json());
    return result;
  }
  // A Hub error page is HTML, not JSON, and a reverse proxy in front of a stopped Hub sends
  // exactly that. So an unreadable body only means "wrong address" when the status was fine;
  // on an error status the status itself is the better thing to say.
  const bool readable =
      response.body.empty() || parseJson(response.body, result.body, nullptr);
  if (response.status < 200 || response.status >= 300) {
    result.problem = problemFrom(response, readable ? result.body : Json());
    return result;
  }
  if (!readable) {
    result.problem = "The Hub sent something that isn't the app's answer. Is the address right?";
    return result;
  }
  result.ok = true;
  return result;
}

HubResult Hub::health() {
  // `/api/health` is public, so this also works before the screen is paired.
  HubResult result = call("GET", "/api/health", "", false);
  if (result.ok && !result.body.flag("ok", true)) {
    result.ok = false;
    result.problem = result.body.str("status", "The Hub says it isn't well.");
  }
  return result;
}

HubResult Hub::pairScreen(const std::string& name) {
  Json body = Json::object();
  body.set("name", Json::of(name));
  HubResult result = call("POST", "/api/pair/screen", writeJson(body), false);
  if (result.ok) {
    const std::string token = result.body.str("token");
    if (!token.empty()) deviceToken_ = token;
  }
  return result;
}

HubResult Hub::collectScreen(const std::string& requestId, const std::string& secret) {
  Json body = Json::object();
  if (!secret.empty()) body.set("secret", Json::of(secret));
  HubResult result =
      call("POST", "/api/pair/screen/" + requestId, writeJson(body), false);
  if (result.ok) {
    const std::string token = result.body.str("token");
    if (!token.empty()) deviceToken_ = token;
  }
  return result;
}

HubResult Hub::profiles() { return call("GET", "/api/profiles", "", true); }

HubResult Hub::unlock(const std::string& profileId, const std::string& pin) {
  Json body = Json::object();
  body.set("pin", Json::of(pin));
  HubResult result =
      call("POST", "/api/profiles/" + profileId + "/unlock", writeJson(body), true);
  if (result.ok) {
    const std::string token = result.body.str("token");
    if (!token.empty()) profileToken_ = token;
  }
  return result;
}

HubResult Hub::home() { return call("GET", "/api/home", "", true); }

HubResult Hub::guide(long from, long to) {
  return call("GET", "/api/guide?from=" + std::to_string(from) + "&to=" + std::to_string(to), "",
              true);
}

HubResult Hub::play(const PlaybackRequest& request) {
  return call("POST", "/api/play", playbackRequestBody(request), true);
}

HubResult Hub::progress(const std::string& key, long positionMs, long durationMs,
                        const std::string& title, const std::string& event, long at) {
  return call("POST", "/api/progress",
              progressRequestBody(key, positionMs, durationMs, title, event, at), true);
}

HubResult Hub::settings() { return call("GET", "/api/settings", "", true); }

bool Hub::unreachable(const HubResult& result) { return result.problem.find("didn't answer") != std::string::npos; }

std::string defaultSessionPath() { return "/data/ultimatetv/session.txt"; }

SavedSession loadSession(const std::string& path) {
  SavedSession session;
  std::FILE* file = std::fopen(path.c_str(), "rb");
  if (!file) return session;
  std::string text;
  char buf[512];
  size_t n = 0;
  while ((n = std::fread(buf, 1, sizeof buf, file)) > 0) text.append(buf, n);
  std::fclose(file);
  Json json;
  if (!parseJson(text, json, nullptr)) return session;
  session.baseUrl = json.str("baseUrl");
  session.deviceToken = json.str("deviceToken");
  session.profileId = json.str("profileId");
  session.profileToken = json.str("profileToken");
  return session;
}

bool saveSession(const std::string& path, const SavedSession& session) {
  Json json = Json::object();
  json.set("baseUrl", Json::of(session.baseUrl));
  json.set("deviceToken", Json::of(session.deviceToken));
  json.set("profileId", Json::of(session.profileId));
  if (!session.profileToken.empty()) json.set("profileToken", Json::of(session.profileToken));
  const std::string text = writeJson(json);
  std::FILE* file = std::fopen(path.c_str(), "wb");
  if (!file) return false;
  const size_t written = std::fwrite(text.data(), 1, text.size(), file);
  std::fclose(file);
  return written == text.size();
}

}  // namespace utv

// Just enough HTTP/1.1 to talk to the Hub.
//
// The PS5 SDK has libcurl, but the client only ever makes small JSON calls to one host, and
// plain sockets link with no extra libraries at all (proved by `ps5/probe/sock.c`). Keeping
// it to sockets also means the same code runs on the build machine, so `ps5/test` can test
// it against a real listening socket instead of a mock.
#ifndef UTV_HTTP_HPP
#define UTV_HTTP_HPP

#include <string>
#include <utility>
#include <vector>

namespace utv {

struct HttpRequest {
  std::string method = "GET";
  std::string url;
  std::vector<std::pair<std::string, std::string>> headers;
  std::string body;
  int timeoutMs = 10000;
};

struct HttpResponse {
  int status = 0;
  std::string body;
  /** Set instead of `status` when the request never got an answer. */
  std::string error;
  bool ok() const { return error.empty() && status >= 200 && status < 300; }
  bool timeout() const { return error == "timed out"; }
};

/** Anything that can make an HTTP request. The Hub talks through this, so tests can too. */
class HttpTransport {
 public:
  virtual ~HttpTransport() = default;
  virtual HttpResponse send(const HttpRequest& request) = 0;
};

/** A URL split into the pieces `SocketTransport` needs. */
struct Url {
  bool https = false;
  std::string host;
  int port = 80;
  std::string path = "/";
};

/** Reads `http://host[:port]/path`. Answers false when the text isn't a usable URL. */
bool parseUrl(const std::string& text, Url& out, std::string* error);

/** A blocking HTTP/1.1 client. One connection per request, which is plenty for this app. */
class SocketTransport : public HttpTransport {
 public:
  HttpResponse send(const HttpRequest& request) override;
};

}  // namespace utv

#endif  // UTV_HTTP_HPP

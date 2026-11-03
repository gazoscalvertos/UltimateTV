#include "http.hpp"

#include <cerrno>
#include <chrono>
#include <cstdlib>
#include <cstring>

#include <arpa/inet.h>
#include <fcntl.h>
#include <netdb.h>
#include <netinet/in.h>
#include <poll.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <unistd.h>

namespace utv {

namespace {

std::string lower(std::string text) {
  for (auto& c : text) {
    if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
  }
  return text;
}

std::string trim(const std::string& text) {
  size_t begin = 0;
  size_t end = text.size();
  while (begin < end && (text[begin] == ' ' || text[begin] == '\t' || text[begin] == '\r' ||
                         text[begin] == '\n')) {
    ++begin;
  }
  while (end > begin && (text[end - 1] == ' ' || text[end - 1] == '\t' || text[end - 1] == '\r' ||
                         text[end - 1] == '\n')) {
    --end;
  }
  return text.substr(begin, end - begin);
}

std::string reasonFor(int status) {
  switch (status) {
    case 200: return "OK";
    case 201: return "Created";
    case 202: return "Accepted";
    case 204: return "No Content";
    case 400: return "Bad Request";
    case 401: return "Unauthorized";
    case 403: return "Forbidden";
    case 404: return "Not Found";
    case 500: return "Internal Server Error";
    case 503: return "Service Unavailable";
    default: return "Status";
  }
}

/** Waits for `fd` to be readable or writable, honouring the request's timeout. */
bool waitFor(int fd, short events, long long deadlineMs, std::string& error) {
  while (true) {
    const long long left = deadlineMs - std::chrono::duration_cast<std::chrono::milliseconds>(
                                           std::chrono::steady_clock::now().time_since_epoch())
                                           .count();
    if (left <= 0) {
      error = "timed out";
      return false;
    }
    struct pollfd pfd {};
    pfd.fd = fd;
    pfd.events = events;
    const int ms = static_cast<int>(left > 1000 ? 1000 : left);
    const int r = ::poll(&pfd, 1, ms);
    if (r < 0) {
      if (errno == EINTR) continue;
      error = std::string("poll: ") + std::strerror(errno);
      return false;
    }
    if (r == 0) continue;
    return true;
  }
}

}  // namespace

bool parseUrl(const std::string& text, Url& out, std::string* error) {
  Url url;
  std::string rest = text;
  const std::string http = "http://";
  const std::string https = "https://";
  if (rest.rfind(http, 0) == 0) {
    rest = rest.substr(http.size());
  } else if (rest.rfind(https, 0) == 0) {
    url.https = true;
    url.port = 443;
    rest = rest.substr(https.size());
  } else {
    if (error) *error = "the address must start with http://";
    return false;
  }
  const size_t slash = rest.find('/');
  std::string authority = slash == std::string::npos ? rest : rest.substr(0, slash);
  url.path = slash == std::string::npos ? "/" : rest.substr(slash);
  const size_t colon = authority.rfind(':');
  if (colon != std::string::npos) {
    url.port = std::atoi(authority.substr(colon + 1).c_str());
    authority = authority.substr(0, colon);
  }
  if (authority.empty()) {
    if (error) *error = "there is no host in the address";
    return false;
  }
  if (url.port <= 0 || url.port > 65535) {
    if (error) *error = "the port isn't a number";
    return false;
  }
  url.host = authority;
  out = url;
  return true;
}

HttpResponse SocketTransport::send(const HttpRequest& request) {
  HttpResponse response;
  Url url;
  std::string why;
  if (!parseUrl(request.url, url, &why)) {
    response.error = why;
    return response;
  }
  if (url.https) {
    // There is no TLS in this client: the Hub is on the home network over plain HTTP.
    response.error = "https isn't supported by this client";
    return response;
  }

  struct addrinfo hints {};
  hints.ai_family = AF_UNSPEC;
  hints.ai_socktype = SOCK_STREAM;
  struct addrinfo* found = nullptr;
  const std::string port = std::to_string(url.port);
  const int gai = ::getaddrinfo(url.host.c_str(), port.c_str(), &hints, &found);
  if (gai != 0 || !found) {
    response.error = std::string("can't find ") + url.host;
    return response;
  }

  int fd = -1;
  for (struct addrinfo* it = found; it; it = it->ai_next) {
    fd = ::socket(it->ai_family, it->ai_socktype, it->ai_protocol);
    if (fd < 0) continue;
    // Non-blocking connect so a Hub that is switched off answers quickly instead of hanging
    // the whole app behind a two-minute TCP timeout.
    const int flags = ::fcntl(fd, F_GETFL, 0);
    ::fcntl(fd, F_SETFL, flags | O_NONBLOCK);
    const int r = ::connect(fd, it->ai_addr, it->ai_addrlen);
    if (r == 0) {
      ::fcntl(fd, F_SETFL, flags);
      break;
    }
    if (errno == EINPROGRESS) {
      const auto now = std::chrono::steady_clock::now().time_since_epoch();
      const long long deadline =
          std::chrono::duration_cast<std::chrono::milliseconds>(now).count() + request.timeoutMs;
      if (waitFor(fd, POLLOUT, deadline, response.error)) {
        int so = 0;
        socklen_t len = sizeof so;
        if (::getsockopt(fd, SOL_SOCKET, SO_ERROR, &so, &len) == 0 && so == 0) {
          ::fcntl(fd, F_SETFL, flags);
          break;
        }
      }
    }
    ::close(fd);
    fd = -1;
  }
  ::freeaddrinfo(found);
  if (fd < 0) {
    if (response.error.empty()) response.error = std::string("can't reach ") + url.host;
    return response;
  }

  std::string head;
  head += request.method + " " + url.path + " HTTP/1.1\r\n";
  head += "Host: " + url.host + ":" + std::to_string(url.port) + "\r\n";
  head += "Connection: close\r\n";
  head += "Accept: application/json\r\n";
  bool hasType = false;
  for (const auto& h : request.headers) {
    if (lower(h.first) == "content-type") hasType = true;
    head += h.first + ": " + h.second + "\r\n";
  }
  if (!request.body.empty() && !hasType) head += "Content-Type: application/json\r\n";
  if (!request.body.empty()) head += "Content-Length: " + std::to_string(request.body.size()) + "\r\n";
  head += "\r\n";
  head += request.body;

  const auto start = std::chrono::steady_clock::now().time_since_epoch();
  const long long deadline =
      std::chrono::duration_cast<std::chrono::milliseconds>(start).count() + request.timeoutMs;

  size_t sent = 0;
  while (sent < head.size()) {
    if (!waitFor(fd, POLLOUT, deadline, response.error)) {
      ::close(fd);
      return response;
    }
    const ssize_t n = ::send(fd, head.data() + sent, head.size() - sent, MSG_NOSIGNAL);
    if (n <= 0) {
      if (n < 0 && (errno == EAGAIN || errno == EWOULDBLOCK || errno == EINTR)) continue;
      response.error = std::string("sending failed: ") + std::strerror(errno);
      ::close(fd);
      return response;
    }
    sent += static_cast<size_t>(n);
  }

  std::string raw;
  char buf[4096];
  while (true) {
    if (!waitFor(fd, POLLIN, deadline, response.error)) {
      ::close(fd);
      return response;
    }
    const ssize_t n = ::recv(fd, buf, sizeof buf, 0);
    if (n == 0) break;
    if (n < 0) {
      if (errno == EAGAIN || errno == EWOULDBLOCK || errno == EINTR) continue;
      response.error = std::string("reading failed: ") + std::strerror(errno);
      ::close(fd);
      return response;
    }
    raw.append(buf, static_cast<size_t>(n));
  }
  ::close(fd);

  const size_t split = raw.find("\r\n\r\n");
  if (split == std::string::npos) {
    response.error = "the Hub answered with something that isn't HTTP";
    return response;
  }
  const std::string headerText = raw.substr(0, split);
  std::string body = raw.substr(split + 4);

  const size_t firstLine = headerText.find("\r\n");
  const std::string statusLine = headerText.substr(0, firstLine);
  const size_t space1 = statusLine.find(' ');
  if (space1 == std::string::npos) {
    response.error = "the Hub answered without a status";
    return response;
  }
  response.status = std::atoi(statusLine.substr(space1 + 1).c_str());

  bool chunked = false;
  long long contentLength = -1;
  size_t lineAt = firstLine == std::string::npos ? headerText.size() : firstLine + 2;
  while (lineAt < headerText.size()) {
    size_t lineEnd = headerText.find("\r\n", lineAt);
    if (lineEnd == std::string::npos) lineEnd = headerText.size();
    const std::string line = headerText.substr(lineAt, lineEnd - lineAt);
    const size_t colon = line.find(':');
    if (colon != std::string::npos) {
      const std::string name = lower(trim(line.substr(0, colon)));
      const std::string value = trim(line.substr(colon + 1));
      if (name == "content-length") contentLength = std::atoll(value.c_str());
      if (name == "transfer-encoding" && lower(value).find("chunked") != std::string::npos) {
        chunked = true;
      }
    }
    lineAt = lineEnd + 2;
  }

  if (chunked) {
    std::string decoded;
    size_t at = 0;
    while (at < body.size()) {
      const size_t eol = body.find("\r\n", at);
      if (eol == std::string::npos) break;
      const long size = std::strtol(body.substr(at, eol - at).c_str(), nullptr, 16);
      if (size <= 0) break;
      at = eol + 2;
      if (at + static_cast<size_t>(size) > body.size()) break;
      decoded.append(body, at, static_cast<size_t>(size));
      at += static_cast<size_t>(size) + 2;
    }
    body = decoded;
  } else if (contentLength >= 0 && body.size() > static_cast<size_t>(contentLength)) {
    body.resize(static_cast<size_t>(contentLength));
  }
  response.body = body;
  if (response.status == 0) {
    response.error = "the Hub answered without a status";
  } else if (response.status >= 400 && response.body.empty()) {
    response.body = reasonFor(response.status);
  }
  return response;
}

}  // namespace utv

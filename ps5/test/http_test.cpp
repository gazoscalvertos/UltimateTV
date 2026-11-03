// Tests for the small HTTP client.
//
// Two kinds of test: reading addresses (`parseUrl`), and talking to a real listening socket
// started inside the test, which is the only way to be sure the request that leaves here is a
// request the Hub can answer.
#include "http.hpp"

#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

#include <string>
#include <thread>

#include "test.hpp"

using utv::HttpRequest;
using utv::HttpResponse;
using utv::SocketTransport;
using utv::Url;
using utv::parseUrl;

namespace {

/** A one-shot HTTP server on 127.0.0.1. Answers with whatever it is constructed with. */
class TinyServer {
 public:
  explicit TinyServer(std::string reply) : reply_(std::move(reply)) {
    listen_ = ::socket(AF_INET, SOCK_STREAM, 0);
    CHECK_MESSAGE(listen_ >= 0, "no listening socket");
    int reuse = 1;
    ::setsockopt(listen_, SOL_SOCKET, SO_REUSEADDR, &reuse, sizeof reuse);
    sockaddr_in address {};
    address.sin_family = AF_INET;
    address.sin_addr.s_addr = ::htonl(INADDR_LOOPBACK);
    address.sin_port = 0;
    CHECK_MESSAGE(::bind(listen_, reinterpret_cast<sockaddr*>(&address), sizeof address) == 0,
                  "couldn't bind");
    socklen_t length = sizeof address;
    ::getsockname(listen_, reinterpret_cast<sockaddr*>(&address), &length);
    port_ = ::ntohs(address.sin_port);
    CHECK_MESSAGE(::listen(listen_, 4) == 0, "couldn't listen");
    worker_ = std::thread([this] { serve(); });
  }

  ~TinyServer() {
    if (worker_.joinable()) worker_.join();
    if (listen_ >= 0) ::close(listen_);
  }

  int port() const { return port_; }
  const std::string& request() const { return seen_; }

 private:
  void serve() {
    const int client = ::accept(listen_, nullptr, nullptr);
    if (client < 0) return;
    char buf[4096];
    // One read is enough: the client sends a small request in a single write.
    const ssize_t got = ::read(client, buf, sizeof buf);
    if (got > 0) seen_.assign(buf, static_cast<size_t>(got));
    ::write(client, reply_.data(), reply_.size());
    ::close(client);
  }

  std::string reply_;
  std::string seen_;
  int listen_ = -1;
  int port_ = 0;
  std::thread worker_;
};

std::string withLength(const std::string& statusLine, const std::string& body) {
  return statusLine + "\r\nContent-Type: application/json\r\nContent-Length: " +
         std::to_string(body.size()) + "\r\nConnection: close\r\n\r\n" + body;
}

}  // namespace

TEST(an_address_with_a_port_and_a_path_is_read) {
  Url url;
  std::string error;
  CHECK(parseUrl("http://192.168.0.19:8095/api/home", url, &error));
  CHECK(!url.https);
  CHECK_EQ(url.host, std::string("192.168.0.19"));
  CHECK_EQ(url.port, 8095);
  CHECK_EQ(url.path, std::string("/api/home"));
}

TEST(an_address_without_a_port_uses_80) {
  Url url;
  std::string error;
  CHECK(parseUrl("http://ultimatetv.local/api/health", url, &error));
  CHECK_EQ(url.host, std::string("ultimatetv.local"));
  CHECK_EQ(url.port, 80);
  CHECK_EQ(url.path, std::string("/api/health"));
}

TEST(an_address_without_a_path_asks_for_the_root) {
  Url url;
  std::string error;
  CHECK(parseUrl("http://192.168.0.19:8095", url, &error));
  CHECK_EQ(url.port, 8095);
  CHECK_EQ(url.path, std::string("/"));
}

TEST(an_https_address_is_recognised) {
  Url url;
  std::string error;
  CHECK(parseUrl("https://hub.example.com/x", url, &error));
  CHECK(url.https);
  CHECK_EQ(url.port, 443);
  CHECK_EQ(url.host, std::string("hub.example.com"));
}

TEST(nonsense_addresses_are_turned_down_with_a_reason) {
  for (const char* text : {"", "not a url", "ftp://host/x", "http://", "http://:8095/"}) {
    Url url;
    std::string error;
    const bool ok = parseUrl(text, url, &error);
    CHECK_MESSAGE(!ok, std::string("accepted: ") + text);
    CHECK_MESSAGE(!error.empty(), std::string("no reason given for: ") + text);
  }
}

TEST(a_get_goes_out_as_an_http_request) {
  TinyServer server(withLength("HTTP/1.1 200 OK", R"({"ok":true})"));
  SocketTransport transport;
  HttpRequest request;
  request.url = "http://127.0.0.1:" + std::to_string(server.port()) + "/api/health";
  const HttpResponse response = transport.send(request);
  CHECK_MESSAGE(response.error.empty(), response.error);
  CHECK_EQ(response.status, 200);
  CHECK_EQ(response.body, std::string(R"({"ok":true})"));
  const std::string& seen = server.request();
  CHECK(seen.find("GET /api/health HTTP/1.1") != std::string::npos);
  CHECK(seen.find("Host: 127.0.0.1:") != std::string::npos);
  CHECK(seen.find("Connection: close") != std::string::npos);
}

TEST(headers_and_a_body_are_sent) {
  TinyServer server(withLength("HTTP/1.1 200 OK", "{\"paired\":true}"));
  SocketTransport transport;
  HttpRequest request;
  request.method = "POST";
  request.url = "http://127.0.0.1:" + std::to_string(server.port()) + "/api/pair/screen";
  request.headers.emplace_back("X-Device-Token", "utv_abc");
  request.body = R"({"name":"PlayStation 5"})";
  const HttpResponse response = transport.send(request);
  CHECK_EQ(response.status, 200);
  const std::string& seen = server.request();
  CHECK(seen.find("POST /api/pair/screen HTTP/1.1") != std::string::npos);
  CHECK(seen.find("X-Device-Token: utv_abc\r\n") != std::string::npos);
  CHECK(seen.find("Content-Length: 24") != std::string::npos);
  CHECK(seen.find(R"({"name":"PlayStation 5"})") != std::string::npos);
}

TEST(an_error_status_is_not_ok_but_still_has_its_body) {
  TinyServer server(withLength("HTTP/1.1 403 Forbidden", R"({"error":"Pair this screen again."})"));
  SocketTransport transport;
  HttpRequest request;
  request.url = "http://127.0.0.1:" + std::to_string(server.port()) + "/api/home";
  const HttpResponse response = transport.send(request);
  CHECK(response.error.empty());
  CHECK_EQ(response.status, 403);
  CHECK(!response.ok());
  CHECK_EQ(response.body, std::string(R"({"error":"Pair this screen again."})"));
}

TEST(a_chunked_answer_is_put_back_together) {
  const std::string body = R"({"a":1,"b":"two"})";
  // Chunk sizes are hex, not decimal: 17 bytes of body, sent as 5 then 0xc.
  const std::string reply = "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n" +
                            std::string("5\r\n") + body.substr(0, 5) + "\r\n" +
                            std::string("c\r\n") + body.substr(5) + "\r\n0\r\n\r\n";
  TinyServer server(reply);
  SocketTransport transport;
  HttpRequest request;
  request.url = "http://127.0.0.1:" + std::to_string(server.port()) + "/api/home";
  const HttpResponse response = transport.send(request);
  CHECK_EQ(response.status, 200);
  CHECK_EQ(response.body, body);
}

TEST(a_hub_that_isnt_there_gives_an_error_not_a_hang) {
  SocketTransport transport;
  HttpRequest request;
  // Port 1 is never listening; the connect must fail quickly.
  request.url = "http://127.0.0.1:1/api/health";
  request.timeoutMs = 2000;
  const HttpResponse response = transport.send(request);
  CHECK(!response.error.empty());
  CHECK_EQ(response.status, 0);
  CHECK(!response.ok());
}

TEST(an_https_url_is_refused_in_plain_words) {
  SocketTransport transport;
  HttpRequest request;
  request.url = "https://192.168.0.19:8095/api/health";
  const HttpResponse response = transport.send(request);
  CHECK(!response.error.empty());
  CHECK(response.error.find("https") != std::string::npos);
}

int main() { return utvtest::run(); }

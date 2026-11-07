#include "renderer.hpp"

#include <cctype>

namespace utv {

namespace {

const char* const SOFTWARE = "software";

bool sameName(const std::string& a, const std::string& b) {
  if (a.size() != b.size()) return false;
  for (size_t i = 0; i < a.size(); ++i) {
    if (std::tolower(static_cast<unsigned char>(a[i])) !=
        std::tolower(static_cast<unsigned char>(b[i]))) {
      return false;
    }
  }
  return true;
}

bool alreadyListed(const std::vector<RenderAttempt>& attempts, int index) {
  for (const RenderAttempt& a : attempts) {
    if (a.kind == RenderAttempt::Kind::Driver && a.index == index) return true;
  }
  return false;
}

void addDriver(std::vector<RenderAttempt>& attempts, const RenderDriver& driver) {
  if (driver.index < 0 || alreadyListed(attempts, driver.index)) return;
  RenderAttempt attempt;
  attempt.kind = RenderAttempt::Kind::Driver;
  attempt.index = driver.index;
  attempt.name = driver.name;
  attempts.push_back(attempt);
}

}  // namespace

std::vector<RenderAttempt> renderAttempts(const std::vector<RenderDriver>& drivers,
                                          const std::string& preferred) {
  std::vector<RenderAttempt> attempts;
  const std::string wanted = cleanRendererName(preferred);
  if (!wanted.empty()) {
    for (const RenderDriver& d : drivers) {
      if (sameName(d.name, wanted)) addDriver(attempts, d);
    }
  }
  for (const RenderDriver& d : drivers) {
    if (sameName(d.name, SOFTWARE)) addDriver(attempts, d);
  }
  for (const RenderDriver& d : drivers) addDriver(attempts, d);

  RenderAttempt surface;
  surface.kind = RenderAttempt::Kind::WindowSurface;
  surface.name = "the window's own surface";
  attempts.push_back(surface);
  return attempts;
}

std::vector<PixelSize> windowSizesToTry(const PixelSize& first) {
  std::vector<PixelSize> sizes;
  const PixelSize fallbacks[] = {first, PixelSize{1920, 1080}, PixelSize{1280, 720}};
  for (const PixelSize& size : fallbacks) {
    if (!isUsableSize(size)) continue;
    if (!sizes.empty() && (size.width > sizes.front().width || size.height > sizes.front().height)) {
      continue;
    }
    bool seen = false;
    for (const PixelSize& s : sizes) {
      if (s.width == size.width && s.height == size.height) seen = true;
    }
    if (!seen) sizes.push_back(size);
  }
  if (sizes.empty()) sizes.push_back(PixelSize{1920, 1080});
  return sizes;
}

std::string cleanRendererName(const std::string& raw) {
  std::string name;
  for (char c : raw) {
    const unsigned char u = static_cast<unsigned char>(c);
    if (std::isspace(u)) continue;
    name += static_cast<char>(std::tolower(u));
  }
  return name;
}

std::string reasonOrUnknown(const char* why) {
  if (why && *why) return why;
  return "the console did not say why";
}

}  // namespace utv

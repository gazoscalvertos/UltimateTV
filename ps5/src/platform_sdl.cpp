// A window on the console: SDL2 draws the picture, ImGui draws the text.
//
// The console's pads arrive as SDL joystick events (SDL's PS5 joystick driver), so one press
// here becomes one KeyPress in ui.cpp. Held directions repeat, because a TV app that only
// moves one step per press is unusable.
#include <string>
#include <vector>

#include "SDL.h"
#include "imgui.h"
#include "imgui_impl_sdl2.h"
#include "imgui_impl_sdlrenderer2.h"

#include "display.hpp"
#include "platform.hpp"
#include "text.hpp"
#include "ui.hpp"

namespace utv {

namespace {

/** How long a direction must be held before it repeats, and how often after that. */
const Uint32 REPEAT_DELAY_MS = 380;
const Uint32 REPEAT_EVERY_MS = 90;

/**
 * Whether to ask the console for its biggest picture. On by default; `--1080p` turns it off,
 * which is the way to find out whether a 4K picture is too much for the console to decode.
 */
bool want4k = true;

/** The layout was drawn for this height, so the font grows with the surface. */
const float BASE_FONT_SCALE = 1.9f;

Key keyForButton(Uint8 button) {
  switch (button) {
    case SDL_CONTROLLER_BUTTON_DPAD_UP: return Key::Up;
    case SDL_CONTROLLER_BUTTON_DPAD_DOWN: return Key::Down;
    case SDL_CONTROLLER_BUTTON_DPAD_LEFT: return Key::Left;
    case SDL_CONTROLLER_BUTTON_DPAD_RIGHT: return Key::Right;
    case SDL_CONTROLLER_BUTTON_A: return Key::Ok;
    case SDL_CONTROLLER_BUTTON_B: return Key::Back;
    case SDL_CONTROLLER_BUTTON_Y: return Key::Guide;
    case SDL_CONTROLLER_BUTTON_X: return Key::Info;
    case SDL_CONTROLLER_BUTTON_LEFTSHOULDER: return Key::Rewind;
    case SDL_CONTROLLER_BUTTON_RIGHTSHOULDER: return Key::Forward;
    case SDL_CONTROLLER_BUTTON_START: return Key::PlayPause;
    default: return Key::Ok;
  }
}

bool isDirection(Key key) {
  return key == Key::Up || key == Key::Down || key == Key::Left || key == Key::Right;
}

/** SDL's key codes to the app's keys, for a keyboard plugged into the console. */
bool keyForKeyboard(SDL_Keycode code, KeyPress& press) {
  switch (code) {
    case SDLK_UP: press = KeyPress(Key::Up); return true;
    case SDLK_DOWN: press = KeyPress(Key::Down); return true;
    case SDLK_LEFT: press = KeyPress(Key::Left); return true;
    case SDLK_RIGHT: press = KeyPress(Key::Right); return true;
    case SDLK_RETURN:
    case SDLK_KP_ENTER: press = KeyPress(Key::Ok); return true;
    case SDLK_ESCAPE:
    case SDLK_BACKSPACE: press = KeyPress(Key::Back); return true;
    case SDLK_SPACE:
    case SDLK_p: press = KeyPress(Key::PlayPause); return true;
    case SDLK_g: press = KeyPress(Key::Guide); return true;
    case SDLK_i: press = KeyPress(Key::Info); return true;
    case SDLK_r: press = KeyPress(Key::Rewind); return true;
    case SDLK_f: press = KeyPress(Key::Forward); return true;
    default:
      if (code >= SDLK_0 && code <= SDLK_9) {
        press = KeyPress(Key::Digit, static_cast<int>(code - SDLK_0));
        return true;
      }
      return false;
  }
}

class SdlWindow : public Window {
 public:
  bool open(std::string& problem);
  ~SdlWindow() override;
  void draw(App& app) override;
  std::vector<int> pump(int timeoutMs, bool& closed) override;
  void size(int& width, int& height) override;
  void setVideo(Video* video) override {
    video_ = video;
    // The window may already be open when the player arrives, so it is told the size here too.
    if (video_ && width_ > 0 && height_ > 0) video_->setDisplaySize(width_, height_);
  }

 private:
  void handleEvent(const SDL_Event& event, std::vector<int>& keys, bool& closed);

  SDL_Window* window_ = nullptr;
  SDL_Renderer* renderer_ = nullptr;
  SDL_GameController* pad_ = nullptr;
  Video* video_ = nullptr;
  int width_ = 1920;
  int height_ = 1080;
  /** The direction being held, and when it started. */
  Key held_ = Key::Ok;
  bool holding_ = false;
  Uint32 heldSince_ = 0;
  Uint32 lastRepeat_ = 0;
};

bool SdlWindow::open(std::string& problem) {
  if (SDL_Init(SDL_INIT_VIDEO | SDL_INIT_GAMECONTROLLER | SDL_INIT_AUDIO) != 0) {
    problem = std::string("The console wouldn't start a window: ") + SDL_GetError();
    return false;
  }
  // What the console can show, asked before the window is made: the driver offers 1080p and
  // 4K, and asking for the biggest one is the only way a 4K film reaches a 4K television
  // without being shrunk to 1080p and stretched back up.
  std::vector<ModeSize> offered;
  const int displays = SDL_GetNumVideoDisplays();
  for (int d = 0; d < displays; ++d) {
    const int modes = SDL_GetNumDisplayModes(d);
    for (int m = 0; m < modes; ++m) {
      SDL_DisplayMode mode;
      if (SDL_GetDisplayMode(d, m, &mode) == 0) offered.push_back({mode.w, mode.h});
    }
  }
  const PixelSize wanted = pickOutputSize(offered, want4k);
  width_ = wanted.width;
  height_ = wanted.height;
  window_ = SDL_CreateWindow("UltimateTV", SDL_WINDOWPOS_CENTERED, SDL_WINDOWPOS_CENTERED, width_,
                             height_, SDL_WINDOW_SHOWN | SDL_WINDOW_ALLOW_HIGHDPI);
  if (!window_) {
    problem = std::string("The console wouldn't give us a window: ") + SDL_GetError();
    return false;
  }
  renderer_ = SDL_CreateRenderer(window_, -1, SDL_RENDERER_ACCELERATED | SDL_RENDERER_PRESENTVSYNC);
  if (!renderer_) {
    // Software drawing is slow but always works; the app is mostly text.
    renderer_ = SDL_CreateRenderer(window_, -1, SDL_RENDERER_SOFTWARE);
  }
  if (!renderer_) {
    problem = std::string("The console wouldn't give us a picture: ") + SDL_GetError();
    return false;
  }
  // The canvas follows the surface, so the layout is drawn at real 4K instead of at 1080p and
  // stretched. The console may answer a smaller drawable than asked for; the size it actually
  // gave is the one to trust.
  SDL_GetRendererOutputSize(renderer_, &width_, &height_);
  if (width_ <= 0 || height_ <= 0) {
    width_ = 1920;
    height_ = 1080;
  }
  SDL_RenderSetLogicalSize(renderer_, width_, height_);
  if (video_) video_->setDisplaySize(width_, height_);

  // The first pad that answers. On the console that is the DualSense (or the remote).
  for (int i = 0; i < SDL_NumJoysticks(); ++i) {
    if (!SDL_IsGameController(i)) continue;
    pad_ = SDL_GameControllerOpen(i);
    if (pad_) break;
  }

  IMGUI_CHECKVERSION();
  ImGui::CreateContext();
  ImGui::StyleColorsDark();
  ImGuiIO& io = ImGui::GetIO();
  io.IniFilename = nullptr;  // no settings file on the console
  io.LogFilename = nullptr;
  // The remote is the only input, and a blinking cursor is a distraction on a TV.
  io.ConfigFlags |= ImGuiConfigFlags_NoMouseCursorChange;
  ImGui::GetStyle().ScrollbarSize = 0;
  if (!ImGui_ImplSDL2_InitForSDLRenderer(window_, renderer_)) {
    problem = "The screen-drawing library wouldn't start.";
    return false;
  }
  if (!ImGui_ImplSDLRenderer2_Init(renderer_)) {
    problem = "The screen-drawing library wouldn't start.";
    return false;
  }
  return true;
}

SdlWindow::~SdlWindow() {
  if (renderer_ && ImGui::GetCurrentContext()) {
    ImGui_ImplSDLRenderer2_Shutdown();
    ImGui_ImplSDL2_Shutdown();
    ImGui::DestroyContext();
  }
  if (pad_) SDL_GameControllerClose(pad_);
  if (renderer_) SDL_DestroyRenderer(renderer_);
  if (window_) SDL_DestroyWindow(window_);
  SDL_Quit();
}

void SdlWindow::handleEvent(const SDL_Event& event, std::vector<int>& keys, bool& closed) {
  if (event.type == SDL_QUIT) {
    closed = true;
    return;
  }
  if (event.type == SDL_CONTROLLERDEVICEADDED && !pad_) {
    if (SDL_IsGameController(event.cdevice.which)) {
      pad_ = SDL_GameControllerOpen(event.cdevice.which);
    }
    return;
  }
  if (event.type == SDL_CONTROLLERDEVICEREMOVED && pad_) {
    if (SDL_GameControllerGetJoystick(pad_) ==
        SDL_JoystickFromInstanceID(event.cdevice.which)) {
      SDL_GameControllerClose(pad_);
      pad_ = nullptr;
    }
    return;
  }
  if (event.type == SDL_CONTROLLERBUTTONDOWN) {
    if (event.cbutton.button == SDL_CONTROLLER_BUTTON_GUIDE) {
      // The pad's PS button closes the app: twice, so a brush past it doesn't.
      static Uint32 lastGuide = 0;
      const Uint32 now = SDL_GetTicks();
      if (now - lastGuide < 1200) {
        closed = true;
        return;
      }
      lastGuide = now;
      return;
    }
    const Key key = keyForButton(event.cbutton.button);
    keys.push_back(static_cast<int>(key));
    if (isDirection(key)) {
      held_ = key;
      holding_ = true;
      heldSince_ = SDL_GetTicks();
      lastRepeat_ = heldSince_;
    }
    return;
  }
  if (event.type == SDL_CONTROLLERBUTTONUP) {
    if (isDirection(keyForButton(event.cbutton.button))) holding_ = false;
    return;
  }
  if (event.type == SDL_KEYDOWN && !event.key.repeat) {
    KeyPress press;
    if (keyForKeyboard(event.key.keysym.sym, press)) {
      keys.push_back(static_cast<int>(press.key));
      if (isDirection(press.key)) {
        held_ = press.key;
        holding_ = true;
        heldSince_ = SDL_GetTicks();
        lastRepeat_ = heldSince_;
      }
    }
    return;
  }
  if (event.type == SDL_KEYUP) {
    KeyPress press;
    if (keyForKeyboard(event.key.keysym.sym, press) && isDirection(press.key)) {
      holding_ = false;
    }
  }
}

std::vector<int> SdlWindow::pump(int timeoutMs, bool& closed) {
  std::vector<int> keys;
  SDL_Event event;
  // One blocking wait when nothing is happening, so the app doesn't spin and the console
  // can idle. Everything already queued is drained in the same pass.
  if (timeoutMs > 0 && !SDL_WaitEventTimeout(&event, timeoutMs)) return keys;
  do {
    handleEvent(event, keys, closed);
    if (closed) return keys;
  } while (SDL_PollEvent(&event));

  // A held direction repeats, so holding left walks along a rail.
  if (holding_ && isDirection(held_)) {
    const Uint32 now = SDL_GetTicks();
    if (now - heldSince_ >= REPEAT_DELAY_MS && now - lastRepeat_ >= REPEAT_EVERY_MS) {
      lastRepeat_ = now;
      keys.push_back(static_cast<int>(held_));
    }
  }
  return keys;
}

void SdlWindow::size(int& width, int& height) {
  SDL_GetRendererOutputSize(renderer_, &width_, &height_);
  width = width_;
  height = height_;
}

/** The palette the TV app uses, so the console looks like the rest of the house. */
const ImVec4 kBackground(0.027f, 0.043f, 0.078f, 1.0f);
const ImVec4 kCard(0.055f, 0.078f, 0.125f, 1.0f);
const ImVec4 kFocus(0.243f, 0.659f, 1.0f, 1.0f);
const ImVec4 kText(0.93f, 0.95f, 0.98f, 1.0f);
const ImVec4 kMuted(0.66f, 0.71f, 0.78f, 1.0f);

void drawRow(const View::Row& row, bool firstRow) {
  if (row.title.empty() && row.labels.empty()) return;
  if (!row.title.empty()) {
    ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
    ImGui::TextUnformatted(row.title.c_str());
    ImGui::PopStyleColor();
  }
  for (size_t i = 0; i < row.labels.size(); ++i) {
    const bool focused = static_cast<int>(i) == row.focus;
    const std::string label =
        "  " + shorten(row.labels[i], 42) +
        (i < row.sublabels.size() && !row.sublabels[i].empty() ? "  ·  " + shorten(row.sublabels[i], 48) : "") +
        (i < row.badges.size() && !row.badges[i].empty() ? "  [" + row.badges[i] + "]" : "");
    if (focused) {
      // The focus bar is drawn rather than coloured, so it reads on a TV from across a room.
      ImGui::PushStyleColor(ImGuiCol_Text, kText);
      ImGui::PushStyleColor(ImGuiCol_Header, kFocus);
      ImGui::PushStyleColor(ImGuiCol_HeaderHovered, kFocus);
      ImGui::PushStyleColor(ImGuiCol_HeaderActive, kFocus);
      ImGui::Selectable(label.c_str(), true, ImGuiSelectableFlags_None);
      ImGui::PopStyleColor(4);
    } else if (i < row.progress.size() && row.progress[i] >= 0) {
      ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
      ImGui::Selectable(label.c_str(), false, ImGuiSelectableFlags_None);
      ImGui::PopStyleColor();
    } else {
      ImGui::TextUnformatted(label.c_str());
    }
  }
  if (firstRow) ImGui::Separator();
}

void SdlWindow::draw(App& app) {
  const View& view = app.view();

  // A film is drawn by the video player, not by ImGui; the controls sit on top of it.
  bool drewFilm = false;
  if (view.screen == Screen::Player && video_) {
    int width = 0;
    int height = 0;
    size(width, height);
    drewFilm = drawVideoFrame(*video_, renderer_, width, height);
    if (!drewFilm) {
      SDL_SetRenderDrawColor(renderer_, 0, 0, 0, 255);
      SDL_RenderClear(renderer_);
    }
  }

  ImGui_ImplSDLRenderer2_NewFrame();
  ImGui_ImplSDL2_NewFrame();
  ImGui::NewFrame();

  const ImGuiViewport* main = ImGui::GetMainViewport();
  ImGui::SetNextWindowPos(main->WorkPos);
  ImGui::SetNextWindowSize(main->WorkSize);
  if (drewFilm) {
    // Over a film only the bottom strip is drawn, so the picture isn't covered.
    ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0.0f, 0.0f, 0.0f, drewFilm ? 0.0f : 1.0f));
    ImGui::SetNextWindowPos(ImVec2(main->WorkPos.x, main->WorkPos.y + main->WorkSize.y * 0.62f));
    ImGui::SetNextWindowSize(ImVec2(main->WorkSize.x, main->WorkSize.y * 0.38f));
  } else {
    ImGui::PushStyleColor(ImGuiCol_WindowBg, kBackground);
  }
  ImGui::PushStyleColor(ImGuiCol_ChildBg, kCard);
  ImGui::Begin("ultimatetv", nullptr,
               ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoMove |
                   ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoSavedSettings |
                   ImGuiWindowFlags_NoBringToFrontOnFocus);
  // One big font: this is a television, not a laptop. It grows with the surface so the text is
  // the same size on the wall whether the console is drawing 1080p or 4K.
  ImGui::SetWindowFontScale(BASE_FONT_SCALE * uiScaleFor(height_));

  switch (view.screen) {
    case Screen::Player: {
      ImGui::TextUnformatted(shorten(view.playing.title, 70).c_str());
      if (!view.playing.subtitle.empty()) {
        ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
        ImGui::TextUnformatted(shorten(view.playing.subtitle, 90).c_str());
        ImGui::PopStyleColor();
      }
      if (!view.playing.live) {
        const std::string left = playTime(view.positionMs);
        const std::string total =
            view.durationMs > 0 ? playTime(view.durationMs) : std::string("--:--");
        ImGui::Text("%s / %s%s", left.c_str(), total.c_str(), view.paused ? "   (paused)" : "");
        const float fraction = view.durationMs > 0
                                   ? static_cast<float>(view.positionMs) /
                                         static_cast<float>(view.durationMs)
                                   : 0.0f;
        // A pixel height doesn't follow the font, so it is scaled by hand to stay the same
        // thickness on the wall at 4K.
        ImGui::ProgressBar(fraction, ImVec2(-1, 14.0f * uiScaleFor(height_)));
      } else {
        ImGui::TextUnformatted("Live");
      }
      ImGui::Separator();
      ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
      ImGui::TextUnformatted("OK play/pause  ·  Left/Right skip  ·  Back to the guide");
      ImGui::PopStyleColor();
      break;
    }
    case Screen::Connect: {
      ImGui::TextUnformatted(view.notice.c_str());
      if (!view.detail.empty()) {
        ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
        ImGui::TextWrapped("%s", view.detail.c_str());
        ImGui::PopStyleColor();
      }
      if (!view.pairingCode.empty()) {
        ImGui::Separator();
        ImGui::Text("Code: %s", view.pairingCode.c_str());
        ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
        ImGui::TextUnformatted("Let this screen in from the TV's Settings, or the Hub's page.");
        ImGui::PopStyleColor();
      }
      ImGui::Separator();
      ImGui::Text("Hub: %s", view.address.c_str());
      break;
    }
    case Screen::Message: {
      ImGui::TextUnformatted(view.notice.c_str());
      ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
      ImGui::TextWrapped("%s", view.detail.c_str());
      ImGui::PopStyleColor();
      ImGui::Separator();
      ImGui::TextUnformatted("OK to try again");
      break;
    }
    case Screen::Profiles: {
      for (const auto& row : view.rows) drawRow(row, true);
      break;
    }
    default: {
      if (view.busy) {
        ImGui::TextUnformatted(view.notice.empty() ? "Loading" : view.notice.c_str());
        ImGui::Separator();
      }
      for (size_t i = 0; i < view.rows.size(); ++i) drawRow(view.rows[i], i == 0);
      if (view.screen == Screen::Guide && !view.guideTitle.empty()) {
        ImGui::Separator();
        ImGui::TextUnformatted(shorten(view.guideTitle, 70).c_str());
        ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
        ImGui::TextUnformatted(view.guideTimes.c_str());
        if (!view.detail.empty()) ImGui::TextWrapped("%s", shorten(view.detail, 300).c_str());
        ImGui::PopStyleColor();
      }
      break;
    }
  }

  ImGui::End();
  ImGui::PopStyleColor(2);
  ImGui::Render();
  if (!drewFilm) {
    SDL_SetRenderDrawColor(renderer_, 7, 11, 20, 255);
    SDL_RenderClear(renderer_);
  }
  ImGui_ImplSDLRenderer2_RenderDrawData(ImGui::GetDrawData(), renderer_);
  SDL_RenderPresent(renderer_);
}

}  // namespace

void setWant4k(bool on) { want4k = on; }

std::unique_ptr<Window> openWindow(std::string& problem) {
  auto window = std::unique_ptr<SdlWindow>(new SdlWindow());
  if (!window->open(problem)) return nullptr;
  return window;
}

}  // namespace utv

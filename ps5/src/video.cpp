// The film on the console: SDL_kitchensink decodes it, SDL2's own window shows it.
//
// SDL_kitchensink is already built into the PS5 homebrew bundle (libSDL_kitchensink.a) and
// wraps FFmpeg, so the app doesn't talk to FFmpeg directly. There is no PS5 hardware decoder
// type in it, so decoding is done by the console's eight cores in software, which is enough
// for 1080p. Audio goes to SDL's audio queue, which is what makes sound come out of the TV.
#include <algorithm>
#include <cmath>
#include <cstring>
#include <string>

#include "SDL.h"
#include "kitchensink2/kitchensink.h"

#include "platform.hpp"
#include "ui.hpp"

namespace utv {

namespace {

/** How much sound SDL is asked to keep queued, so a stutter in decoding isn't heard. */
const Uint32 AUDIO_QUEUE_MS = 120;
/**
 * Bigger than any picture the app expects. The texture is allocated once per film, and a
 * texture that is the wrong size makes the decoder convert every frame in software.
 */
const int MAX_VIDEO_WIDTH = 1920;
const int MAX_VIDEO_HEIGHT = 1080;

/** The RGB surface format SDL_kitchensink hands over when asked for RGB. */
const unsigned int RGB_FORMAT = SDL_PIXELFORMAT_RGBA32;

class KitVideo : public Video {
 public:
  ~KitVideo() override { close(); }

  bool open(const PlaybackInfo& info, long startMs, std::string& problem) override;
  void close() override;
  void setPaused(bool paused) override;
  bool paused() const override { return paused_; }
  long positionMs() const override;
  long durationMs() const override;
  void seek(long ms) override;

  /** Draws the current frame. Answers false when there isn't one to draw yet. */
  bool draw(SDL_Renderer* renderer, int screenWidth, int screenHeight);

 private:
  void closeTexture();

  Kit_Source* source_ = nullptr;
  Kit_Player* player_ = nullptr;
  SDL_Texture* texture_ = nullptr;
  SDL_AudioDeviceID audio_ = 0;
  int textureWidth_ = MAX_VIDEO_WIDTH;
  int textureHeight_ = MAX_VIDEO_HEIGHT;
  bool paused_ = false;
  bool opened_ = false;
  /** The last position the player reported, so a live stream still answers something. */
  long lastPositionMs_ = 0;
  SDL_Rect picture_{0, 0, 0, 0};
};

void KitVideo::closeTexture() {
  if (texture_) {
    SDL_DestroyTexture(texture_);
    texture_ = nullptr;
  }
}

bool KitVideo::open(const PlaybackInfo& info, long startMs, std::string& problem) {
  close();

  if (info.url.empty()) {
    problem = "The Hub didn't say where the video is.";
    return false;
  }
  source_ = Kit_CreateSourceFromUrl(info.url.c_str());
  if (!source_) {
    problem = std::string("The console couldn't open the video: ") + Kit_GetError();
    return false;
  }

  const int videoStream = Kit_GetBestSourceStream(source_, KIT_STREAMTYPE_VIDEO);
  const int audioStream = Kit_GetBestSourceStream(source_, KIT_STREAMTYPE_AUDIO);
  if (videoStream < 0 && audioStream < 0) {
    problem = "That video has no picture and no sound in it.";
    Kit_CloseSource(source_);
    source_ = nullptr;
    return false;
  }

  // Ask for RGB so SDL can make a texture straight from the frames: the decoder then does the
  // colour conversion once per frame instead of SDL doing it every time the frame is drawn.
  Kit_VideoFormatRequest videoRequest;
  Kit_ResetVideoFormatRequest(&videoRequest);
  videoRequest.format = RGB_FORMAT;
  videoRequest.width = -1;
  videoRequest.height = -1;

  Kit_AudioFormatRequest audioRequest;
  Kit_ResetAudioFormatRequest(&audioRequest);

  player_ = Kit_CreatePlayer(source_, videoStream, audioStream,
                             Kit_GetBestSourceStream(source_, KIT_STREAMTYPE_SUBTITLE),
                             &videoRequest, &audioRequest, MAX_VIDEO_WIDTH, MAX_VIDEO_HEIGHT);
  if (!player_) {
    problem = std::string("The console couldn't start the video: ") + Kit_GetError();
    Kit_CloseSource(source_);
    source_ = nullptr;
    return false;
  }

  Kit_PlayerInfo playerInfo;
  Kit_GetPlayerInfo(player_, &playerInfo);
  textureWidth_ = playerInfo.video_format.width > 0 ? playerInfo.video_format.width
                                                   : MAX_VIDEO_WIDTH;
  textureHeight_ = playerInfo.video_format.height > 0 ? playerInfo.video_format.height
                                                      : MAX_VIDEO_HEIGHT;

  // Sound: the format comes from the player, and SDL's queue takes it from there.
  if (audioStream >= 0) {
    SDL_AudioSpec want;
    std::memset(&want, 0, sizeof(want));
    want.freq = playerInfo.audio_format.sample_rate > 0 ? playerInfo.audio_format.sample_rate
                                                        : 48000;
    want.format = playerInfo.audio_format.format;
    want.channels = static_cast<Uint8>(
        playerInfo.audio_format.channels > 0 ? playerInfo.audio_format.channels : 2);
    want.samples = static_cast<Uint16>(want.freq / 10);  // 100 ms, a starting figure
    want.callback = nullptr;
    audio_ = SDL_OpenAudioDevice(nullptr, 0, &want, nullptr, 0);
    if (audio_) SDL_PauseAudioDevice(audio_, 0);
  }

  Kit_PlayerPlay(player_);
  opened_ = true;
  paused_ = false;
  lastPositionMs_ = startMs;

  // The Hub remembers where the film got to, so the picture starts there rather than at the
  // beginning. Seeking before playback has buffered is unreliable, so the position is applied
  // as soon as the player reports it has started.
  if (!info.live && startMs > 0) {
    Kit_PlayerSeek(player_, static_cast<double>(startMs) / 1000.0);
  }
  return true;
}

void KitVideo::close() {
  if (audio_) {
    SDL_CloseAudioDevice(audio_);
    audio_ = 0;
  }
  closeTexture();
  if (player_) {
    Kit_PlayerStop(player_);
    Kit_ClosePlayer(player_);
    player_ = nullptr;
  }
  if (source_) {
    Kit_CloseSource(source_);
    source_ = nullptr;
  }
  opened_ = false;
  paused_ = false;
  lastPositionMs_ = 0;
}

void KitVideo::setPaused(bool paused) {
  if (!player_ || paused_ == paused) return;
  paused_ = paused;
  if (paused) {
    Kit_PlayerPause(player_);
    if (audio_) SDL_PauseAudioDevice(audio_, 1);
  } else {
    Kit_PlayerPlay(player_);
    if (audio_) SDL_PauseAudioDevice(audio_, 0);
  }
}

long KitVideo::positionMs() const {
  if (!player_) return lastPositionMs_;
  const double seconds = Kit_GetPlayerPosition(player_);
  if (seconds <= 0 && lastPositionMs_ > 0) {
    // The player answers 0 while it is still buffering; keep the last real position so the
    // Continue-watching report doesn't reset the film to the beginning.
    return lastPositionMs_;
  }
  return static_cast<long>(seconds * 1000.0);
}

long KitVideo::durationMs() const {
  if (!player_) return 0;
  const double seconds = Kit_GetPlayerDuration(player_);
  if (!(seconds > 0)) return 0;
  return static_cast<long>(seconds * 1000.0);
}

void KitVideo::seek(long ms) {
  if (!player_) return;
  const long target = std::max(0L, ms);
  Kit_PlayerSeek(player_, static_cast<double>(target) / 1000.0);
  lastPositionMs_ = target;
}

bool KitVideo::draw(SDL_Renderer* renderer, int screenWidth, int screenHeight) {
  if (!player_ || !opened_) return false;
  if (!texture_) {
    texture_ = SDL_CreateTexture(renderer, RGB_FORMAT, SDL_TEXTUREACCESS_STATIC, textureWidth_,
                                 textureHeight_);
    if (!texture_) return false;
  }

  // Sound first: the queue has to be kept topped up whether or not a new frame is ready.
  if (audio_ && !paused_) {
    const Uint32 queued = SDL_GetQueuedAudioSize(audio_);
    const Uint32 wanted = AUDIO_QUEUE_MS * 48000u * 4u / 1000u;
    if (queued < wanted) {
      unsigned char buffer[16384];
      const int got = Kit_GetPlayerAudioData(player_, static_cast<size_t>(queued), buffer,
                                             sizeof(buffer));
      if (got > 0) SDL_QueueAudio(audio_, buffer, static_cast<Uint32>(got));
    }
  }

  if (Kit_GetPlayerVideoSDLTexture(player_, texture_, &picture_) != 0) return false;
  if (picture_.w <= 0 || picture_.h <= 0) return false;

  // Fit the picture into the screen without stretching it, and keep its shape.
  const float scale =
      std::min(static_cast<float>(screenWidth) / static_cast<float>(picture_.w),
               static_cast<float>(screenHeight) / static_cast<float>(picture_.h));
  SDL_Rect target;
  target.w = static_cast<int>(static_cast<float>(picture_.w) * scale);
  target.h = static_cast<int>(static_cast<float>(picture_.h) * scale);
  target.x = (screenWidth - target.w) / 2;
  target.y = (screenHeight - target.h) / 2;

  SDL_SetRenderDrawColor(renderer, 0, 0, 0, 255);
  SDL_RenderClear(renderer);
  SDL_RenderCopy(renderer, texture_, &picture_, &target);
  return true;
}

}  // namespace

bool drawVideoFrame(Video& video, void* renderer, int width, int height) {
  KitVideo* kit = dynamic_cast<KitVideo*>(&video);
  if (!kit || !renderer) return false;
  return kit->draw(static_cast<SDL_Renderer*>(renderer), width, height);
}

std::unique_ptr<Video> makeVideo(std::string& problem) {
  // The containers and codecs the Hub hands out: MPEG-TS for live, MP4/MKV for films. libass
  // gives subtitles, and network support is what makes the URLs work at all.
  if (Kit_Init(KIT_INIT_NETWORK | KIT_INIT_ASS) != 0) {
    problem = std::string("The console's video library wouldn't start: ") + Kit_GetError();
    return nullptr;
  }
  return std::unique_ptr<Video>(new KitVideo());
}

}  // namespace utv

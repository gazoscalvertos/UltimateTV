# The PlayStation 5 app, built two ways:
#
#   make test            # the screens, the Hub client and the JSON on this machine (no console)
#   make console         # the app a PS5 runs: build/ultimatetv.elf, sent over the network
#   make tile            # build/PPSA26001/eboot.bin, the home screen tile the console installs
#   make install PS5_HOST=192.168.0.50   # copies the tile onto a jailbroken console
#
# The console half needs the PS5 payload SDK, which brings its own compiler; the test half uses
# a normal C++20 compiler on the build machine. Neither is needed to build the other.
#
#   PS5_PAYLOAD_SDK   where ps5-payload-sdk was unpacked (https://github.com/ps5-payload-dev/sdk)
#   PS5_DEVROOT       the homebrew libraries (SDL2, ImGui, FFmpeg, kitchensink) for the console
#   HOST_CXX          a C++20 compiler for `make test` (defaults to clang++ or g++)
#
# The console libraries come from ps5-payload-dev/pacbrew-repo's ps5-payload-dev release; the
# exact files needed are listed in ps5/README.md.

TITLE_ID := PPSA26001
# The fake-licence id and authinfo the SDK's own install_app sample uses. Every fake-signed
# homebrew title on every console uses these, so they are not a secret.
PAID := 0x3800000000000022
SDK_VERSION := 0x07590001
AUTHINFO := 00 00 00 00 00 00 00 00 00 00 00 00 00 1C 00 40 00 FF 00 00 00 00 00 80 \
            00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 80 00 40 00 40 \
            00 00 00 00 00 00 00 80 00 00 00 00 00 00 00 08 00 40 FF FF 00 00 00 F0 \
            00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 \
            00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 \
            00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00

# The portable half: no SDL, no console, no drawing. Everything the tests use.
PORTABLE := json model http hub text ui
# The parts that only exist on a console or with SDL.
CONSOLE_ONLY := platform_sdl video main

SRC := $(wildcard src/*.cpp)
OBJ := $(patsubst src/%.cpp,build/%.o,$(SRC))
PORTABLE_SRC := $(addprefix src/,$(addsuffix .cpp,$(PORTABLE)))

# ---------------------------------------------------------------------------
# The tests, on this machine.

HOST_CXX ?= $(shell command -v clang++ || command -v g++)
HOST_CXXFLAGS ?= -std=c++20 -O1 -Wall -Wextra -Werror
TEST_NAMES := json text model http hub ui
HOSTTEST_DIR := .hosttest
HOSTTEST_BINS := $(addprefix $(HOSTTEST_DIR)/,$(addsuffix _test,$(TEST_NAMES)))

# Each test file is one program with its own `main`, so it links only what it needs.
$(HOSTTEST_DIR)/json_test: test/json_test.cpp $(PORTABLE_SRC)
$(HOSTTEST_DIR)/text_test: test/text_test.cpp $(PORTABLE_SRC)
$(HOSTTEST_DIR)/model_test: test/model_test.cpp $(PORTABLE_SRC)
$(HOSTTEST_DIR)/http_test: test/http_test.cpp $(PORTABLE_SRC)
$(HOSTTEST_DIR)/hub_test: test/hub_test.cpp $(PORTABLE_SRC)
$(HOSTTEST_DIR)/ui_test: test/ui_test.cpp $(PORTABLE_SRC)

$(HOSTTEST_DIR)/%_test: test/%_test.cpp $(PORTABLE_SRC) test/test.hpp $(wildcard src/*.hpp)
	@mkdir -p $(HOSTTEST_DIR)
	$(HOST_CXX) $(HOST_CXXFLAGS) -Isrc -Itest -pthread -o $@ $< $(PORTABLE_SRC)

.PHONY: test
test: $(HOSTTEST_BINS)
	@failed=0; \
	for t in $(HOSTTEST_BINS); do \
	  echo "== $$t"; \
	  ./$$t || failed=1; \
	done; \
	if [ $$failed -ne 0 ]; then echo "SOME TESTS FAILED"; exit 1; fi; \
	echo "all PS5 host tests passed"

# ---------------------------------------------------------------------------
# The console half. Only attempted when the SDK is where it was asked to be.

ifdef PS5_PAYLOAD_SDK
include $(PS5_PAYLOAD_SDK)/toolchain/prospero.mk
endif

LIBDIR := $(PS5_DEVROOT)/lib
INCDIRS := -I$(PS5_DEVROOT)/include -I$(PS5_DEVROOT)/include/SDL2

# The link needs every one of these, in this order, or the symbols don't resolve.
# ffmpeg's encoders bring x264/vpx with them, and libass brings fribidi/charset/iconv.
LIBS := -lSDL2main -lSDL2 -limgui -lSDL_kitchensink \
        -lavformat -lavcodec -lswscale -lswresample -lavutil \
        -lass -lfreetype -lharfbuzz -lfontconfig -lexpat -lpng \
        -lx264 -lvpx -lfribidi -liconv -lcharset \
        -lssl -lcrypto -lz -lpsl -lzstd -lbz2 -llzma -lpthread \
        -lSceUserService -lSceSystemService -lSceAudioOut -lScePad -lSceVideoOut \
        -lSceImeDialog -lSceKeyboard -lSceNet -lSceNetCtl -lSceHttp -lSceSsl \
        -lSceSysmodule -lSceRandom

CONSOLE_FLAGS := -std=c++20 -O2 -Wall -Wextra $(INCDIRS)

build/%.o: src/%.cpp $(wildcard src/*.hpp)
	@mkdir -p build
	$(CXX) $(CONSOLE_FLAGS) -c -o $@ $<

.PHONY: console
console: build/ultimatetv.elf

# A plain ELF the payload loader can run over the network (`make deploy`).
build/ultimatetv.elf: $(OBJ)
	$(CXX) -O2 -o $@ $(OBJ) -L$(LIBDIR) $(LIBS)
	@echo "built $@ ($$(stat -c %s $@) bytes)"

# The home screen tile. It has to be ET_EXEC and carry the console's process-parameter header,
# which is what src/eboot.x does that the SDK's default -pie link does not.
build/eboot.elf: $(OBJ) src/eboot.x
	$(CXX) -O2 -Wl,--no-pie -T src/eboot.x -o $@ $(OBJ) -L$(LIBDIR) $(LIBS)

build/make_fself.py: $(PS5_PAYLOAD_SDK)/samples/install_app/make_fself.py
	@mkdir -p build
	cp $< $@
	chmod +x $@

.PHONY: tile
tile: build/$(TITLE_ID)/eboot.bin

build/$(TITLE_ID)/eboot.bin: build/eboot.elf build/make_fself.py
	@mkdir -p build/$(TITLE_ID)
	./build/make_fself.py --ptype fake --paid $(PAID) --auth-info "$(AUTHINFO)" \
	    --app-version $(SDK_VERSION) --fw-version $(SDK_VERSION) $< $@
	@echo "built $@ ($$(stat -c %s $@) bytes)"

# Everything the console's home screen needs, in one folder to copy across.
.PHONY: package
package: tile
	cp sce_sys/param.json sce_sys/param.json.system sce_sys/icon0.png build/$(TITLE_ID)/

# Copies the tile to a console that is running the payload loader (port 9021) and its FTP
# server (port 2121). It is a folder copy, not an install: the console reads it on next boot.
PS5_HOST ?= ps5
FTPSRV_URL := ftp://$(PS5_HOST):2121

.PHONY: install
install: package
	@echo "copying UltimateTV to $(PS5_HOST) — it appears on the home screen after a restart"
	curl -sS -Q "MTRW" $(FTPSRV_URL) -o /dev/null
	-curl -sS -Q "MKD /user/app/$(TITLE_ID)" $(FTPSRV_URL) -o /dev/null
	-curl -sS -Q "MKD /user/app/$(TITLE_ID)/sce_sys" $(FTPSRV_URL) -o /dev/null
	curl -sS -T build/$(TITLE_ID)/eboot.bin $(FTPSRV_URL)/user/app/$(TITLE_ID)/eboot.bin
	curl -sS -T build/$(TITLE_ID)/param.json $(FTPSRV_URL)/user/app/$(TITLE_ID)/sce_sys/param.json
	curl -sS -T build/$(TITLE_ID)/icon0.png $(FTPSRV_URL)/user/app/$(TITLE_ID)/sce_sys/icon0.png
	@echo "done: restart the console and look for UltimateTV"

# Runs the app right now, over the payload loader, without installing it.
.PHONY: deploy
deploy: build/ultimatetv.elf
	$(PS5_DEPLOY) -h $(PS5_HOST) -p $(PS5_PORT) $<

.PHONY: clean
clean:
	rm -rf build $(HOSTTEST_DIR)
